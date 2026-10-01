/**
 * G（search-too-much）・J（real-screen）の生成条件と、J が作れない場合のフォールバック先の判定、キャプション（純粋関数）。
 * 数字はすべて人物ページと同じ集計（site-ui/data.ts）の値。推測で補わない。
 */
import { buildWatchAndBuyHashtags } from './h-schedule';

/** 判定に使う集計値（SiteUiPersonData の一部） */
export interface GjCounts {
  workCount: number;
  productCount: number;
  serviceCountExcludingYouTube: number;
  streamingWorkCountExcludingYouTubeOnly: number;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** G：2枚目の3つの件数（出演作品・配信サービス・関連商品）がどれも0件でないこと */
export function checkSearchTooMuchEligibility(c: GjCounts): Eligibility {
  if (c.workCount === 0) return { ok: false, reason: '出演作品がありません' };
  if (c.serviceCountExcludingYouTube === 0) return { ok: false, reason: '配信サービス（YouTube系を除く）がありません' };
  if (c.productCount === 0) return { ok: false, reason: '関連商品がありません' };
  return { ok: true };
}

/** J の2枚目に並べる作品数（画像のある作品がこの件数そろわなければ J は作らない） */
export const REAL_SCREEN_WORK_COUNT = 3;
/** J の2枚目の作品を探す範囲（配信中の作品の先頭から。H 2枚目と同じ並び順） */
export const REAL_SCREEN_SCAN_LIMIT = 8;
/** J は3枚目で「関連商品も探せる」を見せるため、関連商品がこの件数以上ある人物だけ */
export const REAL_SCREEN_MIN_PRODUCTS = 3;

/**
 * J（画像の取得前に分かる条件）：作品・配信先と関連商品の両方を見せられること。
 * 配信サービス（YouTube系を除く）が1社以上、関連商品が REAL_SCREEN_MIN_PRODUCTS 件以上、配信中の作品（YouTube系のみを除く）が3件以上。
 */
export function checkRealScreenBaseEligibility(c: GjCounts): Eligibility {
  if (c.serviceCountExcludingYouTube === 0) return { ok: false, reason: '配信サービス（YouTube系を除く）がありません' };
  if (c.productCount < REAL_SCREEN_MIN_PRODUCTS) {
    return { ok: false, reason: c.productCount === 0 ? '関連商品がありません' : `関連商品が${c.productCount}件で、${REAL_SCREEN_MIN_PRODUCTS}件に足りません` };
  }
  if (c.streamingWorkCountExcludingYouTubeOnly < REAL_SCREEN_WORK_COUNT) {
    return { ok: false, reason: `配信中の作品（YouTube系のみを除く）が${c.streamingWorkCountExcludingYouTubeOnly}件で、${REAL_SCREEN_WORK_COUNT}件に足りません` };
  }
  return { ok: true };
}

export type RealScreenDecision =
  | { use: 'J' }
  | { use: 'H' | 'G'; reason: string }
  | { use: 'none'; reason: string };

/**
 * J を作るか、作れない場合にどれへ切り替えるかを決める。優先順は J → H → G。
 * worksWithImage：配信中の作品の先頭（最大 REAL_SCREEN_SCAN_LIMIT 件）のうち、画像を読み込めた作品数。
 */
export function decideRealScreenTemplate(input: {
  base: Eligibility;
  worksWithImage: number;
  hOk: boolean;
  gOk: boolean;
}): RealScreenDecision {
  const jReason = !input.base.ok
    ? input.base.reason
    : input.worksWithImage < REAL_SCREEN_WORK_COUNT
      ? `画像のある配信中の作品が${input.worksWithImage}件で、${REAL_SCREEN_WORK_COUNT}件に足りません`
      : null;
  if (!jReason) return { use: 'J' };
  if (input.hOk) return { use: 'H', reason: `Jの条件を満たさないため（${jReason}）、Hで作成しました` };
  if (input.gOk) return { use: 'G', reason: `Jの条件を満たさないため（${jReason}）、Gで作成しました` };
  return { use: 'none', reason: `J・H・Gのいずれも作成できません（J：${jReason}）` };
}

/** G のキャプション（予約前に管理画面で編集できる初期値） */
export function buildSearchTooMuchCaption(personName: string): string {
  return [
    `${personName}の出演作品、配信先、関連商品。`,
    '推し活、検索しすぎていませんか？',
    '',
    '推しサーチなら、',
    '人物名ひとつでまとめて探せます。',
    '',
    '気になる推しができたら',
    'プロフィールのリンクから「推しサーチ」へ。',
    '',
    '※配信情報・商品情報は確認時点の情報です。',
    '',
    ...buildWatchAndBuyHashtags(personName).split(' '),
  ].join('\n');
}

/** J のキャプション。件数・商品カテゴリは画像と同じ集計値 */
export function buildRealScreenCaption(
  personName: string,
  c: { workCount: number; serviceCount: number; productCount: number; productLabels?: string[] },
): string {
  const labels = (c.productLabels ?? []).map((l) => (l === '写真集・書籍' ? '写真集' : l === 'Blu-ray・DVD' ? 'Blu-ray/DVD' : l));
  return [
    `${personName}、推しサーチで検索してみました。`,
    '',
    `出演作品 ${c.workCount}件`,
    `配信サービス ${c.serviceCount}社`,
    `関連商品 ${c.productCount}件`,
    '',
    '見たい作品がどこで配信中かも、',
    labels.length > 0 ? `${labels.join('・')}などの関連商品も、` : '関連商品も、',
    'まとめて探せます。',
    '',
    'プロフィールのリンクから「推しサーチ」へ。',
    '',
    '※配信情報・商品情報は確認時点の情報です。',
    '',
    ...buildWatchAndBuyHashtags(personName).split(' '),
  ].join('\n');
}
