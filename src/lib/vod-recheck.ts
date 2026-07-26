// VOD再確認 優先度管理: 再確認理由の判定・優先度スコアリング（純粋関数のみ・DBアクセスなし）
// /admin/vod-recheck から使用する。既存の /api/cron/vod-recheck・/api/admin/vod-recheck
// （180日ルール・priorityRecheckフラグ）とは判定基準を共有しつつ、理由コードごとの
// 内訳表示・優先度4段階（critical/high/medium/low）を追加するための拡張。

import { normalizeProviderName, isConfirmedVodAvailability, deduplicateProviders } from '@/lib/vod-dedup';
import type { VodProvider } from '@/types/vod';

export const RECHECK_STALE_DAYS = 180;

export type RecheckReasonCode =
  | 'stale_180_days'
  | 'never_checked'
  | 'unknown_only'
  | 'no_active_provider'
  | 'high_traffic'
  | 'deprecated_provider'
  | 'post_merge_unchecked'
  | 'missing_source'
  | 'low_confidence'
  | 'inconsistent_checked_at';

export const RECHECK_REASON_LABEL: Record<RecheckReasonCode, string> = {
  stale_180_days:        '180日以上未確認',
  never_checked:         '確認日なし',
  unknown_only:          'unknownのみ',
  no_active_provider:    '有効VODなし',
  high_traffic:          'アクセス上位',
  deprecated_provider:   '終了済みサービス候補',
  post_merge_unchecked:  '統合後未確認',
  missing_source:        'sourceUrlなし',
  low_confidence:        'confidenceが低い',
  inconsistent_checked_at: '確認日時がVODごとに不一致',
};

export type RecheckPriority = 'critical' | 'high' | 'medium' | 'low';

export const RECHECK_PRIORITY_LABEL: Record<RecheckPriority, string> = {
  critical: '最優先',
  high:     '高',
  medium:   '中',
  low:      '低',
};

// 優先度の数値スコア（ソート用。大きいほど優先度が高い）
export const RECHECK_PRIORITY_SCORE: Record<RecheckPriority, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

export interface RecheckReasonInput {
  vodProviders: VodProvider[] | undefined;
  lastVodCheckAt: number | undefined;
  vodAiCheckedAt: number | undefined;
  /** 終了済み・無効化されたサービスの正規化済みslug（provider-store.getInactiveProviderSlugs()） */
  terminatedSlugs: Set<string>;
  /** work:click:{workId} 等から計算した「アクセス上位」判定（呼び出し側で相対順位から算出） */
  isHighTraffic: boolean;
  /**
   * このworkIdがwork_aliasesのcanonical_work_idとして参照されており、かつ
   * その統合(created_at)より後に一度も再確認されていない場合にtrueを渡す。
   * 統合されていない作品はundefined。
   */
  isPostMergeUnchecked: boolean;
  now: number;
}

export interface RecheckReasonResult {
  codes: RecheckReasonCode[];
  priority: RecheckPriority;
  /** 確認済み（isConfirmedVodAvailability）なVOD件数 */
  activeCount: number;
  /** hidden=falseなVODのうちunknown（providerNameまたはtypeがunknown/空）の件数 */
  unknownCount: number;
  /** 直近の確認日時（lastVodCheckAt/vodAiCheckedAtの新しい方）。未確認ならundefined */
  lastCheckedAt: number | undefined;
  /** 経過日数（未確認ならundefined） */
  daysSinceLastCheck: number | undefined;
}

function isUnknownProvider(p: VodProvider): boolean {
  const name = (p.providerName ?? '').trim().toLowerCase();
  return name === '' || name === 'unknown' || p.type === 'unknown';
}

/**
 * 1作品分の再確認理由・優先度・件数を判定する（純粋関数）。
 * DBアクセス・副作用なし。入力の vodProviders 配列は変更しない。
 */
