import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { parseBfTarget, BfApprovalError } from '@/server/story-maker/bf-approval';
import { StoryGoodsError } from '@/server/story-maker/goods-data';
import { suggestBfProducts } from '@/server/story-maker/bf-auto';

export const dynamic = 'force-dynamic';

// /api/admin/:path* は既存の src/proxy.ts で認証・CSRF 検査。
// POST は管理者が対象を選んだ時だけ実行。公開API/定期ジョブからは呼ばない。
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const target = parseBfTarget(body.type, body.name);
    const result = await suggestBfProducts(target);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof BfApprovalError || err instanceof StoryGoodsError) return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: `楽天商品の自動照合に失敗しました（${maskSecrets(String(err instanceof Error ? err.message : err))}）。` }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
