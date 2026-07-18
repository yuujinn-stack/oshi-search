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

// バッチ保存の統計情報
export interface ProductMergeStats {
  fetchedCount:           number;  // 楽天APIから取得した件数
  retainedExistingCount:  number;  // fetchedにない既存商品（削除しない）
  addedCount:             number;  // 新規追加（既存にない）
  mergedCount:            number;  // 既存と同一IDでマージ
  preservedManualCount:   number;  // verdict未登録の保持商品（手動追加候補）
  preservedVerdictedCount:number;  // verdict登録済みの保持商品
  skippedBecauseError:    boolean; // true=API空+既存あり → 保存スキップ
}

// itemUrl を正規化してセカンダリキーにする（URLパスの変更対策）
function normalizeItemUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

// fetched の情報で existing を更新するが、null / undefined / "" で既存値を上書きしない
export function mergeRakutenItem(fetched: RakutenItem, existing: RakutenItem): RakutenItem {
  const result = { ...existing } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fetched)) {
    if (value !== null && value !== undefined && value !== '') {
      result[key] = value;
    }
  }
  return result as unknown as RakutenItem;
}

// 非破壊マージ:
//   - fetchedとexistingを stable key (id → normalized URL) でマッチング
//   - fetchedにある商品: 既存とマージ（空値上書きなし）
//   - fetchedにない既存商品: 削除せず全て保持
//   - 重複なし（同一stable keyは1件）
export function mergeProductItems(
  fetched: readonly RakutenItem[],
  existing: readonly RakutenItem[],
  verdictIds: ReadonlySet<string>,
): { items: RakutenItem[] } & Omit<ProductMergeStats, 'skippedBecauseError'> {
  // 既存商品を id とURLの両方でインデックス
  const existingById  = new Map<string, RakutenItem>();
  const existingByUrl = new Map<string, RakutenItem>();
  for (const item of existing) {
    if (!existingById.has(item.id)) existingById.set(item.id, item);
    const url = normalizeItemUrl(item.itemUrl);
    if (url && !existingByUrl.has(url)) existingByUrl.set(url, item);
  }

  const resultById = new Map<string, RakutenItem>();
  let addedCount  = 0;
  let mergedCount = 0;

  // ステップ1: fetched 商品を処理（既存とマージ or 新規追加）
  for (const fetchedItem of fetched) {
    const existingMatch =
      existingById.get(fetchedItem.id) ??
      existingByUrl.get(normalizeItemUrl(fetchedItem.itemUrl));
    if (existingMatch) {
      resultById.set(fetchedItem.id, mergeRakutenItem({ ...fetchedItem }, existingMatch));
      mergedCount++;
    } else {
      resultById.set(fetchedItem.id, { ...fetchedItem });
      addedCount++;
    }
  }

  // ステップ2: fetchedにない既存商品を全て保持（手動追加・verdict済み商品含む）
  const fetchedIds  = new Set(fetched.map((i) => i.id));
  const fetchedUrls = new Set(fetched.map((i) => normalizeItemUrl(i.itemUrl)).filter(Boolean));

  let retainedExistingCount    = 0;
  let preservedManualCount     = 0;
  let preservedVerdictedCount  = 0;

  for (const item of existing) {
    const inFetched =
      fetchedIds.has(item.id) ||
      fetchedUrls.has(normalizeItemUrl(item.itemUrl));
    if (!inFetched && !resultById.has(item.id)) {
      resultById.set(item.id, { ...item });
      retainedExistingCount++;
      if (verdictIds.has(item.id)) {
        preservedVerdictedCount++;
      } else {
        preservedManualCount++;
      }
    }
  }

  return {
    items: [...resultById.values()],
    fetchedCount:            fetched.length,
    retainedExistingCount,
    addedCount,
    mergedCount,
    preservedManualCount,
    preservedVerdictedCount,
  };
}

// カテゴリ単位で商品を保存（バッチ処理から呼ぶ）
//
// 安全ガード:
//   1. products=[] + 既存あり → 保存スキップ（楽天API失敗・429・タイムアウト時のデータ消失防止）
//   2. 非破壊マージ: fetchedにない既存商品は全て保持（手動追加・verdict済み商品含む）
//   3. 空値での既存値上書きなし（fetchedのnull/""は既存値を保持）
//   4. stable key (id → normalized URL) で重複防止
export async function storeProducts(
  personName: string,
  category: ProductCategory,
  products: RakutenItem[],
  verdictIds?: Set<string>,
): Promise<ProductMergeStats> {
  // 既存データを先に取得（スキップ判定 + マージの両方に必要）
  let existingItems: RakutenItem[] = [];
  let hasExisting = false;
  try {
    const rows = await db.select().from(productsTable)
      .where(eq(productsTable.personName, personName));
    const row = rows.find((r) => r.category === category);
    if (row) {
      existingItems = row.items as RakutenItem[];
      hasExisting = existingItems.length > 0;
    }
  } catch {
    // DB読み取り失敗: 既存データ不明のため新規データのみ保存（フォールバック）
  }

  // 空上書き防止: API 0件 + 既存あり → スキップ
  if (products.length === 0 && hasExisting) {
    console.log(`[db] ${personName}/${category}: 新規0件のため既存${existingItems.length}件を保持`);
    return {
      fetchedCount:            0,
      retainedExistingCount:   existingItems.length,
      addedCount:              0,
      mergedCount:             0,
      preservedManualCount:    0,
      preservedVerdictedCount: 0,
      skippedBecauseError:     true,
    };
  }

  // 非破壊マージ
  const activeVerdictIds = verdictIds ?? new Set<string>();
  const stats = mergeProductItems(products, existingItems, activeVerdictIds);

  if (stats.retainedExistingCount > 0) {
    console.log(
      `[db] ${personName}/${category}: 既存${stats.retainedExistingCount}件保持` +
      ` (verdict:${stats.preservedVerdictedCount} / other:${stats.preservedManualCount})`,
    );
  }

  const fetchedAt = Date.now();
  await upsertProduct(personName, category, stats.items, fetchedAt);

  return { ...stats, skippedBecauseError: false };
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
