// 写真集機能: DB問い合わせ層。
//
// 商品本体は既存の products テーブル（personName, category, items JSONB）を single
// source of truth として利用する（二重保存しない）。photobook_settings は表示設定・
// 例外設定だけを持つ。人物の公開判定・グループ紐付けは既存の getAllPersonsMerged() 等を
// そのまま再利用する（このファイルで独自の「公開条件」を作らない）。
//
// OpenAI等の外部AIは一切呼び出さない。判定は photobook.ts の決定的ルールのみで行う。

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { getAllPersonsMerged } from './persons';
import { getAllPersonMetas } from './person-meta';
import { getAllGroupMetas } from './group-meta';
import { getStoredProductItemById } from './product-store';
import {
  isAutoDetectedPhotobook,
  computeDedupKey,
  selectRepresentative,
  resolvePersonGender,
  resolveGenreBucket,
  genreBucketOrder,
  distributeAvoidingConsecutivePerson,
  type PhotobookGender,
  type PhotobookGenreBucket,
} from './photobook';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

// スキャン対象カテゴリ。
//
// 実データ調査(2026)の結果、category='写真集'だけでは実在する写真集を大量に
// 取りこぼすことが判明したため、以下のカテゴリも対象に含める:
//   - 写真集      : 楽天ブックス著者/タイトル検索で写真集として取得された商品
//   - 本・雑誌    : 実データで多数の実在写真集（1st写真集/ファースト写真集等）を確認
//                    （例: 芳根京子, 中田花奈, 五百城茉央, 井上小百合, 佐野勇斗 等）
//   - CD          : グループ写真集がCDカテゴリ経由で登録されるケースを確認
//                    （例: 櫻坂46写真集 櫻撮VOL.01）。CD+写真集のバンドル商品は
//                    タイトルに"CD"を含むため除外語ルールで正しく弾かれる。
//   - Blu-ray・DVD: "Blu-ray+Photobook"等のバンドル商品を確認したが、いずれも
//                    タイトルに"Blu-ray"/"DVD"を含むため除外語ルールで正しく弾かれる。
//                    単独写真集がこのカテゴリから見つかるケースは確認できなかったが、
//                    バンドル商品の誤検出リスクが無いため安全側に含める。
//
// 除外したカテゴリ:
//   - 中古        : ユーザー指定により常に除外（isUsedByTitle等とは別に、カテゴリ自体を
//                    スキャン対象から外す）
//   - グッズ      : タイトルがタグ羅列型（例:「...雑誌 写真集 アイドル ...グッズ」）で、
//                    「グッズ」という除外語自体が末尾の定型タグとして頻出するため、
//                    誤除外(false negative)と誤検出(false positive)の衝突リスクが高いと
//                    判断し自動スキャン対象から外した。該当商品は管理画面から手動追加できる。
const PHOTOBOOK_SCAN_CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'CD', 'Blu-ray・DVD'];

