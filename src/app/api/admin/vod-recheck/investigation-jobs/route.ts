// GET  /api/admin/vod-recheck/investigation-jobs — 直近のジョブ一覧（再開用）
// POST /api/admin/vod-recheck/investigation-jobs — 調査対象CSVから調査ジョブを作成する
//
// 事前に /estimate で件数・費用概算を確認画面に表示していることが前提だが、
// このエンドポイント自体も上限（MAX_INVESTIGATION_ITEMS）を再検証する（確認をスキップした
// 直接呼び出しでも上限を超えられないようにするため）。
// ジョブ作成時点ではAI調査は一切実行しない（items は status: 'pending' で登録されるだけ）。
// 実際の調査は POST /investigation-jobs/[jobId]/process を管理画面から繰り返し呼び出して進める。
import { NextRequest, NextResponse } from 'next/server';
import { parseInvestigationTargetCsv } from '@/lib/vod-recheck-csv';
import { prepareInvestigationTargets, createInvestigationJob, listRecentInvestigationJobs } from '@/lib/vod-investigation-store';
import { MAX_INVESTIGATION_ITEMS, computeInvestigationProgress } from '@/lib/vod-investigation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs = await listRecentInvestigationJobs(20);
  return NextResponse.json({
    jobs: jobs.map(({ job, itemStatuses }) => ({
      id: job.id,
      status: job.status,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      progress: computeInvestigationProgress(itemStatuses.map((s) => ({ status: s }))),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { csv?: unknown; createdBy?: unknown };
  const { csv, createdBy } = body;

  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv（文字列）が必要です' }, { status: 400 });
  }

  const parsed = parseInvestigationTargetCsv(csv);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { targets, unresolvedWorkIds } = await prepareInvestigationTargets(parsed.workIds);

  if (targets.length === 0) {
    return NextResponse.json({ error: '調査対象となる有効な作品がありません', unresolvedWorkIds }, { status: 400 });
  }
  if (targets.length > MAX_INVESTIGATION_ITEMS) {
    return NextResponse.json({
      error: `一度に自動調査できるのは最大 ${MAX_INVESTIGATION_ITEMS} 件です（${targets.length}件が対象になります）`,
    }, { status: 400 });
  }

  const jobId = await createInvestigationJob(
    targets,
    typeof createdBy === 'string' && createdBy.trim() ? createdBy.trim() : 'admin:vod-recheck-investigation',
  );

  return NextResponse.json({ jobId, targetCount: targets.length, unresolvedWorkIds });
}
