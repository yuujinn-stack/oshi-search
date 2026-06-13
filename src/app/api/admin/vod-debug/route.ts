import { NextRequest, NextResponse } from 'next/server';
import { getWatchProviders } from '@/lib/tmdb';

// GET /api/admin/vod-debug?tmdbId=123&type=tv
// 特定作品のWatch Providers生レスポンスを確認するデバッグエンドポイント
// 管理画面のデバッグ用途のみ（proxy.ts で認証済み）
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tmdbId = parseInt(searchParams.get('tmdbId') ?? '', 10);
  const type = searchParams.get('type') as 'movie' | 'tv' | null;

  if (!tmdbId || !type || !['movie', 'tv'].includes(type)) {
    return NextResponse.json(
      { error: 'tmdbId（数値）と type（movie | tv）が必要です' },
      { status: 400 },
    );
  }

  const { providers, link, debug } = await getWatchProviders(tmdbId, type);

  return NextResponse.json({
    tmdbId,
    type,
    providerCount: providers.length,
    providers: providers.map((p) => ({
      name: p.providerName,
      type: p.type,
      source: p.source,
    })),
    link,
    debug,
  });
}
