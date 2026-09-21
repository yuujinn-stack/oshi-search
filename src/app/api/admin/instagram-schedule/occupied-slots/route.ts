import { NextRequest, NextResponse } from 'next/server';
import { listOccupiedSlotIsos } from '@/server/instagram-schedule/schedule-store';

export const dynamic = 'force-dynamic';

/**
 * 一括予約の空き枠計算（allocateBulkSlots）用に、今後days日分の「既に埋まっている」
 * 予定日時（ISO文字列）一覧を返す。キャンセル済みの予約はここに含めない（＝空き扱い）。
 */
export async function GET(req: NextRequest) {
  const daysParam = req.nextUrl.searchParams.get('days');
  const days = Math.min(Math.max(Number(daysParam) || 90, 1), 365);

  const from = new Date();
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    const occupied = await listOccupiedSlotIsos(from, to);
    return NextResponse.json({ occupied: Array.from(occupied) });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
