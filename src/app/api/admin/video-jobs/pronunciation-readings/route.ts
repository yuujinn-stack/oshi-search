import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { listPronunciationReadings, upsertPronunciationReading } from '@/server/video-jobs/script-prep-store';

export const dynamic = 'force-dynamic';

/** 登録済みの読みの一覧（テーブル未作成なら available=false） */
export async function GET() {
  try {
    const list = await listPronunciationReadings();
    return NextResponse.json(list ? { available: true, ...list } : { available: false, version: '', readings: [] });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

/**
 * 読みを登録する（推定読みを自動で確定することはしない。管理画面で確認して「登録」した読みだけを保存する）。
 * 正本はDB。Workerが次の生存報告で受け取り、その語を使う人物の読み台本だけを作り直す。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { sourceText?: unknown; reading?: unknown };
  if (typeof body.sourceText !== 'string' || typeof body.reading !== 'string') {
    return NextResponse.json({ error: '語と読みを入力してください。' }, { status: 400 });
  }
  try {
    await upsertPronunciationReading(body.sourceText, body.reading);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
