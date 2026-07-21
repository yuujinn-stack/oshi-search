import { NextRequest, NextResponse } from 'next/server';
import { updateWorkStatus, deleteWork, getWork } from '@/lib/work-store';
import { insertWorkStatusHistory } from '@/db/write';
import type { WorkStatus } from '@/types/work';

const VALID_STATUSES: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];

// POST /api/admin/work-verdict
// body: { personName, workId, status, reason? }
// 管理者による手動ステータス変更。変更履歴を work_status_history に記録する。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, status, reason } = body as {
    personName?: string;
    workId?: string;
    status?: string;
    reason?: string;
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

  // 現在の状態を取得（履歴記録用）
  const currentWork = await getWork(personName, workId);
  const previousStatus = currentWork?.status ?? 'unknown';

  await updateWorkStatus(personName, workId, status as WorkStatus);

  // 履歴記録（fire-and-forget: 失敗しても本体処理は成功扱い）
  if (currentWork && previousStatus !== status) {
    insertWorkStatusHistory({
      personName,
      workId,
      title:          currentWork.title,
      workSource:     currentWork.source,
      previousStatus,
      newStatus:      status,
      changedBy:      'admin:work-verdict',
      reason:         reason,
    }).catch((err: unknown) =>
      console.warn('[work-verdict] history log failed:', String(err)),
    );
  }

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
