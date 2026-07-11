// 楽天APIから取得した商品データを永続保存するモジュール（Neon DB）
// バッチ処理でのみ書き込み、人物ページと管理画面から読み取る

import { db } from '@/db/client';
import { products as productsTable, batchMeta as batchMetaTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertProduct } from '@/db/write';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

export const CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];

export interface StoredCategoryData {
  products: RakutenItem[];
  fetchedAt: number; // バッチ実行のタイムスタンプ
}

// カテゴリ単位で商品を保存（バッチ処理から呼ぶ）
// verdictIds を渡すと、新規フェッチに含まれなかった verdict 済み商品を既存データから保持する。
// これにより「手動採用した商品が楽天再取得で消える」問題を防ぐ。
export async function storeProducts(
  personName: string,
  category: ProductCategory,
  products: RakutenItem[],
  verdictIds?: Set<string>,
): Promise<void> {
  let finalProducts = products;
  if (verdictIds && verdictIds.size > 0) {
    try {
      const rows = await db.select().from(productsTable)
        .where(eq(productsTable.personName, personName));
      const row = rows.find((r) => r.category === category);
      if (row) {
        const existing = row.items as RakutenItem[];
        const newIds = new Set(products.map((p) => p.id));
        const preserved = existing.filter((p) => !newIds.has(p.id) && verdictIds.has(p.id));
        if (preserved.length > 0) {
          console.log(`[db] ${personName}/${category}: verdict済み${preserved.length}件を保持`);
          finalProducts = [...products, ...preserved];
        }
      }
    } catch { /* 既存データ取得失敗時はそのまま上書き */ }
  }
  const fetchedAt = Date.now();
  await upsertProduct(personName, category, finalProducts, fetchedAt);
}

// 手動追加: カテゴリに商品を1件追加（既存商品は保持）
// 同じ id または itemUrl が既にある場合は 'duplicate' を返す
export async function appendProductToCategory(
  personName: string,
  category: ProductCategory,
  product: RakutenItem,
): Promise<'created' | 'duplicate'> {
  const rows = await db.select().from(productsTable)
    .where(eq(productsTable.personName, personName));
  const row = rows.find((r) => r.category === category);
  let existing: RakutenItem[] = row ? (row.items as RakutenItem[]) : [];
  const fetchedAt = row ? row.fetchedAt.getTime() : Date.now();
  const dup = existing.some((p) => p.id === product.id || p.itemUrl === product.itemUrl);
  if (dup) return 'duplicate';
  existing = [...existing, product];
  await upsertProduct(personName, category, existing, fetchedAt);
  return 'created';
}

// 手動追加商品の更新（フィールドを部分更新）
export async function updateProductInCategory(
  personName: string,
  category: ProductCategory,
  productId: string,
  updates: Partial<RakutenItem>,
): Promise<boolean> {
  const rows = await db.select().from(productsTable)
    .where(eq(productsTable.personName, personName));
  const row = rows.find((r) => r.category === category);
  if (!row) return false;
  const items = row.items as RakutenItem[];
  const idx = items.findIndex((p) => p.id === productId);
  if (idx === -1) return false;
  items[idx] = { ...items[idx], ...updates };
  await upsertProduct(personName, category, items, row.fetchedAt.getTime());
  return true;
}

// 人物の全カテゴリを一括取得（人物ページレンダリング時）
export async function getAllStoredProducts(
  personName: string
): Promise<Partial<Record<ProductCategory, StoredCategoryData>>> {
  try {
    const rows = await db.select().from(productsTable).where(eq(productsTable.personName, personName));
    const result: Partial<Record<ProductCategory, StoredCategoryData>> = {};
    for (const r of rows) {
      if ((CATEGORIES as string[]).includes(r.category)) {
        result[r.category as ProductCategory] = {
          products: r.items as RakutenItem[],
          fetchedAt: r.fetchedAt.getTime(),
        };
      }
    }
    return result;
  } catch (err) {
    console.error('[db] getAllStoredProducts failed:', String(err));
    return {};
  }
}

// DBエラー時に throw する版（人物ページで error/empty を区別するために使う）
export async function getAllStoredProductsOrThrow(
  personName: string,
): Promise<Partial<Record<ProductCategory, StoredCategoryData>>> {
  const rows = await db.select().from(productsTable).where(eq(productsTable.personName, personName));
  const result: Partial<Record<ProductCategory, StoredCategoryData>> = {};
  for (const r of rows) {
    if ((CATEGORIES as string[]).includes(r.category)) {
      result[r.category as ProductCategory] = {
        products: r.items as RakutenItem[],
        fetchedAt: r.fetchedAt.getTime(),
      };
    }
  }
  return result;
}

// バッチの最終実行情報を保存（Neon DB: batch_meta）
export async function saveBatchMeta(meta: {
  lastRunAt: number;
  personCount: number;
  aiJudged: number;
}): Promise<void> {
  const lastRunAt = new Date(meta.lastRunAt);
  await db.insert(batchMetaTable)
    .values({ id: 1, lastRunAt, personCount: meta.personCount, aiJudged: meta.aiJudged, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: batchMetaTable.id,
      set: { lastRunAt, personCount: meta.personCount, aiJudged: meta.aiJudged, updatedAt: new Date() },
    });
}

// バッチの最終実行情報を取得（Neon DB: batch_meta）
export async function getBatchMeta(): Promise<{
  lastRunAt: number;
  personCount: number;
  aiJudged: number;
} | null> {
  try {
    const rows = await db.select().from(batchMetaTable).limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return { lastRunAt: r.lastRunAt.getTime(), personCount: r.personCount, aiJudged: r.aiJudged };
  } catch {
    return null;
  }
}