export function detectRecheckReasons(input: RecheckReasonInput): RecheckReasonResult {
  // 同一サービスの名称揺れ（"Amazon Prime Video" / "Prime Video" 等）を1件に集約してから判定する。
  // Amazon追加チャンネルは独立スラグのため統合されない（deduplicateProvidersの既存仕様）。
  const providers = deduplicateProviders(input.vodProviders ?? []);
  const visible = providers.filter((p) => !p.hidden);
  const activeProviders = providers.filter((p) => isConfirmedVodAvailability(p, input.terminatedSlugs));
  const activeCount = activeProviders.length;
  const unknownCount = visible.filter(isUnknownProvider).length;

  const lastCheckedAt = Math.max(input.lastVodCheckAt ?? 0, input.vodAiCheckedAt ?? 0) || undefined;
  const daysSinceLastCheck = lastCheckedAt !== undefined
    ? Math.floor((input.now - lastCheckedAt) / (1000 * 60 * 60 * 24))
    : undefined;

  const codes: RecheckReasonCode[] = [];

  if (lastCheckedAt === undefined) {
    codes.push('never_checked');
  } else if (input.now - lastCheckedAt >= RECHECK_STALE_DAYS * 24 * 60 * 60 * 1000) {
    codes.push('stale_180_days');
  }

  if (activeCount === 0) {
    codes.push('no_active_provider');
  }
  // unknownのみ: 表示対象(hidden=false)のVODが1件以上あり、かつ全てがunknown判定で、有効VODが無い場合
  if (visible.length > 0 && activeCount === 0 && visible.every(isUnknownProvider)) {
    codes.push('unknown_only');
  }

  if (input.isHighTraffic) codes.push('high_traffic');

  if (visible.some((p) => input.terminatedSlugs.has(normalizeProviderName(p.providerName ?? '')))) {
    codes.push('deprecated_provider');
  }

  if (input.isPostMergeUnchecked) codes.push('post_merge_unchecked');

  if (activeProviders.some((p) => !p.sourceUrl && !p.officialUrl && !p.link)) {
    codes.push('missing_source');
  }

  if (visible.some((p) => p.confidence === 'low')) {
    codes.push('low_confidence');
  }

  const checkedDates = new Set(visible.map((p) => p.checkedDate).filter((d): d is string => !!d));
  if (checkedDates.size >= 2) codes.push('inconsistent_checked_at');

  return {
    codes,
    priority: computeRecheckPriority(codes),
    activeCount,
    unknownCount,
    lastCheckedAt,
    daysSinceLastCheck,
  };
}

/** 理由コードの集合から優先度を判定する（純粋関数） */
export function computeRecheckPriority(codes: RecheckReasonCode[]): RecheckPriority {
  const has = (c: RecheckReasonCode) => codes.includes(c);

  if (has('high_traffic') && (has('stale_180_days') || has('unknown_only') || has('no_active_provider'))) {
    return 'critical';
  }
  if (has('never_checked') || has('deprecated_provider') || has('post_merge_unchecked') || has('stale_180_days')) {
    return 'high';
  }
  if (has('missing_source') || has('low_confidence') || has('inconsistent_checked_at')) {
    return 'medium';
  }
  return 'low';
}

// ── 処理状態（vodCheckStatus）の表示ラベル ────────────────────────────────────
export type RecheckProcessStatus = NonNullable<import('@/types/work').WorkRecord['vodCheckStatus']> | 'not_started';

export const RECHECK_STATUS_LABEL: Record<RecheckProcessStatus, string> = {
  not_started:   '未処理',
  fresh:         '未処理',
  needs_recheck: '要確認',
  checking:      '処理中',
  checked:       '完了',
  failed:        '失敗',
  skipped:       'スキップ',
};

export function resolveRecheckProcessStatus(
  status: import('@/types/work').WorkRecord['vodCheckStatus'],
): RecheckProcessStatus {
  return status ?? 'not_started';
}

// ── 有効な action / priority のバリデーション（API入力検証用） ────────────────
export const VALID_RECHECK_ACTIONS = ['start', 'complete', 'needs_review', 'skip', 'note'] as const;
export type RecheckAction = typeof VALID_RECHECK_ACTIONS[number];

export function isValidRecheckAction(value: unknown): value is RecheckAction {
  return typeof value === 'string' && (VALID_RECHECK_ACTIONS as readonly string[]).includes(value);
}

export const VALID_RECHECK_PRIORITIES: readonly RecheckPriority[] = ['critical', 'high', 'medium', 'low'];

export function isValidRecheckPriority(value: unknown): value is RecheckPriority {
  return typeof value === 'string' && (VALID_RECHECK_PRIORITIES as readonly string[]).includes(value);
}

// action → vodCheckStatus への対応（管理画面のボタン操作用）
export const RECHECK_ACTION_TO_STATUS: Record<RecheckAction, import('@/types/work').WorkRecord['vodCheckStatus']> = {
  start:        'checking',
  complete:     'checked',
  needs_review: 'needs_recheck',
  skip:         'skipped',
  note:         undefined, // メモ保存のみ。ステータスは変更しない
};

// 「再確認完了」のときだけ lastVodCheckAt（確認日時）を更新する。
// start/needs_review/skip/note は状態遷移・メモのみで、確認完了を意味しないため更新しない。
export function shouldUpdateLastCheckedAt(action: RecheckAction): boolean {
  return action === 'complete';
}
