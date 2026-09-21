import 'server-only';
import { loadInstagramConfig } from '../instagram-post/config';
import { InstagramGraphClient, GraphApiRequestError } from '../instagram-post/graph-client';
import { recordInstagramPost } from '@/lib/instagram-post-store';
import type { ScheduleRecord } from './schedule-store';

// Metaの推奨: 1分に1回、最大5分間ポーリングする（src/server/instagram-post/publish.tsと同じ値）。
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = Math.ceil((5 * 60 * 1000) / POLL_INTERVAL_MS);

interface MediaContainerResponse { id: string }
interface ContainerStatusResponse { status_code: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' }

export { GraphApiRequestError };

/**
 * media_publish呼び出し自体が失敗した（レスポンスを正常に受け取れなかった）ことを示す。
 * このケースはInstagram側で実際には処理が完了している可能性を否定できないため、
 * 呼び出し側は絶対に自動再試行してはならない（failedとは別のneeds_review状態にする）。
 */
export class AmbiguousPublishError extends Error {}

/** すでに公開済み（media_idを保持済み）のスケジュールを誤って再投稿しようとした場合 */
export class AlreadyPublishedError extends Error {}

async function pollUntilFinished(client: InstagramGraphClient, containerId: string, label: string): Promise<void> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const status = await client.get<ContainerStatusResponse>(containerId, { fields: 'status_code' });
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`[${label}] コンテナが失敗状態になりました: ${status.status_code}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[${label}] タイムアウト: 一定時間待ってもFINISHEDになりませんでした`);
}

export interface SchedulePublishResult {
  mediaId: string;
  publishedAt: string;
}

/**
 * 予約（instagram_post_schedules）の保存済み画像URL・キャプションを使って
 * カルーセル作成〜media_publishまでを実行する。
 *
 * src/server/instagram-post/publish.ts の createCarouselAndPublish と処理内容はほぼ同じだが、
 * 既存の手動投稿機能（そちらはUIで一度だけ人が確認して押す前提）には手を加えず、
 * 自動投稿（Cron）専用に「media_publish呼び出しの失敗だけは特別扱いする」ロジックを
 * ここに独立して持たせている（media_publish以前の失敗は「未公開」と断定できるが、
 * media_publish自体の失敗はInstagram側で成立している可能性を否定できないため）。
 */
export async function publishScheduleToInstagram(schedule: ScheduleRecord): Promise<SchedulePublishResult> {
  // 呼び出し側（cron）のクエリで既に除外しているはずだが、多重の安全策として再確認する。
  if (schedule.mediaId) {
    throw new AlreadyPublishedError(
      `予約id=${schedule.id}は既にmedia_id=${schedule.mediaId}で公開済みのため、再投稿を中止しました`,
    );
  }

  const config = loadInstagramConfig();
  const client = new InstagramGraphClient(config);
  const [img1, img2, img3] = schedule.imageUrls;
  if (!img1 || !img2 || !img3) {
    throw new Error(`保存されている画像URLが3枚未満です（${schedule.imageUrls.length}枚）`);
  }

  // ── 1〜2. カルーセル子コンテナ作成・カルーセル本体作成（この段階の失敗は「未公開」と断定できる） ──
  const childIds: string[] = [];
  for (const imageUrl of [img1, img2, img3]) {
    const res = await client.post<MediaContainerResponse>(`${config.igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
    });
    await pollUntilFinished(client, res.id, 'child');
    childIds.push(res.id);
  }

  const carousel = await client.post<MediaContainerResponse>(`${config.igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: schedule.caption,
  });
  await pollUntilFinished(client, carousel.id, 'carousel');

  // ── 3. media_publish（この呼び出し自体が失敗した場合はambiguousとして特別扱いする） ──
  let publishedId: string;
  try {
    const published = await client.post<MediaContainerResponse>(`${config.igUserId}/media_publish`, {
      creation_id: carousel.id,
    });
    publishedId = published.id;
  } catch (err) {
    const message = err instanceof GraphApiRequestError ? err.message : err instanceof Error ? err.message : String(err);
    throw new AmbiguousPublishError(
      `media_publishの呼び出しでエラーが発生しましたが、Instagram側では実際に公開が完了している可能性があります` +
        `（要手動確認。Instagramアプリ/Webで実際に投稿されているか確認してから対応してください）: ${message}`,
    );
  }

  const publishedAt = new Date().toISOString();

  // 履歴テーブル（instagram_posts）への記録は非致命的な付随処理として扱う。
  // ここで失敗しても、呼び出し元がmediaIdを予約テーブルに保存すれば二重投稿は防げるため、
  // ログのみ残してエラーは投げない（投げてしまうと「実際は公開済みなのにfailed扱い」になり危険）。
  try {
    await recordInstagramPost({
      personName: schedule.personName,
      mediaId: publishedId,
      imageUrls: [img1, img2, img3],
      caption: schedule.caption,
    });
  } catch (err) {
    console.error(
      `[instagram-schedule] recordInstagramPost失敗（media_id=${publishedId}は取得済みのため実害なし）:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { mediaId: publishedId, publishedAt };
}
