import { NextRequest, NextResponse } from 'next/server';
import { listHCandidates } from '@/server/instagram-post/site-ui/h-candidates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 全登録人物の集計（人物ページと同じ集計）を行うため時間がかかる。結果は10分間メモリにキャッシュする
export const maxDuration = 300;

/** H「観るもの・買うもの、まとめて」の投稿候補一覧（H適性度順）。読み取り専用 */
export async function GET(req: NextRequest) {
  try {
    const list = await listHCandidates(req.nextUrl.searchParams.get('refresh') === '1');
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json({ error: `候補一覧の作成に失敗しました: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
