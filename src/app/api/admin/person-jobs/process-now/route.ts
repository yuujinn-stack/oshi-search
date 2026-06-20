// POST /api/admin/person-jobs/process-now
// 人物ジョブキューを手動で即時処理するエンドポイント
// body: { jobIds?: string[] }
// jobIds 指定時: 指定ジョブを最大3件処理（キューから取り出さず直接処理）
// jobIds 未指定時: キューの古い順に PERSON_JOB_BATCH_SIZE 件（デフォルト1件・最大3件）処理

import { NextRequest, NextResponse } from 'next/server';
import { processQueuedPersonJobs } from '@/lib/person-job-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = Math.min(
  parseInt(process.env.PERSON_JOB_BATCH_SIZE ?? process.env.PERSON_FETCH_BATCH_SIZE ?? '1', 10),
  3,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { jobIds?: string[] };
    const { jobIds } = body;

    const result = await processQueuedPersonJobs({ jobIds, batchSize: BATCH_SIZE });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
