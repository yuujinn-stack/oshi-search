import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { loadOshiVodVideoDiagnosis } from '@/server/oshi-vod/video-diagnosis';
import { parseOshiVodCompareInput, TemplateInputError } from '@/lib/video-template-input';

export const dynamic = 'force-dynamic';

/**
 * 管理画面（/admin/video-maker）: 推しでサブスク比較の生成前確認（読み取りのみ。ジョブは作らない）。
 * 選択した3人の「推しに合うサブスク診断」の結果のうち、確認用の件数・1位だけを返す。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { personSlugs?: unknown };
  try {
    const input = parseOshiVodCompareInput({ personSlugs: body.personSlugs });
    const d = await loadOshiVodVideoDiagnosis(input);
    const top = d.byWorkCount[0];
    return NextResponse.json({
      persons: d.persons,
      headline: d.headline,
      totals: { registered: d.totals.registered, paid: d.totals.paid },
      top: top ? { displayName: top.displayName, fractionText: top.fractionText } : null,
      bestPair: d.bestPair ? { services: d.bestPair.services.map((s) => s.displayName), fractionText: d.bestPair.fractionText } : null,
    });
  } catch (err) {
    if (err instanceof TemplateInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
