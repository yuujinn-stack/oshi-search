// VOD配信情報の「確認からどれくらい経過しているか」を分類する純粋関数。
//
// 既存の再確認優先度ロジック（vod-recheck.ts の RECHECK_STALE_DAYS=180・
// detectRecheckReasons・computeRecheckPriority）は「再確認が必要かどうか」の
// 判定に使われる別の仕組みであり、本ファイルはそれを置き換えない。
// こちらは管理画面・CSVで「確認日がどれくらい新しいか」を一目で把握するための
// 補助的な表示分類（fresh/aging/stale/unknown）を提供する。
//
// 本ファイルはDBアクセスを行わない。呼び出し側（vod-recheck-export-data.ts等）が
// 既存のcheckedAt値（例: detectRecheckReasonsのlastCheckedAt）を渡す。

export type VodStaleStatus = 'fresh' | 'aging' | 'stale' | 'unknown';

export const VOD_STALE_FRESH_MAX_DAYS = 30;
export const VOD_STALE_AGING_MAX_DAYS = 60;

export const VOD_STALE_STATUS_LABEL: Record<VodStaleStatus, string> = {
  fresh: '確認済み（新しい）',
  aging: 'やや古い',
  stale: '古い（要再確認）',
  unknown: '未確認',
};

// 確認日時（ms epoch）から経過日数を算出する。checkedAtMsがnull/undefinedの場合はnull。
export function getDaysSinceChecked(
  checkedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (checkedAtMs === null || checkedAtMs === undefined || !Number.isFinite(checkedAtMs)) return null;
  const diffMs = nowMs - checkedAtMs;
  if (diffMs < 0) return 0; // 未来日時は0日として扱う（安全側）
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

// 経過日数からstaleStatusを判定する。
// fresh: 30日以内 / aging: 31〜60日 / stale: 61日以上 / unknown: 経過日数不明（確認日なし）
export function getVodStaleStatus(daysSinceChecked: number | null): VodStaleStatus {
  if (daysSinceChecked === null) return 'unknown';
  if (daysSinceChecked <= VOD_STALE_FRESH_MAX_DAYS) return 'fresh';
  if (daysSinceChecked <= VOD_STALE_AGING_MAX_DAYS) return 'aging';
  return 'stale';
}
