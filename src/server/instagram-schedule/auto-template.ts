import 'server-only';
import { INSTAGRAM_TEMPLATES, type InstagramTemplateMeta } from '@/lib/instagram-templates';
import { fetchPersonWorks } from '../instagram-post/person-data';
import { findExistingPersonPhoto } from '../instagram-post/blob';
import { aggregateVodCounts } from '../instagram-post/build-post-vod-compare';

/**
 * 「自動（おすすめ）」テンプレート選択のロジック。
 * 人物ごとの実データ（人物写真の有無・出演作品件数・異なる配信サービス数）から
 * 候補テンプレートを絞り込み、直前に使われたテンプレートを避けるようローテーションする。
 *
 * 条件判定に使う人物写真・作品・配信サービスの取得処理は既存の関数
 * （findExistingPersonPhoto / fetchPersonWorks / aggregateVodCounts）をそのまま再利用し、
 * 新しい重複ロジックは作らない。
 */

export interface PersonTemplateContext {
  hasPhoto: boolean;
  workCount: number;
  vodServiceCount: number;
}

export class NoEligibleTemplateError extends Error {}

/** 人物名から、テンプレート条件判定に必要な実データをまとめて取得する（読み取り専用） */
export async function evaluatePersonTemplateContext(personName: string): Promise<PersonTemplateContext> {
  const [personData, photoUrl] = await Promise.all([
    fetchPersonWorks(personName),
    findExistingPersonPhoto(personName),
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
  };
}

export function isTemplateEligible(meta: InstagramTemplateMeta, ctx: PersonTemplateContext): boolean {
  if (meta.requiresPersonPhoto && !ctx.hasPhoto) return false;
  if (ctx.workCount < meta.minWorks) return false;
  if (ctx.vodServiceCount < meta.minVodServices) return false;
  return true;
}

/** 条件を満たすテンプレート一覧（INSTAGRAM_TEMPLATESの並び順を保つ） */
export function getEligibleTemplates(ctx: PersonTemplateContext): InstagramTemplateMeta[] {
  return INSTAGRAM_TEMPLATES.filter((t) => isTemplateEligible(t, ctx));
}

/**
 * ローテーションの基準となる並び順。ここに含まれない（＝将来追加された）候補テンプレートは
 * 末尾に追加されるため、ローテーション対象から漏れることはない。
 */
const ROTATION_ORDER = ['works-only', 'works-picks', 'vod-compare', 'default-person'];

/**
 * 候補テンプレートの中から、直前に使われたテンプレート（previousTemplateId）の次を選ぶ。
 * 完全ランダムにはせず、ROTATION_ORDERに沿った決定的な巡回にすることで
 * 「同じテンプレートが連続しにくい」を確実に満たす（候補が2種類以上あれば連続を100%回避する）。
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
  const orderedIds = [
    ...ROTATION_ORDER.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !ROTATION_ORDER.includes(id)),
  ];

  const prevIndex = previousTemplateId ? orderedIds.indexOf(previousTemplateId) : -1;
  const nextId = prevIndex === -1 ? orderedIds[0] : orderedIds[(prevIndex + 1) % orderedIds.length];
  return pool.find((t) => t.id === nextId)!;
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
