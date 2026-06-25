import { NextRequest, NextResponse } from 'next/server';
import { updateWorkStatus } from '@/lib/work-store';
import type { WorkStatus } from '@/types/work';

const VALID_STATUSES: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];

// POST /api/admin/work-verdict-bulk
// body: { personName, workIds: string[], status }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workIds, status } = body as {
    personName?: string;
    workIds?: string[];
    status?: string;
  };

  if (!personName || !workIds?.length || !status) {
    return NextResponse.json(
      { error: 'personName, workIds, status が必要です' },
      { status: 400 },
    );
  }
  if (!VALID_STATUSES.includes(status as WorkStatus)) {
    return NextResponse.json({ error: '無効な status です' }, { status: 400 });
  }

  await Promise.all(
    workIds.map((id) => updateWorkStatus(personName, id, status as WorkStatus)),
  );
  return NextResponse.json({ ok: true, count: workIds.length });
}
