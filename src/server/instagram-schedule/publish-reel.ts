import 'server-only';
import { loadInstagramConfig } from '../instagram-post/config';
import { InstagramGraphClient, GraphApiRequestError } from '../instagram-post/graph-client';
import { recordInstagramPost } from '@/lib/instagram-post-store';
import { AmbiguousPublishError, AlreadyPublishedError } from './publish-schedule';
import { isReelStillPublishable, saveReelContainer, type ScheduleRecord } from './schedule-store';

/**
 * Reel予約（media_type='REEL'）をInstagramへ公開する処理（Phase R1b）。公式APIの流れ:
 *   1. POST /{ig-user-id}/media（media_type=REELS, video_url, caption）でコンテナ作成
 *   2. GET /{container-id}?fields=status_code で処理完了（FINISHED）を確認
 *   3. POST /{ig-user-id}/media_publish（creation_id）で公開
 *
 * カルーセルと違い、Instagram側の動画処理に時間がかかるため、1回のCronで最後まで終わらせようとしない:
 * ・コンテナIDは作成直後に保存し（saveReelContainer）、次回のCronではそのコンテナを再利用する（毎回作り直さない）
 * ・時間内にFINISHEDにならなければ { kind: 'waiting' } を返し、呼び出し側が scheduled に戻して次回へ持ち越す
 * ・保存済みコンテナが PUBLISHED（media_publishは成功したが応答を受け取れなかった等）なら、二重投稿を避けて
 *   AmbiguousPublishError（needs_review）にする
 * ・ERROR / EXPIRED は「公開されていない」ことが確定しているため ReelContainerFailedError（コンテナを捨てて failed）
 *
 * Instagram APIの呼び出しは、既存の InstagramGraphClient をそのまま使う。
 * 呼び出し側（reel-cron.ts）が自動公開スイッチを確認してからだけ呼ぶこと（この関数自体はスイッチを見ない）。
 */

interface MediaContainerResponse { id: string }
type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
interface ContainerStatusResponse { status_code: ContainerStatus }

/** コンテナがERROR/EXPIRED: Instagram側で公開されていないことが確定（コンテナを作り直してよい） */
export class ReelContainerFailedError extends Error {}

export type ReelPublishOutcome =
  | { kind: 'published'; mediaId: string; publishedAt: string; permalink: string | null }
  | { kind: 'waiting'; containerId: string; status: ContainerStatus };

export interface ReelPublishOptions {
  /** コンテナ処理の完了待ちに使ってよい最大時間（これを過ぎたら次回のCronへ持ち越す） */
  pollBudgetMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function publishReelToInstagram(schedule: ScheduleRecord, options: ReelPublishOptions): Promise<ReelPublishOutcome> {
  if (schedule.mediaType !== 'REEL') throw new Error(`予約id=${schedule.id}はReelではありません（media_type=${schedule.mediaType}）`);
  if (schedule.mediaId) {
    throw new AlreadyPublishedError(`予約id=${schedule.id}は既にmedia_id=${schedule.mediaId}で公開済みのため、再投稿を中止しました`);
  }
  if (!schedule.videoUrl) throw new Error(`予約id=${schedule.id}に動画URL（ig-reel.mp4）がありません`);

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const interval = options.pollIntervalMs ?? 10_000;
  const deadline = now() + Math.max(0, options.pollBudgetMs);

  const config = loadInstagramConfig();
  const client = new InstagramGraphClient(config);

  // ── 1. コンテナ: 保存済みなら再利用し、なければ作成してすぐ保存する（この段階の失敗は「未公開」と断定できる） ──
  let containerId = schedule.igContainerId;
  if (!containerId) {
    const created = await client.post<MediaContainerResponse>(`${config.igUserId}/media`, {
      media_type: 'REELS',
      video_url: schedule.videoUrl,
      caption: schedule.caption,
      share_to_feed: 'true',
    });
    containerId = created.id;
    if (!(await saveReelContainer(schedule.id, containerId))) {
      throw new Error(`予約id=${schedule.id}の状態が変わったため、コンテナ${containerId}を保存できませんでした（公開はしていません）`);
    }
  }

  // ── 2. 処理完了の確認（時間内に終わらなければ次回のCronへ） ──
  let status: ContainerStatus;
  for (;;) {
    status = (await client.get<ContainerStatusResponse>(containerId, { fields: 'status_code' })).status_code;
    if (status === 'FINISHED') break;
    if (status === 'PUBLISHED') {
      throw new AmbiguousPublishError(
        `コンテナ${containerId}は既にInstagramで公開済みの状態です。二重投稿を避けるため自動では公開しません` +
          '（Instagramアプリ/Webで投稿を確認してから対応してください）',
      );
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new ReelContainerFailedError(`Instagram側の動画処理が${status}になりました（コンテナ${containerId}、未公開）`);
    }
    if (now() + interval > deadline) return { kind: 'waiting', containerId, status };
    await sleep(interval);
  }

  // ── 3. 公開直前の再確認（キャンセル等で状態が変わっていないか） ──
  if (!(await isReelStillPublishable(schedule.id, containerId))) {
    throw new Error(`予約id=${schedule.id}の状態が変わったため公開を中止しました（未公開）`);
  }

  // ── 4. media_publish（この呼び出し自体の失敗は、公開済みの可能性があるため needs_review） ──
  let mediaId: string;
  try {
    const published = await client.post<MediaContainerResponse>(`${config.igUserId}/media_publish`, { creation_id: containerId });
    mediaId = published.id;
  } catch (err) {
    const message = err instanceof GraphApiRequestError ? err.message : err instanceof Error ? err.message : String(err);
    throw new AmbiguousPublishError(
      `media_publishの呼び出しでエラーが発生しましたが、Instagram側では実際に公開が完了している可能性があります` +
        `（要手動確認。Instagramアプリ/Webで実際に投稿されているか確認してから対応してください）: ${message}`,
    );
  }
  const publishedAt = new Date().toISOString();

  // 以降は付随処理（失敗しても公開自体は成功扱い。media_idは呼び出し側が保存して二重投稿を防ぐ）
  let permalink: string | null = null;
  try {
    permalink = (await client.get<{ permalink?: string }>(mediaId, { fields: 'permalink' })).permalink ?? null;
  } catch (err) {
    console.error(`[instagram-reel] permalinkの取得に失敗（media_id=${mediaId}は取得済みのため実害なし）:`, err instanceof Error ? err.message : String(err));
  }
  try {
    await recordInstagramPost({ personName: schedule.personName, mediaId, imageUrls: [], caption: schedule.caption });
  } catch (err) {
    console.error(`[instagram-reel] recordInstagramPost失敗（media_id=${mediaId}は取得済みのため実害なし）:`, err instanceof Error ? err.message : String(err));
  }
  return { kind: 'published', mediaId, publishedAt, permalink };
}
