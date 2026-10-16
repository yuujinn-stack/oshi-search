import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { appendProductToCategory, getStoredProductItemById, updateProductInCategory } from '@/lib/product-store';
import { resolveManualAffiliateUrl } from '@/lib/rakuten-affiliate-resolve';
import {
  AFFILIATE_LINK_STATUS_LABEL,
  affiliateLinkStatusOf,
  parseAffiliateUrl,
  productKeyOfLink,
  productKeyString,
} from '@/lib/rakuten-affiliate-link';
import { saveVerdict } from '@/lib/judgment-store';
import { RANKING_DATA_CACHE_TAG } from '@/lib/ranking';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';

const VALID_CATEGORIES: ProductCategory[] = [
  '写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古',
];

// POST /api/admin/product-manual — 手動商品追加（1人 or 複数人一括）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    personNames?: string[];
    title?: string;
    itemUrl?: string;
    /** 管理画面の楽天検索で、楽天APIがこの商品に返した affiliateUrl（ある場合は最優先で使う） */
    affiliateUrl?: string;
    imageUrl?: string;
    category?: string;
    price?: number;
    shopName?: string;
    isUsed?: boolean;
    description?: string;
  };

  // personNames[] 優先、なければ personName を配列化（後方互換）
  const rawNames = body.personNames ?? (body.personName ? [body.personName] : []);
  const personNames = [...new Set(rawNames.filter(Boolean))] as string[];
  const { title, itemUrl, imageUrl, category, price, shopName, isUsed, description } = body;

  if (personNames.length === 0 || !title || !itemUrl || !category) {
    return NextResponse.json({ error: '必須項目が不足しています（追加先人物・商品名・URL・カテゴリ）' }, { status: 400 });
  }
  if (!VALID_CATEGORIES.includes(category as ProductCategory)) {
    return NextResponse.json({ error: '無効なカテゴリです' }, { status: 400 });
  }

  // affiliateUrl には確認できた正規のアフィリエイトURLだけを入れる（確認できなければ空＝要確認。
  // 公開ページは affiliateUrl || itemUrl でリンクするため、空でもリンクは従来どおり機能する）。
  // 以前は itemUrl をそのまま affiliateUrl に入れていたため、楽天ブックスの通常URLが「アフィリエイトURL」として保存されていた。
  const link = await resolveManualAffiliateUrl({ title: title.trim(), itemUrl: itemUrl.trim(), apiAffiliateUrl: body.affiliateUrl });

  const results: { personName: string; status: 'created' | 'duplicate' }[] = [];
  for (let i = 0; i < personNames.length; i++) {
    const personName = personNames[i];
    const id = `mn-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const product: RakutenItem = {
      id,
      title: title.trim(),
      itemUrl: itemUrl.trim(),
      imageUrl: imageUrl?.trim() ?? '',
      affiliateUrl: link.affiliateUrl,
      price: price ?? 0,
      reviewCount: 0,
      reviewAverage: 0,
      shopName: shopName?.trim() || undefined,
      category: category as ProductCategory,
      relevanceScore: 100,
      isUsed: isUsed ?? false,
      description: description?.trim() || undefined,
    };
    const status = await appendProductToCategory(personName, category as ProductCategory, product);
    results.push({ personName, status });
    if (status === 'created') {
      await saveVerdict(personName, id, 'related', 100, 'manual');
      revalidatePath(`/person/${encodeURIComponent(personName)}`);
      revalidateTag(RANKING_DATA_CACHE_TAG, { expire: 0 });
    }
  }

  const created = results.filter((r) => r.status === 'created').map((r) => r.personName);
  const duplicates = results.filter((r) => r.status === 'duplicate').map((r) => r.personName);
  return NextResponse.json({
    ok: true,
    created,
    duplicates,
    linkStatus: link.status,
    linkStatusLabel: AFFILIATE_LINK_STATUS_LABEL[link.status],
    linkMessage: link.message,
  });
}

// PUT /api/admin/product-manual — 手動商品編集
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    productId?: string;
    category?: string;
    title?: string;
    itemUrl?: string;
    imageUrl?: string;
    price?: number;
    shopName?: string;
    isUsed?: boolean;
    description?: string;
  };

  const { personName, productId, category, ...updates } = body;
  if (!personName || !productId || !category) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const filteredUpdates: Partial<RakutenItem> = {};
  if (updates.title !== undefined) filteredUpdates.title = (updates.title as string).trim();
  if (updates.itemUrl !== undefined) filteredUpdates.itemUrl = (updates.itemUrl as string).trim();
  if (updates.imageUrl !== undefined) filteredUpdates.imageUrl = (updates.imageUrl as string).trim();
  if (updates.price !== undefined) filteredUpdates.price = Number(updates.price);
  if (updates.shopName !== undefined) filteredUpdates.shopName = (updates.shopName as string).trim() || undefined;
  if (updates.isUsed !== undefined) filteredUpdates.isUsed = Boolean(updates.isUsed);
  if (updates.description !== undefined) filteredUpdates.description = (updates.description as string).trim() || undefined;

  // 商品URLが変わった場合だけ affiliateUrl を決め直す（従来は itemUrl だけ更新され、リンク先が古いままになっていた）。
  // 新しい商品URLが確認済みの affiliateUrl と同じ商品を指す場合は、その正規URLを残す（通常URLで上書きしない）。
  let linkStatus: string | undefined;
  if (filteredUpdates.itemUrl !== undefined) {
    const current = await getStoredProductItemById(personName, category as ProductCategory, productId);
    if (!current) return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
    if (filteredUpdates.itemUrl !== (current.itemUrl ?? '').trim()) {
      const keep = parseAffiliateUrl(current.affiliateUrl);
      const newKey = productKeyOfLink(filteredUpdates.itemUrl);
      if (keep && newKey && productKeyString(keep.key) === productKeyString(newKey)) {
        filteredUpdates.affiliateUrl = current.affiliateUrl;
      } else {
        const link = await resolveManualAffiliateUrl({
          title: filteredUpdates.title ?? current.title ?? '',
          itemUrl: filteredUpdates.itemUrl,
        });
        filteredUpdates.affiliateUrl = link.affiliateUrl;
      }
      linkStatus = affiliateLinkStatusOf({ itemUrl: filteredUpdates.itemUrl, affiliateUrl: filteredUpdates.affiliateUrl });
    }
  }

  const ok = await updateProductInCategory(personName, category as ProductCategory, productId, filteredUpdates);
  if (!ok) {
    return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
  }

  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  // 人気商品のホーム表示は商品画像を含むためimageUrl変更時のみ再検証する
  // （価格・ショップ名等、ランキング表示に影響しないフィールドのみの変更では呼ばない）
  if (filteredUpdates.imageUrl !== undefined) {
    revalidateTag(RANKING_DATA_CACHE_TAG, { expire: 0 });
  }
  return NextResponse.json({
    ok: true,
    ...(linkStatus ? { linkStatus, linkStatusLabel: AFFILIATE_LINK_STATUS_LABEL[linkStatus as keyof typeof AFFILIATE_LINK_STATUS_LABEL] } : {}),
  });
}
