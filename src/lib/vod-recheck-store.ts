// VOD再確認 一覧のためのDBアクセス層（Neon Postgres・サーバー側ページング）
//
// works テーブルは (person_name, id) が複合主キーのため、同一 workId に複数人物の行が
// 存在しうる（例: 複数人が出演する作品）。VOD確認状態は行ごとに独立して保持されているが、
// 実運用上は同一作品であれば同じ内容が入る想定のため、既存の公開ページ（グループページ等）
// と同様に「workId ごとに代表1行を採用する」方式を踏襲する（DISTINCT ON (id) で
// person_name 昇順の先頭行を代表とする＝決定的）。出演者数は別途 COUNT(DISTINCT person_name)
// で集計する。
//
// 再確認理由の判定条件（180日ルール・有効VODなし等）は SQL 側の WHERE 句で表現し、
// 全件取得してからJavaScriptで絞り込むことはしない。ただし vod_data は JSONB で
// 通常カラムのインデックスが効かないため、この WHERE 句は works テーブルの Seq Scan を伴う
// （EXPLAIN で確認済み・レポートに記載）。管理画面専用ページのため許容範囲と判断した。

import { neonSql } from '@/db/client';
import { getRedis } from '@/lib/redis';
import type { VodProvider } from '@/types/vod';
import type { RecheckReasonCode, RecheckPriority } from '@/lib/vod-recheck';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const RECHECK_STALE_MS = 180 * 24 * 60 * 60 * 1000;

export interface RecheckCandidateRow {
  personName: string;
  workId: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  vodProviders: VodProvider[];
  lastVodCheckAt?: number;
  vodAiCheckedAt?: number;
  vodCheckStatus?: string;
  personCount: number;
  mergedAt?: number;
}

export interface RecheckListParams {
  page: number;
  pageSize: number;
  search?: string;
  workId?: string;
  reason?: RecheckReasonCode;
  priority?: RecheckPriority;
  /** 「アクセス上位」フィルタ・優先度算出用に外部(Redis)で計算したworkId集合 */
  highTrafficWorkIds?: string[];
}

export function clampPage(page: number): number {
  return Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
}

export function clampPageSize(pageSize: number): number {
  const n = Math.floor(Number.isFinite(pageSize) ? pageSize : DEFAULT_PAGE_SIZE);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, n));
}

// ── 理由コード → SQL条件フラグメント ──────────────────────────────────────────
// 各フラグメントは vod_data 列 (w.vod_data) を参照する。すべて neonSql タグ付きテンプレート
// のみで組み立て、文字列連結によるSQLインジェクションのリスクを避ける。

const ACTIVE_PROVIDER_EXISTS = neonSql`
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true'
      AND lower(COALESCE(p->>'providerName', '')) NOT IN ('', 'unknown')
      AND COALESCE(p->>'type', '') NOT IN ('', 'unknown')
  )
`;

const VISIBLE_PROVIDER_EXISTS = neonSql`
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true'
  )
`;

// dTV/GYAO!/Paravi の代表的な表記のみを対象とする簡易チェック。
// 完全な正規化（normalizeProviderName）はJS側でのみ行い、ここでは候補抽出の近似として使う。
const DEPRECATED_PROVIDER_EXISTS = neonSql`
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true'
      AND lower(COALESCE(p->>'providerName', '')) IN ('dtv', 'gyao', 'gyao!', 'paravi')
  )
`;

const MISSING_SOURCE_EXISTS = neonSql`
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true'
      AND lower(COALESCE(p->>'providerName', '')) NOT IN ('', 'unknown')
      AND COALESCE(p->>'type', '') NOT IN ('', 'unknown')
      AND COALESCE(p->>'sourceUrl', '') = ''
      AND COALESCE(p->>'officialUrl', '') = ''
      AND COALESCE(p->>'link', '') = ''
  )
`;

const LOW_CONFIDENCE_EXISTS = neonSql`
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true' AND p->>'confidence' = 'low'
  )
`;

const INCONSISTENT_CHECKED_AT = neonSql`
  (
    SELECT COUNT(DISTINCT p->>'checkedDate')
    FROM jsonb_array_elements(COALESCE(w.vod_data->'vodProviders', '[]'::jsonb)) p
    WHERE COALESCE(p->>'hidden', 'false') != 'true' AND p->>'checkedDate' IS NOT NULL
  ) >= 2
`;

function lastCheckExpr() {
  return neonSql`GREATEST(COALESCE((w.vod_data->>'lastVodCheckAt')::bigint, 0), COALESCE((w.vod_data->>'vodAiCheckedAt')::bigint, 0))`;
}

function neverCheckedFrag() {
  return neonSql`(${lastCheckExpr()} = 0)`;
}

function staleFrag() {
  return neonSql`(${lastCheckExpr()} > 0 AND ${lastCheckExpr()} < ${Date.now() - RECHECK_STALE_MS}::bigint)`;
}

function noActiveProviderFrag() {
  return neonSql`(NOT ${ACTIVE_PROVIDER_EXISTS})`;
}

