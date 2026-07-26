// POST /api/admin/vod-recheck/investigation-jobs/[jobId]/apply-preview
// 承認済み（approved/manual）の調査結果を、実際に反映する前のプレビュー。
// 承認済み候補から既存CSV取り込みと全く同じ列構成のCSVを組み立て、
// runVodRecheckCsvImport(csv, commit=false, mergeStrategy='sync') を呼ぶことで
// 「既存のCSV反映ロジックを再利用する」を実現する（別の反映ロジックを新設しない）。
// 1件でも未確認（pending/needs_review）が残っている場合は一括反映不可（canBulkApply）。
import { NextRequest, NextResponse } from 'next/server';
import { getInvestigationJob } from '@/lib/vod-investigation-store';
import { canBulkApply, buildImportCsvFromApprovedItems, type ApprovedInvestigationItem } from '@/lib/vod-investigation';
import { runVodRecheckCsvImport } from '@/lib/vod-recheck-csv-import';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const result = await getInvestigationJob(jobId);
  if (!result) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  const { job, items } = result;

  if (job.status === 'applied') {
    return NextResponse.json({ error: 'このジョブは既に反映済みです' }, { status: 409 });
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
    return NextResponse.json({ error: '反映対象となる承認済み候補がありません（全件却下されています）', preview: [] });
  }

  const csv = buildImportCsvFromApprovedItems(approvedItems);
  const importResult = await runVodRecheckCsvImport(csv, false, { mergeStrategy: 'sync' });

  return NextResponse.json(importResult.body, { status: importResult.status });
}
