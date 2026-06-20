// GET /api/cron/person-fetch
// 人物データ取得ジョブキューを処理する Vercel Cron（日次実行）
// 1回の実行でキューから最大 PERSON_JOB_BATCH_SIZE 件を順番に処理（デフォルト1件、最大3件）

import { NextRequest, NextResponse } from 'next/server';
import { processQueuedPersonJobs } from '@/lib/person-job-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = Math.min(
  parseInt(process.env.PERSON_JOB_BATCH_SIZE ?? process.env.PERSON_FETCH_BATCH_SIZE ?? '1', 10),
  3,
);

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  try {
    const result = await processQueuedPersonJobs({ batchSize: BATCH_SIZE });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
