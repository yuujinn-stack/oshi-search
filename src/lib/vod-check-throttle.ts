// vod-refresh / vod-recheck Cron が共有する「同一作品の重複AI検索を防ぐ」判定ロジック。
//
// 既存の WorkRecord.nextVodCheckAt（work-processor.ts が既に使っている「配信情報が
// 見つからなかった場合、30日後まで次回チェックを禁止する」スロットリング）と
// vodCheckStatus / updatedAt を再利用する。新規DBカラムは追加しない。
import type { WorkRecord } from '@/types/work';

// AIが配信情報を確認できなかった場合の再検索禁止期間。
// work-processor.ts の既存の30日スロットリングと同じ値に統一する。
export const NO_RESULT_RECHECK_COOLDOWN_DAYS = 30;
const NO_RESULT_RECHECK_COOLDOWN_MS = NO_RESULT_RECHECK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// vod-refresh・vod-recheckのどちらか一方が直近この期間内にAI検索していれば、
// もう一方は同じ作品を再検索しない（nextVodCheckAtで判定。両Cronで共有するフィールド）。
export function isVodCheckThrottled(
  work: Pick<WorkRecord, 'nextVodCheckAt'>,
  now: number = Date.now(),
): boolean {
  return !!(work.nextVodCheckAt && now < work.nextVodCheckAt);
}

// AI検索結果に応じて、次回チェック許可日時を計算する。
// 見つかった場合はスロットリング不要（undefined = 既存値を変更しない）。
export function computeNextVodCheckAt(
  foundProviders: boolean,
  now: number = Date.now(),
): number | undefined {
  return foundProviders ? undefined : now + NO_RESULT_RECHECK_COOLDOWN_MS;
}

// vodCheckStatus='checking' のまま異常に長時間放置されている
// （＝Vercel Function timeout等でrunRecheck()側の最終ステータス更新が完走しなかった）
// とみなす閾値。通常のAI Web検索は数秒〜数十秒で完了するため、2時間あれば
// 「本当に処理中」と「放棄された」を安全に区別できる。
export const STUCK_CHECKING_MS = 2 * 60 * 60 * 1000;

export function isStuckChecking(
  work: Pick<WorkRecord, 'vodCheckStatus' | 'updatedAt'>,
  now: number = Date.now(),
): boolean {
  return work.vodCheckStatus === 'checking' && now - work.updatedAt >= STUCK_CHECKING_MS;
}