// neon-httpドライバは `= ANY($1)` にJS配列をそのまま渡すとPostgres配列リテラルとして
// 解釈できないため、vod-page.ts と同じ ARRAY[$1,$2,...]::text[] 形式で組み立てる。
function textArraySql(values: readonly string[]) {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export type PhotobookStatus = 'auto' | 'manual_include' | 'manual_exclude';
export type PhotobookHomeState = 'auto' | 'pinned' | 'hidden';

export interface PhotobookSettingsView {
  status: PhotobookStatus;
  published: boolean;
  homeState: PhotobookHomeState;
  homePinnedPosition: number | null;
  sortOrder: number | null;
  dedupGroupOverride: string | null;
  forceRepresentative: boolean;
  sourceCategory: string | null;
  note: string | null;
}

const DEFAULT_SETTINGS: PhotobookSettingsView = {
  status: 'auto',
  published: true,
  homeState: 'auto',
  homePinnedPosition: null,
  sortOrder: null,
  dedupGroupOverride: null,
  forceRepresentative: false,
  sourceCategory: null,
  note: null,
};

interface RawCandidateRow {
  person_name: string;
  item: RakutenItem;
  status: string | null;
  published: boolean | null;
  home_state: string | null;
  home_pinned_position: number | null;
  sort_order: number | null;
  dedup_group_override: string | null;
  force_representative: boolean | null;
  source_category: string | null;
  note: string | null;
}

interface RawManualRow {
  person_name: string;
  product_id: string;
  source_category: string | null;
  status: string | null;
  published: boolean | null;
  home_state: string | null;
  home_pinned_position: number | null;
  sort_order: number | null;
  dedup_group_override: string | null;
  force_representative: boolean | null;
  note: string | null;
}

// 内部表現: 1商品 = 1候補（重複統合前）
interface CandidateItem {
  personName: string;
  item: RakutenItem;
  settings: PhotobookSettingsView;
}

export interface PhotobookItem {
  personName: string;
  groupName: string;
  gender: PhotobookGender | null;
  genreBucket: PhotobookGenreBucket;
  productId: string;
  title: string;
  imageUrl: string;
  price: number;
  itemUrl: string;
  affiliateUrl: string;
  shopName?: string;
  status: PhotobookStatus;
  published: boolean;
  homeState: PhotobookHomeState;
  homePinnedPosition: number | null;
  sortOrder: number | null;
  dedupKey: string;
  /** 同一重複グループ内で統合された他商品の件数（代表商品自身を除く） */
  groupSiblingCount: number;
  /** 同一重複グループ内の全商品ID（管理画面の重複候補確認用） */
  groupProductIds: string[];
}

// ── Step 1: スキャン対象カテゴリの自動候補（verdict=related のみ）───────────────
async function fetchAutoCandidateRows(): Promise<RawCandidateRow[]> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT p.person_name, item
      FROM products p, jsonb_array_elements(p.items) AS item
      WHERE p.category = ANY(${textArraySql(PHOTOBOOK_SCAN_CATEGORIES)})
    )
    SELECT
      c.person_name,
      c.item,
      pbs.status,
      pbs.published,
      pbs.home_state,
      pbs.home_pinned_position,
      pbs.sort_order,
      pbs.dedup_group_override,
      pbs.force_representative,
      pbs.source_category,
      pbs.note
    FROM candidates c
    JOIN verdicts v
      ON v.person_name = c.person_name
      AND v.product_id = c.item->>'id'
      AND v.verdict = 'related'
    LEFT JOIN photobook_settings pbs
      ON pbs.person_name = c.person_name AND pbs.product_id = c.item->>'id'
  `);
  return result.rows as unknown as RawCandidateRow[];
}

// ── Step 2: 手動追加(manual_include)のうちスキャン対象外カテゴリ（グッズ等）の商品 ──
async function fetchManualIncludeCrossCategoryRows(): Promise<RawManualRow[]> {
  const result = await db.execute(sql`
    SELECT person_name, product_id, source_category, status, published,
           home_state, home_pinned_position, sort_order, dedup_group_override,
           force_representative, note
    FROM photobook_settings
    WHERE status = 'manual_include'
      AND source_category IS NOT NULL
      AND source_category <> ALL(${textArraySql(PHOTOBOOK_SCAN_CATEGORIES)})
  `);
  return result.rows as unknown as RawManualRow[];
}

function toSettingsView(row: {
  status: string | null; published: boolean | null; home_state: string | null;
  home_pinned_position: number | null; sort_order: number | null;
  dedup_group_override: string | null; force_representative: boolean | null;
  source_category: string | null; note: string | null;
}): PhotobookSettingsView {
  return {
    status: (row.status as PhotobookStatus) ?? DEFAULT_SETTINGS.status,
    published: row.published ?? DEFAULT_SETTINGS.published,
    homeState: (row.home_state as PhotobookHomeState) ?? DEFAULT_SETTINGS.homeState,
    homePinnedPosition: row.home_pinned_position ?? null,
    sortOrder: row.sort_order ?? null,
    dedupGroupOverride: row.dedup_group_override ?? null,
    forceRepresentative: row.force_representative ?? false,
    sourceCategory: row.source_category ?? null,
    note: row.note ?? null,
  };
}

// ── Step 1+2 統合 + ステータスフィルタ ───────────────────────────────────────────
async function fetchAllCandidates(): Promise<CandidateItem[]> {
  const [autoRows, manualRows] = await Promise.all([
    fetchAutoCandidateRows(),
    fetchManualIncludeCrossCategoryRows(),
  ]);

  const result: CandidateItem[] = [];
  const seen = new Set<string>();

  for (const row of autoRows) {
    const settings = toSettingsView(row);
    const key = `${row.person_name}::${row.item.id}`;
    if (seen.has(key)) continue;
    if (settings.status === 'manual_exclude') continue;
    if (settings.status === 'auto' && !isAutoDetectedPhotobook(row.item)) continue;
    seen.add(key);
    result.push({ personName: row.person_name, item: row.item, settings });
  }

  // 手動追加(他カテゴリ)は実データを取得できたものだけ対象にする
  const manualItems = await Promise.all(
    manualRows.map(async (row) => {
      const key = `${row.person_name}::${row.product_id}`;
      if (seen.has(key)) return null;
      const item = await getStoredProductItemById(
        row.person_name,
        row.source_category as ProductCategory,
        row.product_id,
      );
      if (!item) return null;
      seen.add(key);
      return { personName: row.person_name, item, settings: toSettingsView(row) };
    }),
  );
  for (const m of manualItems) if (m) result.push(m);

  return result;
}

// ── 人物メタ解決（性別・グループ・ジャンル）──────────────────────────────────────
interface PersonResolveMaps {
  publishedNames: Set<string>;
  groupByName: Map<string, string>;
  genreByName: Map<string, string>;
  genderByName: Map<string, string | null>;
  genderByGroup: Map<string, string | null>;
  primaryGenreByName: Map<string, string | null>;
  genresByName: Map<string, string[] | null>;
}

async function buildPersonResolveMaps(): Promise<PersonResolveMaps> {
  const [persons, metaMap, groupMetas] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
    getAllGroupMetas(),
  ]);
  const publishedNames = new Set(persons.map((p) => p.name));
  const groupByName = new Map(persons.map((p) => [p.name, p.group]));
  const genreByName = new Map(persons.map((p) => [p.name, p.genre]));
  const genderByName = new Map<string, string | null>();
  const primaryGenreByName = new Map<string, string | null>();
  const genresByName = new Map<string, string[] | null>();
  for (const [name, meta] of Object.entries(metaMap)) {
    genderByName.set(name, (meta as { gender?: string }).gender ?? null);
    primaryGenreByName.set(name, meta.primaryGenre ?? null);
    genresByName.set(name, meta.genres ?? null);
  }
  const genderByGroup = new Map(groupMetas.map((g) => [g.groupName, (g as { gender?: string }).gender ?? null]));
  return { publishedNames, groupByName, genreByName, genderByName, genderByGroup, primaryGenreByName, genresByName };
}

// ── 候補 → 表示用アイテム（公開人物のみ・性別/ジャンル解決込み）────────────────────
function enrichCandidate(
  c: CandidateItem,
  maps: PersonResolveMaps,
): Omit<PhotobookItem, 'dedupKey' | 'groupSiblingCount' | 'groupProductIds'> | null {
  if (!maps.publishedNames.has(c.personName)) return null;
  const groupName = maps.groupByName.get(c.personName) ?? '';
  const personGender = maps.genderByName.get(c.personName) ?? null;
  const groupGender = groupName ? maps.genderByGroup.get(groupName) ?? null : null;
  const gender = resolvePersonGender(personGender, groupGender);
  const genreValues = [
    maps.genreByName.get(c.personName),
    maps.primaryGenreByName.get(c.personName),
    ...(maps.genresByName.get(c.personName) ?? []),
  ];
  const genreBucket = resolveGenreBucket(gender, genreValues);

  return {
    personName: c.personName,
    groupName,
    gender,
    genreBucket,
    productId: c.item.id,
    title: c.item.title ?? '',
    imageUrl: c.item.imageUrl ?? '',
    price: Number(c.item.price) || 0,
    itemUrl: c.item.itemUrl ?? '',
    affiliateUrl: c.item.affiliateUrl ?? '',
    shopName: c.item.shopName,
    status: c.settings.status,
    published: c.settings.published,
    homeState: c.settings.homeState,
    homePinnedPosition: c.settings.homePinnedPosition,
    sortOrder: c.settings.sortOrder,
  };
}

// ── 重複統合（表紙違いは別グループのまま保持）────────────────────────────────────
function dedupeItems(
  candidates: CandidateItem[],
  enriched: Map<string, ReturnType<typeof enrichCandidate>>,
): PhotobookItem[] {
  const groups = new Map<string, CandidateItem[]>();
  for (const c of candidates) {
    const key = `${c.personName}::${c.item.id}`;
    const info = enriched.get(key);
    if (!info) continue;
    const dedupKey = c.settings.dedupGroupOverride?.trim() || computeDedupKey(c.personName, c.item.title ?? '');
    if (!groups.has(dedupKey)) groups.set(dedupKey, []);
    groups.get(dedupKey)!.push(c);
  }

  const result: PhotobookItem[] = [];
  for (const [dedupKey, group] of groups) {
    const forced = group.filter((c) => c.settings.forceRepresentative);
    const repCandidate: CandidateItem = forced.length > 0
      ? forced[0]
      : group.find((c) => c.item.id === selectRepresentative(group.map((g) => g.item)).id)!;
    const info = enriched.get(`${repCandidate.personName}::${repCandidate.item.id}`);
    if (!info) continue;
    result.push({
      ...info,
      dedupKey,
      groupSiblingCount: group.length - 1,
      groupProductIds: group.map((c) => c.item.id),
    });
  }
  return result;
}

// ── メイン: 全写真集アイテム（重複統合済み）を取得 ────────────────────────────────
// 公開可否(published設定)は呼び出し側でフィルタする（管理画面は非公開も見る必要があるため）。
export async function getAllPhotobookItems(): Promise<PhotobookItem[]> {
  const [candidates, maps] = await Promise.all([fetchAllCandidates(), buildPersonResolveMaps()]);
  const enriched = new Map(
    candidates.map((c) => [`${c.personName}::${c.item.id}`, enrichCandidate(c, maps)] as const),
  );
  return dedupeItems(candidates, enriched);
}

// ── 公開ページ用: published=trueのみ ────────────────────────────────────────────
export async function getPublishedPhotobookItems(): Promise<PhotobookItem[]> {
  const all = await getAllPhotobookItems();
  return all.filter((i) => i.published);
}

// ── 管理画面用: 重複統合前の生データ（manual_exclude・非公開も含む全件）─────────
export interface PhotobookAdminRow {
  personName: string;
  groupName: string;
  gender: PhotobookGender | null;
  genreBucket: PhotobookGenreBucket;
  productId: string;
  title: string;
  imageUrl: string;
  price: number;
  itemUrl: string;
  affiliateUrl: string;
  status: PhotobookStatus;
  published: boolean;
  homeState: PhotobookHomeState;
  homePinnedPosition: number | null;
  sortOrder: number | null;
  dedupKey: string;
  isAutoDetected: boolean;
}

export async function getAdminPhotobookRows(): Promise<PhotobookAdminRow[]> {
  const [candidates, maps] = await Promise.all([fetchAllCandidatesIncludingExcluded(), buildPersonResolveMaps()]);
  const rows: PhotobookAdminRow[] = [];
  for (const c of candidates) {
    if (!maps.publishedNames.has(c.personName)) continue;
    const groupName = maps.groupByName.get(c.personName) ?? '';
    const personGender = maps.genderByName.get(c.personName) ?? null;
    const groupGender = groupName ? maps.genderByGroup.get(groupName) ?? null : null;
    const gender = resolvePersonGender(personGender, groupGender);
    const genreValues = [
      maps.genreByName.get(c.personName),
      maps.primaryGenreByName.get(c.personName),
      ...(maps.genresByName.get(c.personName) ?? []),
    ];
    rows.push({
      personName: c.personName,
      groupName,
      gender,
      genreBucket: resolveGenreBucket(gender, genreValues),
      productId: c.item.id,
      title: c.item.title ?? '',
      imageUrl: c.item.imageUrl ?? '',
      price: Number(c.item.price) || 0,
      itemUrl: c.item.itemUrl ?? '',
      affiliateUrl: c.item.affiliateUrl ?? '',
      status: c.settings.status,
      published: c.settings.published,
      homeState: c.settings.homeState,
      homePinnedPosition: c.settings.homePinnedPosition,
      sortOrder: c.settings.sortOrder,
      dedupKey: c.settings.dedupGroupOverride?.trim() || computeDedupKey(c.personName, c.item.title ?? ''),
      isAutoDetected: isAutoDetectedPhotobook(c.item),
    });
  }
  return rows;
}

// fetchAllCandidates() は auto判定に落ちた商品・manual_exclude商品を除外するが、
// 管理画面は「除外されたもの」「自動判定に漏れたもの」も確認できる必要があるため、
// フィルタなしの全候補（category='写真集'の全商品 + 手動追加した他カテゴリ商品）を返す。
async function fetchAllCandidatesIncludingExcluded(): Promise<CandidateItem[]> {
  const [autoRows, manualRows] = await Promise.all([
    fetchAutoCandidateRows(),
    fetchManualIncludeCrossCategoryRows(),
  ]);
  const result: CandidateItem[] = [];
  const seen = new Set<string>();
  for (const row of autoRows) {
    const key = `${row.person_name}::${row.item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ personName: row.person_name, item: row.item, settings: toSettingsView(row) });
  }
  const manualItems = await Promise.all(
    manualRows.map(async (row) => {
      const key = `${row.person_name}::${row.product_id}`;
      if (seen.has(key)) return null;
      const item = await getStoredProductItemById(
        row.person_name,
        row.source_category as ProductCategory,
        row.product_id,
      );
      if (!item) return null;
      seen.add(key);
      return { personName: row.person_name, item, settings: toSettingsView(row) };
    }),
  );
  for (const m of manualItems) if (m) result.push(m);
  return result;
}

