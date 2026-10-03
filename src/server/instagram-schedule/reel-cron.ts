import 'server-only';
import { isAutopublishEnabled, isReelsAutopublishEnabled } from '../instagram-post/config';
import { GraphApiRequestError } from '../instagram-post/graph-client';
import { AmbiguousPublishError } from './publish-schedule';
import { publishReelToInstagram, ReelContainerFailedError } from './publish-reel';
import {
  claimDueReelSchedule,
  listDueReelScheduleIds,
  markFailed,
  markNeedsReview,
  markPublished,
  markReelContainerFailed,
  releaseReelForNextRun,
  releaseSchedule,
  saveReelPermalink,
} from './schedule-store';
import { createAdminNotificationIfNeeded } from './admin-notifications';

/**
 * 既存のInstagram予約Cron（/api/cron/instagram-publish）から、カルーセルの処理が終わった後に呼ぶReel（Phase R1b）の処理。
 * 既存の status・due条件・atomic claim・failed/needs_review・自動再試行・管理画面内通知をそのまま使う。
 *
 * 安全装置:
 * ・Instagram APIを呼ぶのは INSTAGRAM_AUTOPUBLISH_ENABLED と INSTAGRAM_REELS_AUTOPUBLISH_ENABLED の両方が "true" のときだけ。
 *   Reelのスイッチが無効なら、期限が来たReelの件数を数えるだけで claim もしない（DBも変えない）。
 * ・1回のCronで扱うReelは最大1件。残り時間が足りなければ手を付けず、次回のCronに回す。
 * ・dryRun: claimして即座に戻すだけ（Instagram APIは呼ばない。既存のdryRunと同じ）。
 */

export const REEL_CRON_LIMIT = 1;
/** Reelを1件処理するのに最低限必要な残り時間（コンテナ作成・状態確認・公開・DB更新） */
const MIN_REMAINING_MS = 60_000;
/** 公開処理（media_publish・permalink取得・DB更新）用に残しておく時間 */
const PUBLISH_RESERVE_MS = 30_000;
/** 1回のCronでコンテナの処理完了を待つ最大時間 */
const MAX_POLL_MS = 90_000;

export interface ReelCronOutcome {
  id: number;
  personName: string;
  result: 'published' | 'waiting' | 'failed' | 'needs_review' | 'dry-run-ok' | 'skipped-already-claimed';
  mediaId?: string;
}

export interface ReelCronResult {
  /** Reelのスイッチが無効なためInstagram APIを呼ばなかった */
  guarded: boolean;
  dueCount: number;
  /** 残り時間が足りず、今回は手を付けなかった */
  deferredForTime: boolean;
  outcomes: ReelCronOutcome[];
}

export async function processDueReels(opts: { dryRun: boolean; deadlineMs: number; now?: () => number }): Promise<ReelCronResult> {
  const now = opts.now ?? Date.now;
  const dueIds = await listDueReelScheduleIds(REEL_CRON_LIMIT);
  const result: ReelCronResult = { guarded: false, dueCount: dueIds.length, deferredForTime: false, outcomes: [] };
  if (dueIds.length === 0) return result;

  if (!opts.dryRun && !(isAutopublishEnabled() && isReelsAutopublishEnabled())) {
    result.guarded = true;
    return result;
  }
  if (!opts.dryRun && opts.deadlineMs - now() < MIN_REMAINING_MS) {
    result.deferredForTime = true;
    return result;
  }

  for (const id of dueIds) {
    const claimed = await claimDueReelSchedule(id);
    if (!claimed) {
      result.outcomes.push({ id, personName: '(unknown)', result: 'skipped-already-claimed' });
      continue;
    }
    if (opts.dryRun) {
      await releaseSchedule(claimed.id);
      result.outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'dry-run-ok' });
      continue;
    }

    try {
      const pollBudgetMs = Math.min(MAX_POLL_MS, opts.deadlineMs - now() - PUBLISH_RESERVE_MS);
      const outcome = await publishReelToInstagram(claimed, { pollBudgetMs });
      if (outcome.kind === 'waiting') {
        // コンテナIDは保存済み。scheduledに戻して次回のCronで同じコンテナの続きから確認する
        await releaseReelForNextRun(claimed.id);
        result.outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'waiting' });
        console.log(`[cron/instagram-publish] reel waiting: id=${claimed.id} container=${outcome.containerId} status=${outcome.status}`);
        continue;
      }
      await markPublished(claimed.id, { mediaId: outcome.mediaId, publishedAt: new Date(outcome.publishedAt) });
      if (outcome.permalink) {
        await saveReelPermalink(claimed.id, outcome.permalink).catch((err) =>
          console.error(`[cron/instagram-publish] reel permalinkの保存に失敗（投稿は成功済み）: id=${claimed.id}`, err),
        );
      }
      result.outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'published', mediaId: outcome.mediaId });
      console.log(`[cron/instagram-publish] reel published: id=${claimed.id} personName=${claimed.personName} mediaId=${outcome.mediaId}`);
    } catch (err) {
      const message = err instanceof GraphApiRequestError ? err.message : err instanceof Error ? err.message : String(err);
      const nextAttempts = claimed.attempts + 1;
      const notifyStatus: 'needs_review' | 'failed' = err instanceof AmbiguousPublishError ? 'needs_review' : 'failed';
      if (notifyStatus === 'needs_review') {
        // コンテナIDは残す（再実行しても同じコンテナの状態＝PUBLISHEDを確認でき、二重投稿にならない）
        await markNeedsReview(claimed.id, { errorMessage: message, attempts: nextAttempts });
      } else if (err instanceof ReelContainerFailedError) {
        await markReelContainerFailed(claimed.id, { errorMessage: message, attempts: nextAttempts });
      } else {
        // コンテナ作成前後の通信失敗など（未公開と断定できる）。コンテナIDがあれば残し、再試行時に再利用する
        await markFailed(claimed.id, { errorMessage: message, attempts: nextAttempts });
      }
      result.outcomes.push({ id: claimed.id, personName: claimed.personName, result: notifyStatus });
      console.error(`[cron/instagram-publish] reel ${notifyStatus}: id=${claimed.id} personName=${claimed.personName} error=${message}`);
      try {
        await createAdminNotificationIfNeeded({ scheduleId: claimed.id, status: notifyStatus, attempts: nextAttempts });
      } catch (notifyErr) {
        console.error(`[cron/instagram-publish] 管理画面内通知の作成に失敗しました（投稿結果の保存には影響しません）: id=${claimed.id}`, notifyErr);
      }
    }
  }
  return result;
}
