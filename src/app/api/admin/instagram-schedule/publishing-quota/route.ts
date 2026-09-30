import { NextResponse } from 'next/server';
import { loadInstagramConfig } from '@/server/instagram-post/config';
import { InstagramGraphClient } from '@/server/instagram-post/graph-client';
import { maskSecrets } from '@/lib/mask-secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ContentPublishingLimitResponse {
  data?: { quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }[];
}

/**
 * Instagramの投稿上限（Publishing quota）を取得する（読み取り専用。GET /{ig-user-id}/content_publishing_limit）。
 * 一括予約画面で、予約しようとしている件数が上限に近づく場合に予約前の警告を出すために使う。
 * 投稿・コンテナ作成は一切行わない。
 */
export async function GET() {
  try {
    const config = loadInstagramConfig();
    const client = new InstagramGraphClient(config);
    const res = await client.get<ContentPublishingLimitResponse>(`${config.igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' });
    const d = res.data?.[0];
    if (!d || typeof d.config?.quota_total !== 'number') {
      return NextResponse.json({ error: 'Publishing quotaを取得できませんでした' }, { status: 502 });
    }
    return NextResponse.json({
      quotaUsage: d.quota_usage ?? 0,
      quotaTotal: d.config.quota_total,
      quotaDurationSec: d.config.quota_duration ?? 86400,
    });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(err instanceof Error ? err.message : String(err)) }, { status: 502 });
  }
}
