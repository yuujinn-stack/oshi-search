import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { saveVerdict } from '@/lib/judgment-store';
import type { Verdict } from '@/lib/judgment-store';

const VALID_VERDICTS: Verdict[] = ['related', 'uncertain', 'unrelated'];

// POST /api/admin/verdict-bulk
// body: { personName, productIds: string[], verdict, score? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, productIds, verdict, score } = body as {
    personName?: string;
    productIds?: string[];
    verdict?: string;
    score?: number;
  };

  if (!personName || !productIds?.length || !verdict) {
    return NextResponse.json(
      { error: 'personName, productIds, verdict が必要です' },
      { status: 400 },
    );
  }
  if (!VALID_VERDICTS.includes(verdict as Verdict)) {
    return NextResponse.json({ error: '無効な verdict です' }, { status: 400 });
  }

  await Promise.all(
    productIds.map((id) =>
      saveVerdict(personName, id, verdict as Verdict, score ?? 0, 'manual'),
    ),
  );
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true, count: productIds.length });
}
