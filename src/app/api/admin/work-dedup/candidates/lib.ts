/**
 * /api/admin/work-dedup/candidates のビジネスロジック（純粋関数）
 * DB アクセスなし・副作用なし → テスト可能
 */

import type { WorkDedupGroup, WorkDuplicateConfidence } from '@/lib/work-dedup';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

const VALID_CONFIDENCES = new Set<string>(['exact', 'high', 'medium', 'low', 'conflict']);

export interface ParsedParams {
  page: number;
  limit: number;
  confidence: string;
  q: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** URLSearchParams から安全にクエリパラメータを取り出す */
export function parseQueryParams(searchParams: URLSearchParams): ParsedParams {
  const rawPage  = parseInt(searchParams.get('page')  ?? '1', 10);
  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);

  const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(MAX_LIMIT, rawLimit)
    : DEFAULT_LIMIT;

  const confidence = searchParams.get('confidence') ?? 'all';
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();

  return { page, limit, confidence, q };
}

/** confidence と検索クエリでフィルタリング */
export function filterGroups(
  groups: WorkDedupGroup[],
  confidence: string,
  q: string,
): WorkDedupGroup[] {
  let result = groups;

  if (confidence !== 'all' && VALID_CONFIDENCES.has(confidence)) {
    result = result.filter((g) => g.confidence === (confidence as WorkDuplicateConfidence));
  }

  if (q) {
    result = result.filter((g) =>
      g.entries.some(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.workId.toLowerCase().includes(q),
      ),
    );
  }

  return result;
}

/** ページネーション。page が範囲外の場合は clamp する */
export function paginateGroups(
  groups: WorkDedupGroup[],
  page: number,
  limit: number,
): { items: WorkDedupGroup[]; pagination: Pagination } {
  const total      = groups.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const start      = (safePage - 1) * limit;

  return {
    items: groups.slice(start, start + limit),
    pagination: { total, page: safePage, limit, totalPages },
  };
}

/** レスポンスに含める overview を上限 maxLen 文字に切り詰める */
export function trimGroupsForResponse(
  groups: WorkDedupGroup[],
  maxLen = 150,
): WorkDedupGroup[] {
  return groups.map((g) => ({
    ...g,
    entries: g.entries.map((e) => ({
      ...e,
      overview: e.overview ? e.overview.slice(0, maxLen) : null,
    })),
  }));
}
