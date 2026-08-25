// 写真集機能: DB問い合わせ層。
//
// 商品本体は既存の products テーブル（personName, category, items JSONB）を single
// source of truth として利用する（二重保存しない）。photobook_settings は表示設定・
// 例外設定だけを持つ。人物の公開判定・グループ紐付けは既存の getAllPersonsMerged() 等を
// そのまま再利用する（このファイルで独自の「公開条件」を作らない）。
//
// OpenAI等の外部AIは一切呼び出さない。判定は photobook.ts の決定的ルールのみで行う。
//
// 重複統合（2026-改訂）:
//   グループ写真集（乃木撮/日向撮/櫻撮/M!LK写真集等）は、所属メンバー全員の商品データに
//   独立して同一のRakuten商品IDで紐づいていることが実データで確認された。従来の
//   「人物＋正規化タイトル」だけのキーでは、同一商品でも人物が違うだけで別グループに
//   分かれてしまうため、photobook.ts の groupPhotobookCandidates()（productId完全一致に
//   よる人物またぎ統合）を使って2段階で統合する。詳細は photobook.ts のコメント参照。

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { getAllPersonsMerged } from './persons';
import { getAllPersonMetas } from './person-meta';
import { getAllGroupMetas } from './group-meta';
import { getStoredProductItemById } from './product-store';
import { groupHrefByName } from './group-slug';
import {
  isAutoDetectedPhotobook,
  selectRepresentative,
  resolvePersonGender,
  resolveGenreBucket,
  genreBucketOrder,
  distributeAvoidingConsecutivePerson,
  groupPhotobookCandidates,
  resolveDisplayLabel,
  aggregatePhotobookSettings,
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
//
// 除外したカテゴリ:
//   - 中古        : ユーザー指定により常に除外
//   - グッズ      : タイトルがタグ羅列型で「グッズ」という除外語自体が定型タグとして
//                    頻出するため、誤除外/誤検出の衝突リスクが高いと判断し除外。
//                    該当商品は管理画面から手動追加できる。
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

// 内部表現: 1商品×1人物の紐付け = 1候補（重複統合前）
interface CandidateItem {
  personName: string;
  item: RakutenItem;
  settings: PhotobookSettingsView;
}

/** 管理操作(manual_include/exclude・公開・ホーム設定等)の反映先 (personName, productId) 組 */
export interface PhotobookSettingsTarget {
  personName: string;
  productId: string;
}

export interface PhotobookItem {
  /** 代表人物名（displayMode='person'のときの表示名、group時も内部参照用に保持） */
  personName: string;
  groupName: string;
  /** カードに表示する名前（'group'時はグループ名、'person'時は代表人物名） */
  displayName: string;
  displayMode: 'group' | 'person';
  /** 表示名クリック時の遷移先（グループページ or 人物ページ） */
  displayHref: string;
  /** この商品(productId)に紐づく全人物名（人物検索のマッチングに使用） */
  linkedPersonNames: string[];
  /** 紐づく人物が所属する全グループ名（グループ検索のマッチングに使用） */
  linkedGroupNames: string[];
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
  /** 同一重複グループ内で統合された他商品の件数（代表商品自身を除く） */
  groupSiblingCount: number;
  /** 同一重複グループ内の全商品ID（重複候補確認用） */
  groupProductIds: string[];
  /** 管理操作の反映先。同一グループ内の全(personName,productId)組（fan-out書き込み用） */
  settingsTargets: PhotobookSettingsTarget[];
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

async function fetchCandidatesRaw(): Promise<{ autoRows: RawCandidateRow[]; manualRows: RawManualRow[] }> {
  const [autoRows, manualRows] = await Promise.all([
    fetchAutoCandidateRows(),
    fetchManualIncludeCrossCategoryRows(),
  ]);
  return { autoRows, manualRows };
}

async function toCandidateItems(autoRows: RawCandidateRow[], manualRows: RawManualRow[]): Promise<CandidateItem[]> {
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

// 公開側（写真集一覧・ホーム）: auto判定に落ちた商品・manual_exclude商品を除外する
async function fetchAllCandidates(): Promise<CandidateItem[]> {
  const { autoRows, manualRows } = await fetchCandidatesRaw();
  const all = await toCandidateItems(autoRows, manualRows);
  return all.filter((c) => {
    if (c.settings.status === 'manual_exclude') return false;
    if (c.settings.status === 'auto' && !isAutoDetectedPhotobook(c.item)) return false;
    return true;
  });
}

// 管理画面用: 「除外されたもの」「自動判定に漏れたもの(手動追加候補)」も確認できるよう、
// manual_include/manual_exclude（明示的な手動設定がある商品）はステータスに関わらず含める。
// status='auto'かつisAutoDetectedPhotobook()=falseの商品（写真集シグナルを一切持たない
// CD/Blu-ray等）は除外する（自動判定に一度も乗っていない無関係な商品を大量表示しないため）。
async function fetchAllCandidatesForAdmin(): Promise<CandidateItem[]> {
  const { autoRows, manualRows } = await fetchCandidatesRaw();
  const all = await toCandidateItems(autoRows, manualRows);
  return all.filter((c) => {
    if (c.settings.status !== 'auto') return true;
    return isAutoDetectedPhotobook(c.item);
  });
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
  groupMetas: Awaited<ReturnType<typeof getAllGroupMetas>>;
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
  return {
    publishedNames, groupByName, genreByName, genderByName, genderByGroup,
    primaryGenreByName, genresByName, groupMetas,
  };
}

// ── 候補 → 重複統合済みアイテム一覧 ─────────────────────────────────────────────
function buildGroupedItems(candidates: CandidateItem[], maps: PersonResolveMaps): PhotobookItem[] {
  const published = candidates.filter((c) => maps.publishedNames.has(c.personName));
  const groupableInputs = published.map((c) => ({
    personName: c.personName,
    productId: c.item.id,
    title: c.item.title ?? '',
    dedupGroupOverride: c.settings.dedupGroupOverride,
  }));
  const indexGroups = groupPhotobookCandidates(groupableInputs);

  const result: PhotobookItem[] = [];
  for (const idxs of indexGroups) {
    const group = idxs.map((i) => published[i]);

    // 代表商品（表示に使う画像/価格/URL）を選ぶ: forceRepresentative優先、
    // なければ「ユニークな商品」の中からselectRepresentativeで選定
    // （同一productIdの複数人物紐付けは同一商品データのため重複排除してから選ぶ）
    const forced = group.filter((c) => c.settings.forceRepresentative);
    let repCandidate: CandidateItem;
    if (forced.length > 0) {
      repCandidate = forced[0];
    } else {
      const uniqueItemsById = new Map<string, RakutenItem>();
      for (const c of group) if (!uniqueItemsById.has(c.item.id)) uniqueItemsById.set(c.item.id, c.item);
      const repItem = selectRepresentative([...uniqueItemsById.values()]);
      repCandidate = group.find((c) => c.item.id === repItem.id)!;
    }

    const linkedPersonNames = [...new Set(group.map((c) => c.personName))];
    const linkedGroupNames = [...new Set(
      linkedPersonNames.map((n) => maps.groupByName.get(n) ?? '').filter((g): g is string => !!g),
    )];

    const label = resolveDisplayLabel(linkedPersonNames, maps.groupByName, repCandidate.personName);

    // 性別解決: グループ代表表示のときはグループのgenderを優先的に使う
    // （個々のメンバーのpersonMeta.gender上書きは、グループ全体を代表する1枚のカードには
    // 適用しない。ジャンル・名前からの推測は一切行わない）。
    let gender: PhotobookGender | null;
    let genreValues: (string | null | undefined)[];
    if (label.mode === 'group' && label.groupName) {
      gender = resolvePersonGender(undefined, maps.genderByGroup.get(label.groupName) ?? null);
      const genreSet = new Set<string | null | undefined>();
      for (const name of linkedPersonNames) {
        genreSet.add(maps.genreByName.get(name));
        genreSet.add(maps.primaryGenreByName.get(name));
        for (const g of maps.genresByName.get(name) ?? []) genreSet.add(g);
      }
      genreValues = [...genreSet];
    } else {
      const personGender = maps.genderByName.get(repCandidate.personName) ?? null;
      const repGroupName = maps.groupByName.get(repCandidate.personName) ?? '';
      const groupGender = repGroupName ? maps.genderByGroup.get(repGroupName) ?? null : null;
      gender = resolvePersonGender(personGender, groupGender);
      genreValues = [
        maps.genreByName.get(repCandidate.personName),
        maps.primaryGenreByName.get(repCandidate.personName),
        ...(maps.genresByName.get(repCandidate.personName) ?? []),
      ];
    }
    const genreBucket = resolveGenreBucket(gender, genreValues);

    const agg = aggregatePhotobookSettings(group.map((c) => c.settings));

    const displayHref = label.mode === 'group' && label.groupName
      ? groupHrefByName(label.groupName, maps.groupMetas)
      : `/person/${encodeURIComponent(label.displayName)}`;

    const settingsTargets: PhotobookSettingsTarget[] = [...new Map(
      group.map((c) => [`${c.personName}::${c.item.id}`, { personName: c.personName, productId: c.item.id }]),
    ).values()];

    result.push({
      personName: repCandidate.personName,
      groupName: maps.groupByName.get(repCandidate.personName) ?? '',
      displayName: label.displayName,
      displayMode: label.mode,
      displayHref,
      linkedPersonNames,
      linkedGroupNames,
      gender,
      genreBucket,
      productId: repCandidate.item.id,
      title: repCandidate.item.title ?? '',
      imageUrl: repCandidate.item.imageUrl ?? '',
      price: Number(repCandidate.item.price) || 0,
      itemUrl: repCandidate.item.itemUrl ?? '',
      affiliateUrl: repCandidate.item.affiliateUrl ?? '',
      shopName: repCandidate.item.shopName,
      status: agg.status,
      published: agg.published,
      homeState: agg.homeState,
      homePinnedPosition: agg.homePinnedPosition,
      sortOrder: agg.sortOrder,
      groupSiblingCount: group.length - 1,
      groupProductIds: [...new Set(group.map((c) => c.item.id))],
      settingsTargets,
    });
  }
  return result;
}

// ── メイン: 全写真集アイテム（重複統合済み）を取得 ────────────────────────────────
// 公開可否(published設定)は呼び出し側でフィルタする（管理画面は非公開も見る必要があるため）。
export async function getAllPhotobookItems(): Promise<PhotobookItem[]> {
  const [candidates, maps] = await Promise.all([fetchAllCandidates(), buildPersonResolveMaps()]);
  return buildGroupedItems(candidates, maps);
}

// ── 公開ページ用: published=trueのみ ────────────────────────────────────────────
export async function getPublishedPhotobookItems(): Promise<PhotobookItem[]> {
  const all = await getAllPhotobookItems();
  return all.filter((i) => i.published);
}

// ── 管理画面用: 重複統合済み（manual_exclude・非公開も含む）─────────────────────
export type PhotobookAdminRow = PhotobookItem & { isAutoDetected: boolean };

export async function getAdminPhotobookRows(): Promise<PhotobookAdminRow[]> {
  const [candidates, maps] = await Promise.all([fetchAllCandidatesForAdmin(), buildPersonResolveMaps()]);
  const items = buildGroupedItems(candidates, maps);
  // isAutoDetected: グループ内のいずれかの商品が実際に自動判定に合格していたか
  // （productId統合の場合は基本的に全員同じ商品なので一致するが、念のためOR判定にする）
  const byProductIdAutoDetected = new Map<string, boolean>();
  for (const c of candidates) {
    const cur = byProductIdAutoDetected.get(c.item.id) ?? false;
    byProductIdAutoDetected.set(c.item.id, cur || isAutoDetectedPhotobook(c.item));
  }
  return items.map((item) => ({
    ...item,
    isAutoDetected: item.groupProductIds.some((id) => byProductIdAutoDetected.get(id) ?? false),
  }));
}

const HOME_LIMIT = 8;

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
  // 同一人物の連続を避ける分散は displayName（グループ代表時はグループ名）単位で行う
  const distributedAuto = distributeAvoidingConsecutivePerson(
    autoPool.map((i) => ({ ...i, personName: i.displayName })),
  ) as PhotobookItem[];

  const slots: (PhotobookItem | null)[] = Array.from({ length: limit }, () => null);
  for (const p of pinned) {
    const pos = p.homePinnedPosition ?? 0;
    if (pos >= 0 && pos < limit && !slots[pos]) slots[pos] = p;
  }
  let autoIdx = 0;
  const usedIds = new Set(pinned.map((p) => p.productId));
  for (let i = 0; i < limit; i++) {
    if (slots[i]) continue;
    while (autoIdx < distributedAuto.length && usedIds.has(distributedAuto[autoIdx].productId)) {
      autoIdx++;
    }
    if (autoIdx < distributedAuto.length) {
      slots[i] = distributedAuto[autoIdx];
      usedIds.add(distributedAuto[autoIdx].productId);
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
  // 人物検索: 統合前にそのproductIdへ紐づいていた人物なら誰でもヒットする
  // （グループ代表表示になっていても、個々のメンバー名で検索すればヒットする）
  if (filters.personName) filtered = filtered.filter((i) => i.linkedPersonNames.includes(filters.personName!));
  // グループ検索: 紐づく人物のいずれかが該当グループに所属していればヒットする
  if (filters.groupName) filtered = filtered.filter((i) => i.linkedGroupNames.includes(filters.groupName!));
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
  const [all, maps] = await Promise.all([getPublishedPhotobookItems(), buildPersonResolveMaps()]);
  const personMap = new Map<string, { name: string; group: string; gender: PhotobookGender | null }>();
  const groupMap = new Map<string, { name: string; gender: PhotobookGender | null }>();
  for (const item of all) {
    for (const name of item.linkedPersonNames) {
      if (!personMap.has(name)) {
        personMap.set(name, { name, group: maps.groupByName.get(name) ?? '', gender: item.gender });
      }
    }
    for (const g of item.linkedGroupNames) {
      if (!groupMap.has(g)) groupMap.set(g, { name: g, gender: item.gender });
    }
  }
  return { persons: [...personMap.values()], groups: [...groupMap.values()] };
}
