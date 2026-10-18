import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { getLatestWorker, VideoJobError } from '@/server/video-jobs/job-store';
import { loadOshiVodVideoDiagnosis } from '@/server/oshi-vod/video-diagnosis';
import { OSHI_VOD_COMPARE_INPUT_KIND, parseOshiVodCompareInput, TemplateInputError } from '@/lib/video-template-input';
import { checkVodCompareSharedCapcut } from '@/lib/oshi-vod/video-feature';

export const dynamic = 'force-dynamic';

/**
 * 管理画面（/admin/video-maker）: 推しでサブスク比較の生成前確認（読み取りのみ。ジョブは作らない）。
 * 選択した3人の「推しに合うサブスク診断」の結果のうち、確認用の件数・1位と、
 * テンプレート共通CapCut音声を使えるか（capcutCompatible・理由）を返す。判定はジョブ作成時と同じ関数（ジョブ作成時にも必ず再確認する）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { personSlugs?: unknown; templateId?: unknown };
  try {
    const input = parseOshiVodCompareInput({ personSlugs: body.personSlugs });
    const d = await loadOshiVodVideoDiagnosis(input);
    const top = d.byWorkCount[0];
    // 3人入力のテンプレートは複数ある（推しでサブスク比較・サブスク比較機能紹介）。選択中のテンプレートで判定する
    // （templateId を送らない古い画面からの呼び出しは従来どおり最初の3人入力テンプレート）
    const templates = ((await getLatestWorker())?.templates ?? []).filter((t) => t.templateInputKind === OSHI_VOD_COMPARE_INPUT_KIND);
    const template = typeof body.templateId === 'string' ? templates.find((t) => t.templateId === body.templateId) : templates[0];
    const capcut = template
      ? checkVodCompareSharedCapcut(template, d)
      : ({ ok: false, reason: '動画生成Workerの報告がないため、CapCutナレーションを確認できません' } as const);
    return NextResponse.json({
      persons: d.persons,
      headline: d.headline,
      totals: { registered: d.totals.registered, paid: d.totals.paid },
      top: top ? { displayName: top.displayName, fractionText: top.fractionText } : null,
      bestPair: d.bestPair ? { services: d.bestPair.services.map((s) => s.displayName), fractionText: d.bestPair.fractionText } : null,
      capcutCompatible: capcut.ok,
      capcutReason: capcut.ok ? null : capcut.reason,
    });
  } catch (err) {
    if (err instanceof TemplateInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