function unknownOnlyFrag() {
  return neonSql`(${VISIBLE_PROVIDER_EXISTS} AND NOT ${ACTIVE_PROVIDER_EXISTS})`;
}

function deprecatedProviderFrag() {
  return DEPRECATED_PROVIDER_EXISTS;
}

function missingSourceFrag() {
  return MISSING_SOURCE_EXISTS;
}

function lowConfidenceFrag() {
  return LOW_CONFIDENCE_EXISTS;
}

function inconsistentCheckedAtFrag() {
  return INCONSISTENT_CHECKED_AT;
}

function postMergeUncheckedFrag() {
  // al.merged_at は LEFT JOIN 済みのエイリアス作成日時（別テーブル）
  return neonSql`(al.merged_at IS NOT NULL AND (${lastCheckExpr()} = 0 OR ${lastCheckExpr()} < (EXTRACT(EPOCH FROM al.merged_at) * 1000)::bigint))`;
}

function highTrafficFrag(workIds: string[]) {
  if (workIds.length === 0) return neonSql`FALSE`;
  return neonSql`(w.id = ANY(${workIds}))`;
}

function reasonFrag(reason: RecheckReasonCode, highTrafficWorkIds: string[]) {
  switch (reason) {
    case 'never_checked': return neverCheckedFrag();
    case 'stale_180_days': return staleFrag();
    case 'no_active_provider': return noActiveProviderFrag();
    case 'unknown_only': return unknownOnlyFrag();
    case 'deprecated_provider': return deprecatedProviderFrag();
    case 'missing_source': return missingSourceFrag();
    case 'low_confidence': return lowConfidenceFrag();
    case 'inconsistent_checked_at': return inconsistentCheckedAtFrag();
    case 'post_merge_unchecked': return postMergeUncheckedFrag();
    case 'high_traffic': return highTrafficFrag(highTrafficWorkIds);
  }
}

// computeRecheckPriority() と同じ組み合わせロジックをSQLで再現する
function priorityFrag(priority: RecheckPriority, highTrafficWorkIds: string[]) {
  const hi = highTrafficFrag(highTrafficWorkIds);
  const stale = staleFrag();
  const unknownOnly = unknownOnlyFrag();
  const noActive = noActiveProviderFrag();
  const neverChecked = neverCheckedFrag();
  const deprecated = deprecatedProviderFrag();
  const postMerge = postMergeUncheckedFrag();
  const missingSource = missingSourceFrag();
  const lowConfidence = lowConfidenceFrag();
  const inconsistent = inconsistentCheckedAtFrag();

  const critical = neonSql`(${hi} AND (${stale} OR ${unknownOnly} OR ${noActive}))`;
  const high = neonSql`(${neverChecked} OR ${deprecated} OR ${postMerge} OR ${stale})`;
  const medium = neonSql`(${missingSource} OR ${lowConfidence} OR ${inconsistent})`;

  switch (priority) {
    case 'critical': return critical;
    case 'high': return neonSql`(NOT ${critical} AND (${high}))`;
    case 'medium': return neonSql`(NOT ${critical} AND NOT (${high}) AND (${medium}))`;
    case 'low': return neonSql`(NOT ${critical} AND NOT (${high}) AND NOT (${medium}))`;
  }
}

// 候補となる条件（この機能が対象とする「再確認理由が1つ以上ある」作品）
function candidacyFrag(highTrafficWorkIds: string[]) {
  return neonSql`(
    ${staleFrag()} OR ${neverCheckedFrag()} OR ${noActiveProviderFrag()} OR ${unknownOnlyFrag()}
    OR ${deprecatedProviderFrag()} OR ${missingSourceFrag()} OR ${lowConfidenceFrag()}
    OR ${inconsistentCheckedAtFrag()} OR ${postMergeUncheckedFrag()} OR ${highTrafficFrag(highTrafficWorkIds)}
  )`;
}

