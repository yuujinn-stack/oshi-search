// GET   /api/admin/vod-recheck/investigation-jobs/[jobId] — ジョブ詳細・進行状況・各アイテムの調査結果
// PATCH /api/admin/vod-recheck/investigation-jobs/[jobId] — action: 'stop' | 'resume' | 'retry_failed'
import { NextRequest, NextResponse } from 'next/server';
import { getInvestigationJob, setJobStatus, retryFailedItems } from '@/lib/vod-investigation-store';
import { computeInvestigationProgress } from '@/lib/vod-investigation';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const result = await getInvestigationJob(jobId);
  if (!result) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  const { job, items } = result;
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    items: items.map((i) => ({
      id: i.id,
      workId: i.workId,
      personName: i.personName,
      title: i.title,
      workType: i.workType,
      releaseYear: i.releaseYear,
      status: i.status,
      decision: i.decision,
      retryCount: i.retryCount,
      candidateProviders: i.candidateProviders ?? [],
      currentProvidersSnapshot: i.currentProvidersSnapshot ?? [],
      manualProviders: i.manualProviders ?? [],
      errorMessage: i.errorMessage,
      investigatedAt: i.investigatedAt,
      decidedAt: i.decidedAt,
      decidedBy: i.decidedBy,
    })),
    progress: computeInvestigationProgress(items.map((i) => ({ status: i.status }))),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = await req.json().catch(() => ({})) as { action?: unknown };
  const { action } = body;

  const result = await getInvestigationJob(jobId);
  if (!result) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  if (result.job.status === 'applied') {
    return NextResponse.json({ error: 'このジョブは既に反映済みのため操作できません' }, { status: 409 });
  }

  if (action === 'stop') {
    await setJobStatus(jobId, 'paused');
    return NextResponse.json({ ok: true, status: 'paused' });
  }
  if (action === 'resume') {
    await setJobStatus(jobId, 'running');
    return NextResponse.json({ ok: true, status: 'running' });
  }
  if (action === 'retry_failed') {
    const retried = await retryFailedItems(jobId);
    // 失敗件数が再びpendingへ戻るため、ジョブが completed だった場合は running へ戻す
    if (retried > 0 && result.job.status === 'completed') {
      await setJobStatus(jobId, 'running');
    }
    return NextResponse.json({ ok: true, retried });
  }

  return NextResponse.json({ error: `不正な action です: ${String(action)}（'stop' | 'resume' | 'retry_failed' のいずれか）` }, { status: 400 });
}
