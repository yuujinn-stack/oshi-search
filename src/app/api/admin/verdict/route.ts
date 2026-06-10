import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { saveVerdict, deleteVerdict } from '@/lib/judgment-store';
import type { Verdict } from '@/lib/judgment-store';

// POST /api/admin/verdict
// body: { personName, productId, verdict, score, reason? }
// DELETE /api/admin/verdict
// body: { personName, productId }
// 管理者による手動判定結果の保存・削除

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, productId, verdict, score, reason } = body as {
    personName?: string;
    productId?: string;
    verdict?: string;
    score?: number;
    reason?: string;
  };

  if (!personName || !productId || !verdict) {
    return NextResponse.json({ error: 'personName, productId, verdict が必要です' }, { status: 400 });
  }

  const validVerdicts: Verdict[] = ['related', 'uncertain', 'unrelated'];
  if (!validVerdicts.includes(verdict as Verdict)) {
    return NextResponse.json({ error: '無効な verdict です' }, { status: 400 });
  }

  await saveVerdict(personName, productId, verdict as Verdict, score ?? 0, 'manual', reason);
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, productId } = body as { personName?: string; productId?: string };

  if (!personName || !productId) {
    return NextResponse.json({ error: 'personName, productId が必要です' }, { status: 400 });
  }

  await deleteVerdict(personName, productId);
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true });
}
