import { NextResponse } from 'next/server';
import { listPostedPersonsWithLastDate } from '@/lib/instagram-post-store';

export const dynamic = 'force-dynamic';

/**
 * 一括予約の人物選択画面で「投稿済み」バッジ・直近投稿日を表示するための一覧。
 * personNamesは既存の呼び出し互換のためそのまま残し、lastPostedAt（personName→ISO日時）を追加する。
 */
export async function GET() {
  try {
    const withDates = await listPostedPersonsWithLastDate();
    const personNames = withDates.map((r) => r.personName);
    const lastPostedAt = Object.fromEntries(withDates.map((r) => [r.personName, r.lastPublishedAt.toISOString()]));
    return NextResponse.json({ personNames, lastPostedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