const HOME_LIMIT = 8;

export interface PhotobookHomeResult {
  items: PhotobookItem[];
}

// ── ホーム表示: 固定枠 + 自動枠(分散)を合成 ──────────────────────────────────────
export async function getPhotobookHomeItems(gender: PhotobookGender, limit = HOME_LIMIT): Promise<PhotobookItem[]> {
  const all = await getPublishedPhotobookItems();
  const genderItems = all.filter((i) => i.gender === gender);

  const pinned = genderItems
    .filter((i) => i.homeState === 'pinned' && i.homePinnedPosition !== null)
    .sort((a, b) => (a.homePinnedPosition ?? 0) - (b.homePinnedPosition ?? 0));

  const autoPool = genderItems
    .filter((i) => i.homeState === 'auto')
    .sort((a, b) => {
      const bucketDiff = genreBucketOrder(gender, a.genreBucket) - genreBucketOrder(gender, b.genreBucket);
      if (bucketDiff !== 0) return bucketDiff;
      if (a.sortOrder !== null && b.sortOrder !== null && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.productId.localeCompare(b.productId);
    });
  const distributedAuto = distributeAvoidingConsecutivePerson(autoPool);

  // 固定枠を指定位置に配置し、残りを自動枠で埋める
  const slots: (PhotobookItem | null)[] = Array.from({ length: limit }, () => null);
  for (const p of pinned) {
    const pos = p.homePinnedPosition ?? 0;
    if (pos >= 0 && pos < limit && !slots[pos]) slots[pos] = p;
  }
  let autoIdx = 0;
  const usedIds = new Set(pinned.map((p) => `${p.personName}::${p.productId}`));
  for (let i = 0; i < limit; i++) {
    if (slots[i]) continue;
    while (autoIdx < distributedAuto.length && usedIds.has(`${distributedAuto[autoIdx].personName}::${distributedAuto[autoIdx].productId}`)) {
      autoIdx++;
    }
    if (autoIdx < distributedAuto.length) {
      slots[i] = distributedAuto[autoIdx];
      usedIds.add(`${distributedAuto[autoIdx].personName}::${distributedAuto[autoIdx].productId}`);
      autoIdx++;
    }
  }
  return slots.filter((s): s is PhotobookItem => s !== null);
}

// ── 一覧ページ用フィルタ ─────────────────────────────────────────────────────────
export interface PhotobookListFilters {
  gender?: PhotobookGender;
  personName?: string;
  groupName?: string;
  genreBucket?: PhotobookGenreBucket;
}

export interface PhotobookListResult {
  items: PhotobookItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const PHOTOBOOK_PAGE_SIZE = 24;

export async function getPhotobookListItems(
  filters: PhotobookListFilters,
  page: number,
): Promise<PhotobookListResult> {
  const all = await getPublishedPhotobookItems();
  let filtered = all;
  if (filters.gender) filtered = filtered.filter((i) => i.gender === filters.gender);
  if (filters.personName) filtered = filtered.filter((i) => i.personName === filters.personName);
  if (filters.groupName) filtered = filtered.filter((i) => i.groupName === filters.groupName);
  if (filters.genreBucket) filtered = filtered.filter((i) => i.genreBucket === filters.genreBucket);

  filtered = [...filtered].sort((a, b) => {
    if (a.sortOrder !== null && b.sortOrder !== null && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const bucketDiff = genreBucketOrder(a.gender ?? 'female', a.genreBucket) - genreBucketOrder(b.gender ?? 'female', b.genreBucket);
    if (bucketDiff !== 0 && filters.gender) return bucketDiff;
    return a.productId.localeCompare(b.productId);
  });

  const pageSize = PHOTOBOOK_PAGE_SIZE;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const offset = (page - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize);
  return { items, totalCount, page, pageSize, totalPages };
}

// 検索用: 写真集を1件以上持つ人物・グループの一覧（人物検索/グループ検索の候補生成用）
export async function getPhotobookFacets(): Promise<{
  persons: { name: string; group: string; gender: PhotobookGender | null }[];
  groups: { name: string; gender: PhotobookGender | null }[];
}> {
  const all = await getPublishedPhotobookItems();
  const personMap = new Map<string, { name: string; group: string; gender: PhotobookGender | null }>();
  const groupMap = new Map<string, { name: string; gender: PhotobookGender | null }>();
  for (const item of all) {
    if (!personMap.has(item.personName)) {
      personMap.set(item.personName, { name: item.personName, group: item.groupName, gender: item.gender });
    }
    if (item.groupName && !groupMap.has(item.groupName)) {
      groupMap.set(item.groupName, { name: item.groupName, gender: item.gender });
    }
  }
  return { persons: [...personMap.values()], groups: [...groupMap.values()] };
}
