// POST /api/admin/vod-recheck/investigation-jobs/[jobId]/apply
// 承認済み結果を実際にDBへ反映する（管理者が「承認済みの結果を反映」を明示的にクリックした時のみ）。
// apply-preview と全く同じ検証・CSV組み立てを行った上で commit=true で
// runVodRecheckCsvImport を呼ぶ。成功後、ジョブを 'applied' にして二重反映を防ぐ。
import { NextRequest, NextResponse } from 'next/server';
import { getInvestigationJob, setJobStatus } from '@/lib/vod-investigation-store';
import { canBulkApply, buildImportCsvFromApprovedItems, type ApprovedInvestigationItem } from '@/lib/vod-investigation';
import { runVodRecheckCsvImport } from '@/lib/vod-recheck-csv-import';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = await req.json().catch(() => ({})) as { performedBy?: unknown };
  const { performedBy } = body;

  const result = await getInvestigationJob(jobId);
  if (!result) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  const { job, items } = result;

  // 二重反映防止: 既に反映済みのジョブは再反映できない
  if (job.status === 'applied') {
    return NextResponse.json({ error: 'このジョブは既に反映済みです（二重反映防止）' }, { status: 409 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: '対象作品がありません' }, { status: 400 });
  }
  if (!canBulkApply(items.map((i) => ({ decision: i.decision, status: i.status })))) {
    const unresolved = items.filter((i) => i.decision === 'pending' || i.decision === 'needs_review').map((i) => i.workId);
    return NextResponse.json({
      error: '1件でも未確認（承認・却下・要再調査以外の判断が付いていない）候補があるため反映できません',
      unresolvedWorkIds: unresolved,
    }, { status: 400 });
  }

  const approvedItems: ApprovedInvestigationItem[] = items
    .filter((i) => i.decision === 'approved' || i.decision === 'manual')
    .map((i) => ({
      workId: i.workId,
      providers: (i.decision === 'manual' ? i.manualProviders : i.candidateProviders) as VodProvider[] ?? [],
    }))
    .filter((i) => i.providers.length > 0);

  if (approvedItems.length === 0) {
    // 全件却下の場合も「反映済み」として扱い、ジョブを閉じる（再度反映操作されないようにする）
    await setJobStatus(jobId, 'applied');
    return NextResponse.json({ commit: true, updatedWorks: 0, unresolvedWorkIds: [], errors: [] });
  }

  const csv = buildImportCsvFromApprovedItems(approvedItems);
  const importResult = await runVodRecheckCsvImport(csv, true, {
    mergeStrategy: 'sync',
    performedBy: typeof performedBy === 'string' && performedBy.trim() ? performedBy.trim() : 'admin:vod-recheck-investigation-apply',
  });

  if (importResult.status === 200) {
    await setJobStatus(jobId, 'applied');
  }

  return NextResponse.json(importResult.body, { status: importResult.status });
}
