// POST /api/admin/vod-recheck/investigation-jobs/[jobId]/items/[itemId]/decision
// 管理者が1件（1作品）の調査候補に対して行う判断: approved(承認) / rejected(却下) /
// needs_review(要再調査) / manual(手動編集して承認)。
// 'approved' は候補（AIが返した公開名を主張するサービス）に公式URL/根拠URLが無い場合は拒否する
// （「公式URLなしの候補を自動承認しない」の安全弁。canApproveCandidates と同じ判定基準）。
// 'manual' は admin が providers を上書きするため、その配列自体をチェックする。
import { NextRequest, NextResponse } from 'next/server';
import { getInvestigationJob, setItemDecision } from '@/lib/vod-investigation-store';
import { isValidDecision, canApproveCandidates } from '@/lib/vod-investigation';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

function isVodProviderArray(v: unknown): v is VodProvider[] {
  return Array.isArray(v) && v.every((p) => p && typeof p === 'object' && typeof (p as VodProvider).providerName === 'string');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string; itemId: string }> }) {
  const { jobId, itemId: itemIdStr } = await params;
  const itemId = Number(itemIdStr);
  if (!Number.isInteger(itemId)) {
    return NextResponse.json({ error: '不正な itemId です' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as { decision?: unknown; manualProviders?: unknown; decidedBy?: unknown };
  const { decision, manualProviders, decidedBy } = body;

  if (!isValidDecision(decision) || decision === 'pending') {
    return NextResponse.json({ error: `decision は approved | rejected | needs_review | manual のいずれかである必要があります` }, { status: 400 });
  }

  const jobResult = await getInvestigationJob(jobId);
  if (!jobResult) {
    return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
  }
  if (jobResult.job.status === 'applied') {
    return NextResponse.json({ error: 'このジョブは既に反映済みのため判断を変更できません' }, { status: 409 });
  }
  const item = jobResult.items.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: '指定されたアイテムがこのジョブに見つかりません' }, { status: 404 });
  }

  let providers: VodProvider[] | undefined;
  if (decision === 'manual') {
    if (!isVodProviderArray(manualProviders) || manualProviders.length === 0) {
      return NextResponse.json({ error: 'manual では manualProviders（VodProvider配列）が必要です' }, { status: 400 });
    }
    providers = manualProviders;
  } else if (decision === 'approved') {
    const candidates = (item.candidateProviders as VodProvider[] | null) ?? [];
    if (!canApproveCandidates(candidates)) {
      return NextResponse.json({
        error: '公式URL（sourceUrl/officialUrl）が無い候補は承認できません。manual（手動編集）または needs_review（要再調査）を選択してください',
      }, { status: 400 });
    }
  }

  await setItemDecision(
    itemId,
    decision,
    providers,
    typeof decidedBy === 'string' && decidedBy.trim() ? decidedBy.trim() : 'admin:vod-recheck-investigation',
  );

  return NextResponse.json({ ok: true });
}
