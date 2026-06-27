import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { appendProductToCategory, updateProductInCategory } from '@/lib/product-store';
import { saveVerdict } from '@/lib/judgment-store';
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

  const results: { personName: string; status: 'created' | 'duplicate' }[] = [];
  for (let i = 0; i < personNames.length; i++) {
    const personName = personNames[i];
    const id = `mn-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const product: RakutenItem = {
      id,
      title: title.trim(),
      itemUrl: itemUrl.trim(),
      imageUrl: imageUrl?.trim() ?? '',
      affiliateUrl: itemUrl.trim(),
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
    }
  }

  const created = results.filter((r) => r.status === 'created').map((r) => r.personName);
  const duplicates = results.filter((r) => r.status === 'duplicate').map((r) => r.personName);
  return NextResponse.json({ ok: true, created, duplicates });
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

  const ok = await updateProductInCategory(personName, category as ProductCategory, productId, filteredUpdates);
  if (!ok) {
    return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
  }

  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true });
}
