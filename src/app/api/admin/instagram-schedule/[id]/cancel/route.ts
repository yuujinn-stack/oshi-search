import { NextRequest, NextResponse } from 'next/server';
import { cancelSchedule, ScheduleNotFoundError, InvalidScheduleStateError } from '@/server/instagram-schedule/schedule-store';

export const dynamic = 'force-dynamic';

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
    const schedule = await cancelSchedule(id);
    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidScheduleStateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
