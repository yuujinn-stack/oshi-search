import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { loadStoryGoods, StoryGoodsError } from '@/server/story-maker/goods-data';

export const dynamic = 'force-dynamic';

// 認証・CSRF（Origin）確認は src/proxy.ts（/api/admin/:path*）で行う。DB は読むだけ。

/**
 * ストーリーズ B（関連商品）の自動作成用：選んだ人物・グループのページに公開中の関連商品（最大3件）と商品画像（data: URL）。
 * GET ?type=person|group&name=...
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const name = req.nextUrl.searchParams.get('name') ?? '';
  if (type !== 'person' && type !== 'group') return NextResponse.json({ error: '人物またはグループを選んでください。' }, { status: 400 });
  try {
    const result = await loadStoryGoods({ type, name });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof StoryGoodsError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: `商品データを読み込めませんでした（${maskSecrets(String(err instanceof Error ? err.message : err))}）。` }, { status: 500 });
  }
}
