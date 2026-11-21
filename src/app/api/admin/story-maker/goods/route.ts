import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { loadStoryGoods, loadStorySaleCandidates, loadStorySaleImages, StoryGoodsError } from '@/server/story-maker/goods-data';

export const dynamic = 'force-dynamic';

// 認証・CSRF（Origin）確認は src/proxy.ts（/api/admin/:path*）で行う。DB は読むだけ。

/**
 * ストーリーズ B（関連商品）の自動作成用：選んだ人物・グループのページに公開中の関連商品（最大3件）と商品画像（data: URL）。
 * GET ?type=person|group&name=...
 *
 * 楽天BF・推し別セール紹介：
 * - &mode=sale … 同じ選び方の候補の一覧（最大40件・画像は https のURL。BF対象かは管理画面の承認欄で確認する）
 * - &mode=sale-images&ids=ID1,ID2,ID3 … 採用した商品（最大3件）の商品画像（data: URL）
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const name = req.nextUrl.searchParams.get('name') ?? '';
  const mode = req.nextUrl.searchParams.get('mode');
  if (type !== 'person' && type !== 'group') return NextResponse.json({ error: '人物またはグループを選んでください。' }, { status: 400 });
  try {
    let result: unknown;
    if (mode === 'sale') result = await loadStorySaleCandidates({ type, name });
    else if (mode === 'sale-images') {
      const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => s && s.length <= 100);
      if (ids.length === 0) return NextResponse.json({ error: '商品を選んでください。' }, { status: 400 });
      result = { images: await loadStorySaleImages({ type, name }, ids) };
    } else result = await loadStoryGoods({ type, name });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof StoryGoodsError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: `商品データを読み込めませんでした（${maskSecrets(String(err instanceof Error ? err.message : err))}）。` }, { status: 500 });
  }
}
