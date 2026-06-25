import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { appendProductToCategory, updateProductInCategory } from '@/lib/product-store';
import { saveVerdict } from '@/lib/judgment-store';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';

const VALID_CATEGORIES: ProductCategory[] = [
  '写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古',
];

function generateManualId(): string {
  return `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// POST /api/admin/product-manual — 手動商品追加
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    title?: string;
    itemUrl?: string;
    imageUrl?: string;
    category?: string;
    price?: number;
    shopName?: string;
    isUsed?: boolean;
    description?: string;
  };

  const { personName, title, itemUrl, imageUrl, category, price, shopName, isUsed, description } = body;

  if (!personName || !title || !itemUrl || !category) {
    return NextResponse.json({ error: '必須項目が不足しています（商品名・URL・カテゴリ）' }, { status: 400 });
  }
  if (!VALID_CATEGORIES.includes(category as ProductCategory)) {
    return NextResponse.json({ error: '無効なカテゴリです' }, { status: 400 });
  }

  const id = generateManualId();
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

  const result = await appendProductToCategory(personName, category as ProductCategory, product);
  if (result === 'duplicate') {
    return NextResponse.json({ error: '同じURLの商品がすでに登録されています' }, { status: 409 });
  }

  await saveVerdict(personName, id, 'related', 100, 'manual');
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true, id });
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
