import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { StoryRecordError } from '@/lib/story-maker/metrics';
import {
  deleteStoryPost,
  listStoryPosts,
  saveStoryPost,
  storyPostsScope,
  StoryStorageUnavailableError,
} from '@/server/story-maker/post-store';

export const dynamic = 'force-dynamic';

// 認証・CSRF（Origin）確認は src/proxy.ts（/api/admin/:path*）で行う。

function errorResponse(err: unknown) {
  if (err instanceof StoryRecordError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof StoryStorageUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
  return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
}

/** ストーリーズ投稿の効果測定の記録の一覧 */
export async function GET() {
  try {
    return NextResponse.json({ ...(await listStoryPosts()), scope: storyPostsScope() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 追加・更新（body.record） */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { record?: unknown };
  try {
    return NextResponse.json({ record: await saveStoryPost(body.record) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 削除（?id=） */
export async function DELETE(req: NextRequest) {
  try {
    await deleteStoryPost(req.nextUrl.searchParams.get('id') ?? '');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
