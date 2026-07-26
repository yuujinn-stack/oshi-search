// POST /api/admin/vod-recheck/investigation-jobs/[jobId]/process
// 1回の呼び出しで INVESTIGATION_BATCH_SIZE 件だけを処理する。管理画面がポーリングして
// 繰り返し呼び出すことで、進行状況表示・停止・再開を実現する（同期的に全件は絶対に処理しない）。
// paused状態のジョブは処理を拒否する（stop操作の意味を担保する）。
import { NextRequest, NextResponse } from 'next/server';
import { getInvestigationJob, setJobStatus } from '@/lib/vod-investigation-store';
import { processInvestigationBatch } from '@/lib/vod-investigation-runner';
import { computeInvestigationProgress } from '@/lib/vod-investigation';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const before = await getInvestigationJob(jobId);
  if (!before) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  if (before.job.status === 'paused') {
    return NextResponse.json({ error: 'ジョブは停止中です（再開してから処理してください）' }, { status: 409 });
  }
  if (before.job.status === 'applied') {
    return NextResponse.json({ error: 'このジョブは既に反映済みです' }, { status: 409 });
  }

  if (before.job.status === 'pending') {
    await setJobStatus(jobId, 'running');
  }

  const result = await processInvestigationBatch(jobId);

  const after = await getInvestigationJob(jobId);
  const progress = computeInvestigationProgress((after?.items ?? []).map((i) => ({ status: i.status })));

  // pending/investigatingが無くなった時点で調査フェーズ完了（承認待ちへ）
  if (progress.pending === 0 && progress.investigating === 0) {
    await setJobStatus(jobId, 'completed');
  }

  return NextResponse.json({ ...result, progress });
}
