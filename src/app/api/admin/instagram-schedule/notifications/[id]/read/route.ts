import { NextRequest, NextResponse } from 'next/server';
import { markAdminNotificationRead, NotificationNotFoundError } from '@/server/instagram-schedule/admin-notifications';

export const dynamic = 'force-dynamic';

/**
 * 管理画面内通知を既読にする。instagram_post_schedules（予約本体）のstatus等は
 * 一切変更しない（既読状態とInstagram投稿statusは完全に分離している）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }
  try {
    await markAdminNotificationRead(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotificationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