interface QueryResult {
  rows: RecheckCandidateRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getRecheckCandidates(params: RecheckListParams): Promise<QueryResult> {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const offset = (page - 1) * pageSize;
  const search = (params.search ?? '').trim();
  const workIdSearch = (params.workId ?? '').trim();
  const highTrafficWorkIds = params.highTrafficWorkIds ?? [];

  const extraFilter = params.reason
    ? neonSql`AND ${reasonFrag(params.reason, highTrafficWorkIds)}`
    : params.priority
      ? neonSql`AND ${priorityFrag(params.priority, highTrafficWorkIds)}`
      : neonSql``;

  const searchFilter = search
    ? neonSql`AND (w.title ILIKE ${'%' + search + '%'} OR w.id ILIKE ${'%' + search + '%'})`
    : neonSql``;
  const workIdFilter = workIdSearch ? neonSql`AND w.id ILIKE ${'%' + workIdSearch + '%'}` : neonSql``;

  const rows = await neonSql`
    WITH representative AS (
      SELECT DISTINCT ON (id)
        id, person_name, title, type, release_year, vod_data
      FROM works
      WHERE status = 'auto_published' AND deleted = false
      ORDER BY id, person_name
    )
    SELECT w.*, al.merged_at
    FROM representative w
    LEFT JOIN (
      SELECT canonical_work_id, MAX(created_at) AS merged_at
      FROM work_aliases
      GROUP BY canonical_work_id
    ) al ON al.canonical_work_id = w.id
    WHERE ${candidacyFrag(highTrafficWorkIds)}
      ${extraFilter}
      ${searchFilter}
      ${workIdFilter}
    ORDER BY id
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const countRows = await neonSql`
    WITH representative AS (
      SELECT DISTINCT ON (id)
        id, title, vod_data
      FROM works
      WHERE status = 'auto_published' AND deleted = false
      ORDER BY id, person_name
    )
    SELECT COUNT(*)::int AS total
    FROM representative w
    LEFT JOIN (
      SELECT canonical_work_id, MAX(created_at) AS merged_at
      FROM work_aliases
      GROUP BY canonical_work_id
    ) al ON al.canonical_work_id = w.id
    WHERE ${candidacyFrag(highTrafficWorkIds)}
      ${extraFilter}
      ${searchFilter}
      ${workIdFilter}
  `;

  const workIds = rows.map((r) => r.id as string);
  const personCountRows = workIds.length > 0
    ? await neonSql`
        SELECT id AS work_id, COUNT(DISTINCT person_name)::int AS person_count
        FROM works
        WHERE id = ANY(${workIds}) AND status = 'auto_published' AND deleted = false
        GROUP BY id
      `
    : [];

  const personCountMap = new Map<string, number>(
    personCountRows.map((r) => [r.work_id as string, r.person_count as number]),
  );

  const candidateRows: RecheckCandidateRow[] = rows.map((r) => {
    const vodData = (r.vod_data ?? {}) as Record<string, unknown>;
    return {
      personName: r.person_name as string,
      workId: r.id as string,
      title: r.title as string,
      workType: r.type as string,
      releaseYear: (r.release_year as number | null) ?? null,
      vodProviders: (vodData.vodProviders as VodProvider[] | undefined) ?? [],
      lastVodCheckAt: vodData.lastVodCheckAt as number | undefined,
      vodAiCheckedAt: vodData.vodAiCheckedAt as number | undefined,
      vodCheckStatus: vodData.vodCheckStatus as string | undefined,
      personCount: personCountMap.get(r.id as string) ?? 1,
      mergedAt: r.merged_at ? new Date(r.merged_at as string).getTime() : undefined,
    };
  });

  return {
    rows: candidateRows,
    total: (countRows[0]?.total as number) ?? 0,
    page,
    pageSize,
  };
}

// ── アクセス数（Redis work:click:*） ──────────────────────────────────────────
// src/lib/ranking.ts と同じキー形式・SCANパターンを再利用する。
// Redis未設定・接続失敗時は空のMapを返す（一覧表示自体は継続できる= Redis失敗時の graceful degradation）。

export async function getClickCountsForWorkIds(workIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (workIds.length === 0) return map;
  const redis = getRedis();
  if (!redis) return map;
  try {
    const keys = workIds.map((id) => `work:click:${id}`);
    const counts = await redis.mget<(string | null)[]>(...keys);
    workIds.forEach((id, i) => {
      const c = parseInt(String(counts[i] ?? '0'), 10) || 0;
      if (c > 0) map.set(id, c);
    });
  } catch (err) {
    console.error('[vod-recheck-store] getClickCountsForWorkIds failed:', err);
  }
  return map;
}

// クリック数が1件以上ある作品のうち、上位20%（相対順位）を「アクセス上位」とみなす。
// 絶対的なクリック数のしきい値を推測で決め打ちしない（実データの分布に応じて自動調整される）。
// 母数が少ない場合に0件にならないよう最低20件・SQLのANY配列が肥大化しないよう最大500件に丸める。
const HIGH_TRAFFIC_PERCENTILE = 0.2;
const HIGH_TRAFFIC_MIN = 20;
const HIGH_TRAFFIC_MAX = 500;

export async function getHighTrafficWorkIds(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const entries: Array<{ workId: string; count: number }> = [];
    let cursor = 0;
    do {
      const [cur, batch] = await redis.scan(cursor, { match: 'work:click:*', count: 200 });
      cursor = Number(cur);
      if (batch.length > 0) {
        const vals = await redis.mget<(string | null)[]>(...(batch as string[]));
        (batch as string[]).forEach((key, i) => {
          const count = parseInt(String(vals[i] ?? '0'), 10) || 0;
          if (count > 0) entries.push({ workId: key.replace('work:click:', ''), count });
        });
      }
    } while (cursor !== 0);

    entries.sort((a, b) => b.count - a.count);
    const targetCount = Math.min(
      HIGH_TRAFFIC_MAX,
      Math.max(HIGH_TRAFFIC_MIN, Math.ceil(entries.length * HIGH_TRAFFIC_PERCENTILE)),
    );
    return entries.slice(0, targetCount).map((e) => e.workId);
  } catch (err) {
    console.error('[vod-recheck-store] getHighTrafficWorkIds failed:', err);
    return [];
  }
}
