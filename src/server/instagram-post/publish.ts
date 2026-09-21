import 'server-only';
import { loadInstagramConfig } from './config';
import { InstagramGraphClient, GraphApiRequestError } from './graph-client';
import { recordInstagramPost } from '@/lib/instagram-post-store';

// Metaの推奨: 1分に1回、最大5分間ポーリングする。
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = Math.ceil((5 * 60 * 1000) / POLL_INTERVAL_MS);

interface MediaContainerResponse { id: string }
interface ContainerStatusResponse { status_code: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' }

export { GraphApiRequestError };

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

export interface PublishResult {
  mediaId: string;
  publishedAt: string;
}

/**
 * カルーセルコンテナ作成〜media_publishまでを1回の呼び出しで実行する
 * （管理画面側は確認モーダルで一度だけ承認を得るUXのため、CLI版のような
 * --stage / confirm-publish の2段階には分けていない）。
 * 成功時はDB（instagram_posts）へ人物名・media_id・使用画像・キャプションを記録する。
 */
export async function createCarouselAndPublish(
  personName: string,
  imageUrls: [string, string, string],
  caption: string,
): Promise<PublishResult> {
  const config = loadInstagramConfig();
  const client = new InstagramGraphClient(config);

  const childIds: string[] = [];
  for (const imageUrl of imageUrls) {
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
    caption,
  });
  await pollUntilFinished(client, carousel.id, 'carousel');

  const published = await client.post<MediaContainerResponse>(`${config.igUserId}/media_publish`, {
    creation_id: carousel.id,
  });

  const publishedAt = new Date().toISOString();
  await recordInstagramPost({
    personName,
    mediaId: published.id,
    imageUrls,
    caption,
  });

  return { mediaId: published.id, publishedAt };
}
