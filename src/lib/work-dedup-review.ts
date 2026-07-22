/**
 * 作品重複候補レビュー — 型定義・純粋関数
 * DB アクセスなし・副作用なし → テスト可能
 */

import { ALGORITHM_VERSION } from '@/lib/work-dedup';

// ─── 定数 ────────────────────────────────────────────────────────────────────

export const REVIEW_NOTE_MAX_LENGTH = 500;

export const REVIEW_STATUSES = [
  'pending',
  'approved_duplicate',
  'rejected_distinct',
  'on_hold',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ─── 型定義 ──────────────────────────────────────────────────────────────────

/** API レスポンス用（DB 行を安全にシリアライズしたもの） */
export interface ReviewApiData {
  candidateGroupKey: string;
  algorithmVersion: string;
  candidateWorkIds: string[];
  detectedConfidence: string;
  reviewStatus: ReviewStatus;
  selectedCanonicalWorkId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  /** true = 保存後に workId 構成またはアルゴリズムバージョンが変わった */
  stale: boolean;
}

/** レビュー進捗集計 */
export interface ReviewStats {
  total: number;       // 候補グループ総数
  pending: number;     // 未判定（レビュー記録なし or status=pending）
  approved: number;    // 承認済み（approved_duplicate）
  rejected: number;    // 却下済み（rejected_distinct）
  onHold: number;      // 保留（on_hold）
  stale: number;       // 再確認が必要
  completionRate: number; // (approved + rejected + onHold) / total * 100
}

/** PUT リクエストボディの型 */
export interface ReviewUpdateBody {
  reviewStatus: ReviewStatus;
  selectedCanonicalWorkId?: string | null;
  reviewerNote?: string | null;
}

export interface ReviewValidationError {
  code: string;
  message: string;
}

// ─── バリデーション ───────────────────────────────────────────────────────────

export function isValidReviewStatus(s: unknown): s is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(s as string);
}

/**
 * PUT リクエストボディを検証する。
 * currentWorkIds: サーバーが現在のグループから計算した workId 一覧
 */
export function validateReviewUpdate(
  body: unknown,
  currentWorkIds: string[],
): { ok: true; input: ReviewUpdateBody } | { ok: false; error: ReviewValidationError } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: { code: 'INVALID_BODY', message: 'リクエストボディが不正です' } };
  }

  const b = body as Record<string, unknown>;

  if (!isValidReviewStatus(b.reviewStatus)) {
    return {
      ok: false,
      error: { code: 'INVALID_REVIEW_STATUS', message: 'reviewStatus が不正な値です' },
    };
  }
  const reviewStatus = b.reviewStatus;

  // selectedCanonicalWorkId 検証
  let selectedCanonicalWorkId: string | null = null;
  if (reviewStatus === 'approved_duplicate') {
    if (typeof b.selectedCanonicalWorkId !== 'string' || b.selectedCanonicalWorkId.trim() === '') {
      return {
        ok: false,
        error: {
          code: 'CANONICAL_REQUIRED',
          message: 'approved_duplicate の場合、selectedCanonicalWorkId は必須です',
        },
      };
    }
    const canon = b.selectedCanonicalWorkId.trim();
    if (!currentWorkIds.includes(canon)) {
      return {
        ok: false,
        error: {
          code: 'CANONICAL_NOT_IN_CANDIDATES',
          message: 'selectedCanonicalWorkId は候補グループ内の workId でなければなりません',
        },
      };
    }
    selectedCanonicalWorkId = canon;
  }

  // reviewerNote 検証
  let reviewerNote: string | null = null;
  if (b.reviewerNote !== undefined && b.reviewerNote !== null) {
    if (typeof b.reviewerNote !== 'string') {
      return { ok: false, error: { code: 'INVALID_NOTE', message: 'reviewerNote は文字列でなければなりません' } };
    }
    if (b.reviewerNote.length > REVIEW_NOTE_MAX_LENGTH) {
      return {
        ok: false,
        error: {
          code: 'NOTE_TOO_LONG',
          message: `管理メモは ${REVIEW_NOTE_MAX_LENGTH} 文字以内にしてください`,
        },
      };
    }
    reviewerNote = b.reviewerNote.trim() || null;
  }

  return {
    ok: true,
    input: {
      reviewStatus,
      selectedCanonicalWorkId,
      reviewerNote,
    },
  };
}

/**
 * 保存済みレビューが現在の候補状態と整合しているか確認する。
 * workId 構成またはアルゴリズムバージョンが変化した場合 true を返す。
 */
export function isGroupStale(
  reviewWorkIds: string[],
  reviewAlgorithmVersion: string,
  currentWorkIds: string[],
): boolean {
  if (reviewAlgorithmVersion !== ALGORITHM_VERSION) return true;
  const saved   = [...reviewWorkIds].sort().join('|');
  const current = [...currentWorkIds].sort().join('|');
  return saved !== current;
}

/**
 * レビューマップ（candidateGroupKey → DB行）と全グループから進捗を集計する。
 */
export function computeReviewStats(
  totalGroups: number,
  reviewMap: Map<string, { reviewStatus: ReviewStatus; candidateWorkIds: string[]; algorithmVersion: string }>,
  groupWorkIdsMap: Map<string, string[]>,
): ReviewStats {
  let approved = 0;
  let rejected = 0;
  let onHold   = 0;
  let stale    = 0;

  for (const [key, review] of reviewMap) {
    const currentWorkIds = groupWorkIdsMap.get(key);
    const s = isGroupStale(
      review.candidateWorkIds,
      review.algorithmVersion,
      currentWorkIds ?? [],
    );
    if (s) { stale++; continue; }
    if (review.reviewStatus === 'approved_duplicate') approved++;
    else if (review.reviewStatus === 'rejected_distinct') rejected++;
    else if (review.reviewStatus === 'on_hold') onHold++;
  }

  const reviewed = approved + rejected + onHold;
  const pending  = totalGroups - reviewed - stale;
  const completionRate =
    totalGroups > 0 ? Math.round((reviewed / totalGroups) * 100) : 0;

  return { total: totalGroups, pending, approved, rejected, onHold, stale, completionRate };
}
