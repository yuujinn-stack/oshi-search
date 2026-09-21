import { NextResponse } from 'next/server';
import { listPostedPersonNames } from '@/lib/instagram-post-store';

export const dynamic = 'force-dynamic';

/** 一括予約の人物選択画面で「投稿済み」バッジを表示するための一覧 */
export async function GET() {
  try {
    const personNames = await listPostedPersonNames();
    return NextResponse.json({ personNames });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
