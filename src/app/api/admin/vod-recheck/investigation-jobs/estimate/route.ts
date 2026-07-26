// POST /api/admin/vod-recheck/investigation-jobs/estimate
// 調査対象CSVをアップロードした直後、実際にジョブを作成する前に「対象作品数・推定検索/OpenAI呼び出し回数・
// 推定費用・上限」を確認画面に表示するためのエンドポイント。DBへの書き込みは一切行わない
// （ジョブはまだ作成しない。作成は POST /api/admin/vod-recheck/investigation-jobs で行う）。
import { NextRequest, NextResponse } from 'next/server';
import { parseInvestigationTargetCsv } from '@/lib/vod-recheck-csv';
import { prepareInvestigationTargets } from '@/lib/vod-investigation-store';
import { estimateInvestigationCost, MAX_INVESTIGATION_ITEMS } from '@/lib/vod-investigation';
import { getVodResearchStats } from '@/lib/openai-usage';

export const dynamic = 'force-dynamic';

// 実績データが1件も無い場合の保守的な既定値（openai_usage_logsに実績が溜まるまでの暫定値）
const FALLBACK_AVG_COST_USD = 0.01;
const USD_TO_JPY = 155;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { csv?: unknown };
  const { csv } = body;

  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv（文字列）が必要です' }, { status: 400 });
  }

  const parsed = parseInvestigationTargetCsv(csv);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { targets, unresolvedWorkIds } = await prepareInvestigationTargets(parsed.workIds);

  if (targets.length > MAX_INVESTIGATION_ITEMS) {
    return NextResponse.json({
      error: `一度に自動調査できるのは最大 ${MAX_INVESTIGATION_ITEMS} 件です（${targets.length}件が対象になります）`,
    }, { status: 400 });
  }

  const stats = await getVodResearchStats();
  const avgCostUsd = stats?.avgCostUsd ?? FALLBACK_AVG_COST_USD;
  const estimate = estimateInvestigationCost(targets.length, avgCostUsd, USD_TO_JPY);

  return NextResponse.json({
    estimate,
    unresolvedWorkIds,
    targets: targets.map((t) => ({ workId: t.workId, title: t.title, workType: t.workType, releaseYear: t.releaseYear })),
    historicalStats: stats ? {
      sampleSize: stats.sampleSize,
      successRate: stats.successRate,
      avgCostUsd: stats.avgCostUsd,
    } : null,
    usedFallbackCost: stats === null,
  });
}
