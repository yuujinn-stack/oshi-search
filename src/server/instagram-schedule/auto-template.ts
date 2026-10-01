import 'server-only';
import { SCHEDULABLE_TEMPLATES, H_TEMPLATE_ID, G_TEMPLATE_ID, J_TEMPLATE_ID, type InstagramTemplateMeta } from '@/lib/instagram-templates';
import { fetchPersonWorks } from '../instagram-post/person-data';
import { findExistingPersonPhoto } from '../instagram-post/blob';
import { aggregateVodCounts } from '../instagram-post/build-post-vod-compare';
import { evaluateSiteUiAvailability } from '../instagram-post/site-ui/builders';

/**
 * 「自動（おすすめ）」テンプレート選択のロジック。
 * 候補は予約できる全テンプレート（既存4テンプレート＋H・G・J）。人物ごとの実データから、その人物で
 * 実際に生成できるテンプレートだけに絞り込み、直前に使われたテンプレートの次からローテーションする。
 *
 * 既存4テンプレートの条件（人物写真の有無・出演作品件数・異なる配信サービス数）は従来どおり
 * （findExistingPersonPhoto / fetchPersonWorks / aggregateVodCounts）。
 * H・G・J は生成時と同じ条件（evaluateSiteUiAvailability。J は画像が3件そろうかまで確認）で判定する。
 */

export interface PersonTemplateContext {
  hasPhoto: boolean;
  workCount: number;
  vodServiceCount: number;
  /** H・G・J をこの人物で生成できるか（未設定なら3つとも候補にしない） */
  siteUi?: { h: boolean; g: boolean; j: boolean };
}

export class NoEligibleTemplateError extends Error {}

/** 人物名から、テンプレート条件判定に必要な実データをまとめて取得する（読み取り専用） */
export async function evaluatePersonTemplateContext(personName: string): Promise<PersonTemplateContext> {
  const [personData, photoUrl, siteUi] = await Promise.all([
    fetchPersonWorks(personName),
    findExistingPersonPhoto(personName),
    // H・G・J の判定に失敗しても既存4テンプレートの自動選択は止めない（その場合 H・G・J は候補から外す）
    evaluateSiteUiAvailability(personName).catch(() => ({ h: false, g: false, j: false })),
  ]);
  // 各テンプレートの生成処理は上位3件（REQUIRED_WORK_COUNT=3）を使うため、
  // 配信サービス数の判定もそれに合わせて上位3件から集計する
  // （build-post-vod-compare.tsのaggregateVodCountsと同じ入力範囲に揃える）。
  const top3 = personData.works.slice(0, 3);
  const vodCounts = aggregateVodCounts(top3);
  return {
    hasPhoto: !!photoUrl,
    workCount: personData.works.length,
    vodServiceCount: vodCounts.length,
    siteUi,
  };
}

export function isTemplateEligible(meta: InstagramTemplateMeta, ctx: PersonTemplateContext): boolean {
  if (meta.id === H_TEMPLATE_ID) return !!ctx.siteUi?.h;
  if (meta.id === G_TEMPLATE_ID) return !!ctx.siteUi?.g;
  if (meta.id === J_TEMPLATE_ID) return !!ctx.siteUi?.j;
  if (meta.requiresPersonPhoto && !ctx.hasPhoto) return false;
  if (ctx.workCount < meta.minWorks) return false;
  if (ctx.vodServiceCount < meta.minVodServices) return false;
  return true;
}

/** 条件を満たすテンプレート一覧（SCHEDULABLE_TEMPLATES の並び順を保つ） */
export function getEligibleTemplates(ctx: PersonTemplateContext): InstagramTemplateMeta[] {
  return SCHEDULABLE_TEMPLATES.filter((t) => isTemplateEligible(t, ctx));
}

/**
 * ローテーションの基準となる並び順（既存4テンプレート → H → G → J → 先頭へ）。ここに含まれない（＝将来追加された）
 * 候補テンプレートは末尾に追加されるため、ローテーション対象から漏れることはない。
 */
export const ROTATION_ORDER = ['works-only', 'works-picks', 'vod-compare', 'default-person', H_TEMPLATE_ID, G_TEMPLATE_ID, J_TEMPLATE_ID];

/**
 * 候補テンプレートの中から、直前に使われたテンプレート（previousTemplateId）の次を選ぶ。
 * 完全ランダムにはせず、ROTATION_ORDER に沿った決定的な巡回にすることで
 * 「同じテンプレートが連続しにくい」を確実に満たす（候補が2種類以上あれば連続を100%回避する）。
 *
 * 次の候補は「全体の並び順で直前のテンプレートより後ろにある、この人物で生成できる最初のテンプレート」。
 * 直前のテンプレートがこの人物では生成できないもの（例：直前が J で、この人物は J 不可）でも、
 * 並びの先頭へ戻さずその位置から続ける（人物・日付が変わってもローテーションが不必要にリセットされない）。
 */
export function pickAutoTemplate(
  eligible: InstagramTemplateMeta[],
  previousTemplateId: string | null,
): InstagramTemplateMeta {
  if (eligible.length === 0) {
    throw new NoEligibleTemplateError('候補テンプレートがありません');
  }

  const rotationCandidates = eligible.filter((t) => t.autoRotation);
  const pool = rotationCandidates.length > 0 ? rotationCandidates : eligible;
  if (pool.length === 1) return pool[0];

  const ids = pool.map((t) => t.id);
  const fullOrder = [...ROTATION_ORDER, ...ids.filter((id) => !ROTATION_ORDER.includes(id))];
  const prevIndex = previousTemplateId ? fullOrder.indexOf(previousTemplateId) : -1;
  if (prevIndex === -1) {
    const firstId = fullOrder.find((id) => ids.includes(id))!;
    return pool.find((t) => t.id === firstId)!;
  }
  for (let step = 1; step <= fullOrder.length; step++) {
    const id = fullOrder[(prevIndex + step) % fullOrder.length];
    if (ids.includes(id)) return pool.find((t) => t.id === id)!;
  }
  return pool[0];
}

/**
 * 人物名から「自動」を実際のテンプレートIDへ解決する。
 * 候補が0件の場合はNoEligibleTemplateErrorを投げる（呼び出し側で明確なエラーメッセージにする）。
 */
export async function resolveAutoTemplateId(
  personName: string,
  previousTemplateId: string | null,
): Promise<string> {
  const ctx = await evaluatePersonTemplateContext(personName);
  const eligible = getEligibleTemplates(ctx);
  if (eligible.length === 0) {
    throw new NoEligibleTemplateError(
      `${personName}は投稿に使用できる出演作品・配信情報が不足しています`,
    );
  }
  return pickAutoTemplate(eligible, previousTemplateId).id;
}
