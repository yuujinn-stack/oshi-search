// 楽天APIから取得した商品データを永続保存するモジュール（Neon DB）
// バッチ処理でのみ書き込み、人物ページと管理画面から読み取る

import { cache } from 'react';
import { db } from '@/db/client';
import { products as productsTable, batchMeta as batchMetaTable } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { upsertProduct } from '@/db/write';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';
import { isLegacyIchibaId, isNewIchibaId } from '@/lib/rakuten-item-id';
import { normalizeItemUrl } from '@/lib/legacy-ichiba-verdict';

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
// 楽天アフィリエイトURL（hb.afl.rakuten.co.jp/hgc/<識別子>/?pc=<商品ページ>）は、ホスト＋パスが店舗単位で同じになり
// 同じ店舗の別商品が同一とみなされてしまうため、遷移先（pc）の商品ページで比較する。
// 実装は src/lib/legacy-ichiba-verdict.ts（復旧APIと同じ規則で比較するため共通化）
export { normalizeItemUrl };

const isAffiliateUrlFormat = (v: unknown) => typeof v === 'string' && /^https?:\/\/hb\.afl\.rakuten\.co\.jp\//.test(v);

// fetched の情報で existing を更新するが、null / undefined / "" で既存値を上書きしない。
// 既存の affiliateUrl が楽天アフィリエイトURLで、fetched の affiliateUrl がそうでない場合（楽天APIが affiliateUrl を
// 返さず itemUrl で代用された場合など）は、正規のアフィリエイトURLを通常URLで上書きしない。
export function mergeRakutenItem(fetched: RakutenItem, existing: RakutenItem): RakutenItem {
  const result = { ...existing } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fetched)) {
    if (value !== null && value !== undefined && value !== '') {
      if (key === 'affiliateUrl' && isAffiliateUrlFormat(existing.affiliateUrl) && !isAffiliateUrlFormat(value)) continue;
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
    if (existingMatch && existingMatch.id.startsWith('mn-')) {
      // 手動登録の商品（mn-、判定は manual）と同じ商品ページなら、手動登録の商品をそのまま残し取得分は追加しない。
      // 取得分のIDで置き換えると手動登録の判定が外れ、同じ商品が未判定の別IDとして扱われるため
      resultById.set(existingMatch.id, { ...existingMatch });
      mergedCount++;
    } else if (existingMatch) {
      // 楽天市場の商品IDの安定化（Phase 4）：新ID（ich-）で取得した商品が、既存の楽天市場商品（旧ID ic- または新ID ich-）と
      // 同じ商品ページなら既存のIDを残す。IDを変えると、そのIDに付いている判定（verdicts）が外れて商品が非表示になるため。
      // - 旧ID → 新IDの切り替えは、判定の引き継ぎとあわせて移行スクリプトでのみ行う
      // - URL由来で移行した新IDと、取得時の itemCode 由来の新IDが万一異なっても、IDは変わらない（一度付いたIDを維持）
      const keepLegacyId = (isLegacyIchibaId(existingMatch.id) || isNewIchibaId(existingMatch.id)) && isNewIchibaId(fetchedItem.id);
      const id = keepLegacyId ? existingMatch.id : fetchedItem.id;
      resultById.set(id, { ...mergeRakutenItem({ ...fetchedItem }, existingMatch), id });
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
  // 同じ商品ページ（アフィリエイトURLなら遷移先）の商品があれば重複とする。手動登録の通常URLと、定期取得の
  // アフィリエイトURL（新ID ich- / 旧ID ic-）の同じ商品が二重に登録されないようにする
  const page = normalizeItemUrl(product.itemUrl);
  const dup = existing.some((p) => p.id === product.id || p.itemUrl === product.itemUrl || (!!page && normalizeItemUrl(p.itemUrl) === page));
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

// 商品1件の現在のimageUrlのみを取得する（ホーム「人気商品」のランキング表示専用）。
// getAllStoredProducts() はそのカテゴリの items 配列を丸ごと取得するため、1人物・
// 1カテゴリの商品点数が多い場合（数百〜千件規模）に無駄が大きい。jsonb_array_elements
// + WHERE でDB側から対象商品1件だけを絞り込むことで、カテゴリ内の商品点数が増えても
// 転送量・JSONパース量が定数に近くなるようにする。
export async function getStoredProductImageUrl(
  personName: string,
  category: ProductCategory,
  productId: string,
): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT item->>'imageUrl' AS image_url
      FROM products, jsonb_array_elements(items) AS item
      WHERE person_name = ${personName}
        AND category = ${category}
        AND item->>'id' = ${productId}
      LIMIT 1
    `);
    const row = result.rows[0] as { image_url: string | null } | undefined;
    return row?.image_url ?? null;
  } catch (err) {
    console.error('[db] getStoredProductImageUrl failed:', String(err));
    return null;
  }
}

// 商品1件のフルデータを取得する（写真集機能: 手動追加された商品が'写真集'以外の
// カテゴリに属する場合に、そのカテゴリから実データを引き当てるために使う）。
// getStoredProductImageUrl と同じ「DB側で1件だけ絞り込む」方針。
export async function getStoredProductItemById(
  personName: string,
  category: ProductCategory,
  productId: string,
): Promise<RakutenItem | null> {
  try {
    const result = await db.execute(sql`
      SELECT item
      FROM products, jsonb_array_elements(items) AS item
      WHERE person_name = ${personName}
        AND category = ${category}
        AND item->>'id' = ${productId}
      LIMIT 1
    `);
    const row = result.rows[0] as { item: RakutenItem } | undefined;
    return row?.item ?? null;
  } catch (err) {
    console.error('[db] getStoredProductItemById failed:', String(err));
    return null;
  }
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
// react の cache() でリクエスト内の重複DB呼び出しを防ぐ（generateMetadata + ページ本体で
// 同じ人物のデータを取得しても実際のクエリは1回のみ。cross-request キャッシュではない）。
export const getAllStoredProductsOrThrow = cache(async (
  personName: string,
): Promise<Partial<Record<ProductCategory, StoredCategoryData>>> => {
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
});

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
