import { NextResponse } from 'next/server';
import { listPostedPersonsWithLastDate, getTemplateHistory } from '@/lib/instagram-post-store';

export const dynamic = 'force-dynamic';

/**
 * 一括予約の人物選択画面で「投稿済み」バッジ・直近投稿日を表示するための一覧。
 * personNamesは既存の呼び出し互換のためそのまま残し、lastPostedAt（personName→ISO日時）を追加する。
 * templateHistory：人物 × テンプレートの投稿履歴（投稿成功が記録されたものだけ。読み取りのみ）。
 */
export async function GET() {
  try {
    const [withDates, templateHistory] = await Promise.all([listPostedPersonsWithLastDate(), getTemplateHistory()]);
    const personNames = withDates.map((r) => r.personName);
    const lastPostedAt = Object.fromEntries(withDates.map((r) => [r.personName, r.lastPublishedAt.toISOString()]));
    return NextResponse.json({ personNames, lastPostedAt, templateHistory });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
