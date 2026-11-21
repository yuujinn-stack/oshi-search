import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { StoryGoodsError } from '@/server/story-maker/goods-data';
import {
  approveBfItem,
  BfApprovalError,
  checkBfApprovals,
  parseBfTarget,
  parseBfVerificationInput,
} from '@/server/story-maker/bf-approval';

export const dynamic = 'force-dynamic';

// 認証・CSRF（Origin）確認は src/proxy.ts（/api/admin/:path*）で行う。DB・Redis には書き込まない。
//
// 楽天BF・推し別セール紹介の承認（時刻はすべてサーバーの時刻）。
// - GET … サーバーの今の時刻（管理画面の表示用。判定には使わせない）
// - POST { action: 'approve', type, name, productId, input } … サーバーで候補を読み直して検証し、署名した承認を返す
// - POST { action: 'check', type, name, items } … PNG保存の前に、署名・セール期間・有効期限を確かめる

const noStore = { 'Cache-Control': 'no-store' };

function errorResponse(err: unknown) {
  if (err instanceof BfApprovalError) return NextResponse.json({ error: err.message, now: Date.now() }, { status: err.status, headers: noStore });
  if (err instanceof StoryGoodsError) return NextResponse.json({ error: err.message, now: Date.now() }, { status: err.status, headers: noStore });
  return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)), now: Date.now() }, { status: 500, headers: noStore });
}

export async function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const target = parseBfTarget(body.type, body.name);
    if (body.action === 'approve') {
      const productId = typeof body.productId === 'string' ? body.productId.trim() : '';
      const r = await approveBfItem(target, productId, parseBfVerificationInput(body.input));
      return NextResponse.json({ ...r, now: Date.now() }, { status: r.ok ? 200 : 400, headers: noStore });
    }
    if (body.action === 'check') {
      const r = await checkBfApprovals(target, body.items);
      return NextResponse.json({ ...r, now: Date.now() }, { status: 200, headers: noStore });
    }
    return NextResponse.json({ error: '操作が正しくありません。', now: Date.now() }, { status: 400, headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
