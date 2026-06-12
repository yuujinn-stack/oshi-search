import { NextRequest, NextResponse } from 'next/server';
import { updateWorkStatus, deleteWork } from '@/lib/work-store';
import type { WorkStatus } from '@/types/work';

const VALID_STATUSES: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];

// POST /api/admin/work-verdict
// body: { personName, workId, status }
// 管理者による手動ステータス変更
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, status } = body as {
    personName?: string;
    workId?: string;
    status?: string;
  };

  if (!personName || !workId || !status) {
    return NextResponse.json(
      { error: 'personName, workId, status が必要です' },
      { status: 400 },
    );
  }
  if (!VALID_STATUSES.includes(status as WorkStatus)) {
    return NextResponse.json({ error: '無効な status です' }, { status: 400 });
  }

  await updateWorkStatus(personName, workId, status as WorkStatus);
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/work-verdict
// body: { personName, workId }
// 作品データを完全削除（再取得したい場合など）
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId } = body as { personName?: string; workId?: string };

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName, workId が必要です' }, { status: 400 });
  }

  await deleteWork(personName, workId);
  return NextResponse.json({ ok: true });
}
