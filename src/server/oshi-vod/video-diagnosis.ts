import 'server-only';
import { getAllPersonsMerged } from '@/lib/persons';
import { loadOshiVodDiagnosis } from '@/lib/oshi-vod/data';
import { toVideoDiagnosisPayload, type VideoDiagnosisPayload } from '@/lib/oshi-vod/video-payload';
import type { OshiVodCompareTemplateInput } from '@/lib/video-template-input';
import { personVideoSlug } from '@/server/video-jobs/person-slug';
import { VideoJobError } from '@/server/video-jobs/job-store';

/**
 * 動画「推しでサブスク比較」用の診断結果（読み取りのみ）。
 * 人物slug（personVideoSlug）を推しサーチの登録人物（/oshi-vod と同じ getAllPersonsMerged）へ対応付け、
 * 診断ページと同じ loadOshiVodDiagnosis（→ computeOshiVodDiagnosis）の結果を動画向けの形にして返す。
 * 比較の計算はここでは一切しない。
 */
export async function resolveVideoPersonSlugs(slugs: readonly string[]): Promise<Array<{ slug: string; name: string }>> {
  const persons = await getAllPersonsMerged();
  const nameBySlug = new Map(persons.map((p) => [personVideoSlug(p.name), p.name]));
  const missing = slugs.filter((s) => !nameBySlug.has(s));
  if (missing.length > 0) throw new VideoJobError(`推しサーチに登録されていない人物です: ${missing.join(', ')}`, 404);
  return slugs.map((slug) => ({ slug, name: nameBySlug.get(slug)! }));
}

export async function loadOshiVodVideoDiagnosis(input: OshiVodCompareTemplateInput): Promise<VideoDiagnosisPayload> {
  const persons = await resolveVideoPersonSlugs(input.personSlugs);
  let result: Awaited<ReturnType<typeof loadOshiVodDiagnosis>>;
  try {
    result = await loadOshiVodDiagnosis(persons.map((p) => p.name));
  } catch (err) {
    throw new VideoJobError(`比較結果を取得できませんでした: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`, 502);
  }
  if (result.persons.map((p) => p.name).join('\n') !== persons.map((p) => p.name).join('\n')) {
    throw new VideoJobError('比較結果の人物が選択した人物と一致しません。', 500);
  }
  if (result.totals.paid === 0 || result.byWorkCount.length === 0) {
    throw new VideoJobError(
      `比較対象作品が0件のため生成できません（現在いずれの有料サブスクでも見放題の作品を確認できません: ${persons.map((p) => p.name).join('・')}）。`,
      422,
    );
  }
  return toVideoDiagnosisPayload(result, persons);
}
