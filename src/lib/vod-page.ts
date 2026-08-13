// 配信サービス別ページ（/vod/[provider]）専用のデータ取得ロジック。
//
// 重要: 「配信中として確認済みか」の判定条件は vod-dedup.ts の
// isConfirmedVodAvailability() と完全に同じ条件をSQLレベルで再現している
// （hidden除外・type='unknown'除外・AI低確度除外・終了済みサービス除外）。
// isConfirmedVodAvailability() の条件を変更した場合は、本ファイルの
// CONFIRMED_CONDITION_SQL も必ず同じ内容に更新すること。
// works.vod_data は1人物1行ごとのJSONBのため、サイト全体を横断して
// 「このprovider配信作品」を検索するには生SQL（jsonb_array_elements）が必要。
// 全件をNode側へ読み込んでからJSでフィルタすると件数が多いprovider
// （例: Hulu）で重くなるため、DB側で絞り込んだ上でページ分だけ取得する。

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { normalizeProviderName } from '@/lib/vod-dedup';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL, DISPLAY_WORK_TYPE_ICON } from '@/lib/work-display-type';
import { getWorkPublicUrl } from '@/lib/work-url';
import type { VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// ─── 対象VODサービスの設定 ────────────────────────────────────────────────────
// 公開URLのslug（disney-plus等）と、normalizeProviderName()が返す内部正規化
// スラグ（disneyplus等）は一致しないため、ここで明示的に対応付ける。
// 新しいサービスを追加する場合はこの配列に1件足すだけでよい（ページ側は共通ロジック）。
export interface VodPageProviderConfig {
  /** 公開URL用スラグ（/vod/{urlSlug}） */
  urlSlug: string;
  /** normalizeProviderName() が返す正規化済みスラグ */
  normalizedSlug: string;
  /** 画面表示用のサービス名 */
  displayName: string;
}

// 対象14サービス。表示順はユーザーが見つけやすい自然な順（Hulu/U-NEXT/Netflix等の
// 定額系を先に、TVer/YouTube/のぎ動画等の無料系を後ろに）。
// displayNameはDB上の生データ表記に関わらず、ここで指定した正式表記のみを表示する
// （例: Prime Videoの生データ表記が「Amazon Prime Video」等でもdisplayNameは常に「Prime Video」）。
export const VOD_PAGE_PROVIDERS: VodPageProviderConfig[] = [
  { urlSlug: 'hulu', normalizedSlug: normalizeProviderName('Hulu'), displayName: 'Hulu' },
  { urlSlug: 'u-next', normalizedSlug: normalizeProviderName('U-NEXT'), displayName: 'U-NEXT' },
  { urlSlug: 'netflix', normalizedSlug: normalizeProviderName('Netflix'), displayName: 'Netflix' },
  { urlSlug: 'prime-video', normalizedSlug: normalizeProviderName('Prime Video'), displayName: 'Prime Video' },
  { urlSlug: 'disney-plus', normalizedSlug: normalizeProviderName('Disney+'), displayName: 'Disney+' },
  { urlSlug: 'dmm-tv', normalizedSlug: normalizeProviderName('DMM TV'), displayName: 'DMM TV' },
  { urlSlug: 'lemino', normalizedSlug: normalizeProviderName('Lemino'), displayName: 'Lemino' },
  { urlSlug: 'fod', normalizedSlug: normalizeProviderName('FOD'), displayName: 'FOD' },
  { urlSlug: 'telasa', normalizedSlug: normalizeProviderName('TELASA'), displayName: 'TELASA' },
  { urlSlug: 'abema', normalizedSlug: normalizeProviderName('ABEMA'), displayName: 'ABEMA' },
  { urlSlug: 'tver', normalizedSlug: normalizeProviderName('TVer'), displayName: 'TVer' },
  { urlSlug: 'youtube', normalizedSlug: normalizeProviderName('YouTube'), displayName: 'YouTube' },
  { urlSlug: 'nhk-ondemand', normalizedSlug: normalizeProviderName('NHKオンデマンド'), displayName: 'NHKオンデマンド' },
  { urlSlug: 'nogidoga', normalizedSlug: normalizeProviderName('のぎ動画'), displayName: 'のぎ動画' },
];

export function getVodPageProviderConfig(urlSlug: string): VodPageProviderConfig | null {
  return VOD_PAGE_PROVIDERS.find((p) => p.urlSlug === urlSlug) ?? null;
}

export const VOD_PAGE_SIZE = 24;

// ─── pageクエリパラメータの検証 ────────────────────────────────────────────────
// searchParams由来の生の値（未指定/文字列/文字列配列）を受け取り、
// 「1以上の整数を表す文字列」のみを有効な値として扱う。
// 0・負数・小数・数字以外の文字列（例: "abc"）はすべて無効（null）とする。
// 未指定（undefined）の場合のみ1ページ目として扱う。
export function parseVodPageParam(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

// 実際に確認済み作品が1件以上存在するproviderで、総ページ数を超えるpageが
// 指定された場合のみ「範囲外」とする。totalCount=0（該当作品が1件もない）の
// 場合は範囲外ではなく、通常の空一覧表示（Section 41）を維持する。
export function isVodPageOutOfRange(page: number, totalCount: number, totalPages: number): boolean {
  return totalCount > 0 && page > totalPages;
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export interface VodPageWork {
  workId: string;
  title: string;
  releaseYear?: number;
  displayTypeLabel: string;
  displayTypeIcon: string;
  posterUrl?: string;
  availabilityType: VodProviderType;
  /** 配信確認日（vod_updated_at）。存在しない場合はundefined（架空の日付は生成しない） */
  checkedAt?: number;
  detailUrl: string;
  /** 主な出演人物（最大3名）。4名以上いる場合は totalCastCount で件数を伝える */
  mainCastNames: string[];
  totalCastCount: number;
}

export interface VodPageResult {
  works: VodPageWork[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface VodPageStats {
  workCount: number;
  personCount: number;
}

export interface VodTopPerson {
  name: string;
  group: string;
  workCount: number;
}

// ─── isConfirmedVodAvailability と同一条件のSQL断片 ───────────────────────────
// item は jsonb_array_elements(w.vod_data->'vodProviders') の1要素
// プレーンな文字列として定義し sql.raw() に渡すことで、DB接続なしにテスト側から
// 条件文そのもの（hidden除外・type='unknown'除外・AI低確度除外を含むか）を検証できるようにする。
export const CONFIRMED_CONDITION_TEXT = `
  item->>'type' <> 'unknown'
  AND COALESCE((item->>'hidden')::boolean, false) = false
  AND NOT (
    item->>'source' IN ('openai_supplement', 'openai_web_search')
    AND item->>'confidence' = 'low'
  )
`;
const CONFIRMED_CONDITION_SQL = sql.raw(CONFIRMED_CONDITION_TEXT);

// works の公開条件（既存の getPublicWorkById 等と同一）
const PUBLISHED_CONDITION_SQL = sql`w.status = 'auto_published' AND w.deleted = false`;

// 生SQLの `= ANY(...)` にJS配列をそのまま渡すとneon-httpドライバがPostgres配列
// リテラルとして解釈できずエラーになるため、ARRAY[$1,$2,...] 形式に組み立てる。
function textArraySql(names: string[]) {
  return sql`ARRAY[${sql.join(names.map((n) => sql`${n}`), sql`, `)}]::text[]`;
}

interface RawWorksRow {
  id: string;
  title: string;
  release_year: number | null;
  type: string;
  poster_url: string | null;
  manual_image_url: string | null;
  og_image_url: string | null;
  ai_data: Record<string, unknown> | null;
  vod_updated_at_ms: string | null;
  availability_type: string;
}

function mapRawRowToVodPageWork(row: RawWorksRow, castByWorkId: Map<string, string[]>): VodPageWork {
  const aiData = row.ai_data ?? {};
  const workLike: WorkRecord = {
    id: row.id,
    personName: '',
    title: row.title,
    normalizedTitle: row.title,
    type: (row.type as WorkRecord['type']) ?? 'movie',
    source: 'tmdb',
    confidenceScore: 0,
    status: 'auto_published',
    releaseYear: row.release_year ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    manualImageUrl: row.manual_image_url ?? undefined,
    ogImageUrl: row.og_image_url ?? undefined,
    workDisplayType: aiData.workDisplayType as WorkRecord['workDisplayType'],
    createdAt: 0,
    updatedAt: 0,
  };
  const displayType = getDisplayWorkType(workLike);
  const detailUrl = getWorkPublicUrl({ workId: row.id }) ?? `/work/${encodeURIComponent(row.id)}`;
  const cast = castByWorkId.get(row.id) ?? [];

  return {
    workId: row.id,
    title: row.title,
    releaseYear: row.release_year ?? undefined,
    displayTypeLabel: DISPLAY_WORK_TYPE_LABEL[displayType],
    displayTypeIcon: DISPLAY_WORK_TYPE_ICON[displayType],
    posterUrl: getRenderableWorkImageUrl(getWorkDisplayImage(workLike)),
    availabilityType: (row.availability_type as VodProviderType) ?? 'unknown',
    checkedAt: row.vod_updated_at_ms ? Number(row.vod_updated_at_ms) : undefined,
    detailUrl,
    mainCastNames: cast.slice(0, 3),
    totalCastCount: cast.length,
  };
}

// ─── メイン: ページ分の作品一覧を取得 ──────────────────────────────────────────
export async function getWorksForVodProvider(
  normalizedSlug: string,
  page: number,
): Promise<VodPageResult> {
  const pageSize = VOD_PAGE_SIZE;
  const empty: VodPageResult = { works: [], totalCount: 0, page, pageSize, totalPages: 0 };

  // 終了済み・非アクティブに設定されているサービスの場合は空状態を返す
  const terminatedSlugs = await getInactiveProviderSlugs();
  if (terminatedSlugs.has(normalizedSlug)) return empty;

  // Stage 1: サイト全体で実際に使われているproviderName文字列のうち、
  // normalizeProviderName() の結果が対象サービスと一致するものだけを集める
  // （295件程度の少数distinct値のため軽量。既存の正規化ロジックをそのまま使う）
  const distinctResult = await db.execute(sql`
    SELECT DISTINCT item->>'providerName' AS provider_name
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL} AND item->>'providerName' IS NOT NULL
  `);
  const matchingRawNames = (distinctResult.rows as Array<{ provider_name: string }>)
    .map((r) => r.provider_name)
    .filter((name) => normalizeProviderName(name) === normalizedSlug);

  if (matchingRawNames.length === 0) return empty;

  // Stage 2: 対象作品を絞り込み、件数と1ページ分を取得
  const countResult = await db.execute(sql`
    SELECT COUNT(DISTINCT w.id) AS cnt
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL}
      AND item->>'providerName' = ANY(${textArraySql(matchingRawNames)})
      AND ${CONFIRMED_CONDITION_SQL}
  `);
  const totalCount = Number((countResult.rows[0] as { cnt: string })?.cnt ?? 0);
  if (totalCount === 0) return empty;

  const offset = (page - 1) * pageSize;
  const listResult = await db.execute(sql`
    WITH matched AS (
      SELECT DISTINCT ON (w.id)
        w.id, w.title, w.release_year, w.type, w.poster_url, w.manual_image_url,
        w.og_image_url, w.ai_data,
        (w.vod_data->>'vodUpdatedAt') AS vod_updated_at_ms,
        item->>'type' AS availability_type
      FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
      WHERE ${PUBLISHED_CONDITION_SQL}
        AND item->>'providerName' = ANY(${textArraySql(matchingRawNames)})
        AND ${CONFIRMED_CONDITION_SQL}
      ORDER BY w.id, (w.vod_data->>'vodUpdatedAt')::bigint DESC NULLS LAST
    )
    SELECT * FROM matched
    ORDER BY vod_updated_at_ms::bigint DESC NULLS LAST, release_year DESC NULLS LAST, id ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  const rows = listResult.rows as unknown as RawWorksRow[];
  const totalPages = Math.ceil(totalCount / pageSize);
  // totalCount > 0 でも、範囲外のpage（総ページ数を超える等）を指定された場合は
  // このページ分の行が0件になりうる。その場合も totalCount/totalPages は実際の値を
  // 維持したまま返す（呼び出し側の isVodPageOutOfRange() が正しく判定できるようにするため）。
  if (rows.length === 0) return { works: [], totalCount, page, pageSize, totalPages };

  // 主な出演人物をまとめて1クエリで取得（N+1防止）
  const workIds = rows.map((r) => r.id);
  const castResult = await db.execute(sql`
    SELECT id, person_name
    FROM works
    WHERE id = ANY(${textArraySql(workIds)}) AND status = 'auto_published' AND deleted = false
    ORDER BY person_name
  `);
  const castByWorkId = new Map<string, string[]>();
  for (const r of castResult.rows as Array<{ id: string; person_name: string }>) {
    const list = castByWorkId.get(r.id) ?? [];
    if (!list.includes(r.person_name)) list.push(r.person_name);
    castByWorkId.set(r.id, list);
  }

  return {
    works: rows.map((r) => mapRawRowToVodPageWork(r, castByWorkId)),
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

// ─── 概要カード用の件数（作品数・関連人物数） ─────────────────────────────────
export async function getVodProviderStats(normalizedSlug: string): Promise<VodPageStats> {
  const empty: VodPageStats = { workCount: 0, personCount: 0 };

  const terminatedSlugs = await getInactiveProviderSlugs();
  if (terminatedSlugs.has(normalizedSlug)) return empty;

  const distinctResult = await db.execute(sql`
    SELECT DISTINCT item->>'providerName' AS provider_name
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL} AND item->>'providerName' IS NOT NULL
  `);
  const matchingRawNames = (distinctResult.rows as Array<{ provider_name: string }>)
    .map((r) => r.provider_name)
    .filter((name) => normalizeProviderName(name) === normalizedSlug);
  if (matchingRawNames.length === 0) return empty;

  const statsResult = await db.execute(sql`
    SELECT COUNT(DISTINCT w.id) AS work_count, COUNT(DISTINCT w.person_name) AS person_count
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL}
      AND item->>'providerName' = ANY(${textArraySql(matchingRawNames)})
      AND ${CONFIRMED_CONDITION_SQL}
  `);
  const row = statsResult.rows[0] as { work_count: string; person_count: string } | undefined;
  return {
    workCount: Number(row?.work_count ?? 0),
    personCount: Number(row?.person_count ?? 0),
  };
}

// ─── 「このサービスで配信作品がある人物」上位N名 ──────────────────────────────
export async function getTopPersonsForVodProvider(
  normalizedSlug: string,
  limit: number,
): Promise<VodTopPerson[]> {
  const terminatedSlugs = await getInactiveProviderSlugs();
  if (terminatedSlugs.has(normalizedSlug)) return [];

  const distinctResult = await db.execute(sql`
    SELECT DISTINCT item->>'providerName' AS provider_name
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL} AND item->>'providerName' IS NOT NULL
  `);
  const matchingRawNames = (distinctResult.rows as Array<{ provider_name: string }>)
    .map((r) => r.provider_name)
    .filter((name) => normalizeProviderName(name) === normalizedSlug);
  if (matchingRawNames.length === 0) return [];

  const result = await db.execute(sql`
    SELECT w.person_name, COUNT(DISTINCT w.id) AS work_count
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL}
      AND item->>'providerName' = ANY(${textArraySql(matchingRawNames)})
      AND ${CONFIRMED_CONDITION_SQL}
    GROUP BY w.person_name
    ORDER BY work_count DESC, w.person_name ASC
    LIMIT ${limit}
  `);
  return (result.rows as Array<{ person_name: string; work_count: string }>).map((r) => ({
    name: r.person_name,
    group: '',
    workCount: Number(r.work_count),
  }));
}

// ─── 全provider横断の作品数（トップページ・sitemap用、0件providerの除外判定専用） ──
// トップページ・sitemapで「対象サービスが増えても重いCOUNTクエリを何度も投げない」
// ため、1回のSQLで(providerName, workId)の組をまとめて取得し、JS側で
// normalizeProviderName() によりVOD_PAGE_PROVIDERSの各サービスへ集計する。
// 注意: 同一サービスに複数の表記ゆれ（例: Netflix / Netflix Standard with Ads）が
// あり、同じ作品が両方に該当する場合に二重カウントしないよう、providerNameごとの
// 件数を単純合算するのではなく、workIdをSetに集めてからサイズを数える
// （既存の単一provider向け関数がCOUNT(DISTINCT w.id)で行っているのと同じ考え方）。
// 個々のVODページ（getVodProviderStats等）とは別関数とし、そちらの挙動は変更しない。
export async function getVodProviderWorkCounts(): Promise<Map<string, number>> {
  // Stage 1: 対象14サービスのいずれかに一致するraw providerName一覧を絞り込む
  // （既存の各関数と同じ2段階パターン。295件程度のdistinct値なので軽量）。
  const distinctResult = await db.execute(sql`
    SELECT DISTINCT item->>'providerName' AS provider_name
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL} AND item->>'providerName' IS NOT NULL
  `);
  const allRawNames = (distinctResult.rows as Array<{ provider_name: string }>).map((r) => r.provider_name);
  const targetSlugs = new Set(VOD_PAGE_PROVIDERS.map((p) => p.normalizedSlug));
  const matchingRawNames = allRawNames.filter((name) => targetSlugs.has(normalizeProviderName(name)));

  const counts = new Map<string, number>();
  for (const p of VOD_PAGE_PROVIDERS) counts.set(p.normalizedSlug, 0);
  if (matchingRawNames.length === 0) return counts;

  // Stage 2: 対象サービスに該当する (providerName, workId) の組だけをまとめて取得
  const pairResult = await db.execute(sql`
    SELECT DISTINCT item->>'providerName' AS provider_name, w.id AS work_id
    FROM works w, jsonb_array_elements(w.vod_data->'vodProviders') AS item
    WHERE ${PUBLISHED_CONDITION_SQL}
      AND item->>'providerName' = ANY(${textArraySql(matchingRawNames)})
      AND ${CONFIRMED_CONDITION_SQL}
  `);

  const workIdsBySlug = new Map<string, Set<string>>();
  for (const row of pairResult.rows as Array<{ provider_name: string; work_id: string }>) {
    const slug = normalizeProviderName(row.provider_name);
    if (!targetSlugs.has(slug)) continue;
    const set = workIdsBySlug.get(slug) ?? new Set<string>();
    set.add(row.work_id);
    workIdsBySlug.set(slug, set);
  }
  for (const [slug, workIds] of workIdsBySlug) counts.set(slug, workIds.size);
  return counts;
}
