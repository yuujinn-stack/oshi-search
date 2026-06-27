import { NextRequest, NextResponse } from 'next/server';
import { softDeleteWorks } from '@/lib/work-store';

// POST /api/admin/work-delete
// body: { personName, workIds: string[] }
// 作品を論理削除（deleted フラグをセット）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workIds } = body as {
    personName?: string;
    workIds?: string[];
  };

  if (!personName || !workIds || workIds.length === 0) {
    return NextResponse.json(
      { error: 'personName と workIds が必要です' },
      { status: 400 },
    );
  }

  const deletedCount = await softDeleteWorks(personName, workIds);
  return NextResponse.json({ ok: true, deletedCount });
}
