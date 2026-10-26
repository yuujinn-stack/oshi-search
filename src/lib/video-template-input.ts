// 動画生成ジョブのテンプレート固有入力（video_generation_jobs.template_input）。DB非依存（'use client' からも import 可）。
//
// 従来のテンプレート（1ジョブ=1人物）は template_input を使わない（NULL のまま）。
// 複数人物を1本の動画にするテンプレートだけが、Workerの報告するテンプレート情報の templateInputKind で
// 入力の種類を宣言し、ジョブ作成時にここで検証した値を template_input に保存する。
// 人物の識別子は推しサーチDBの人物slug（personVideoSlug: 'p-' + sha256(人物名)の先頭12桁）を正本にする。

/** 推しでサブスク比較（3人の推しに合うサブスク診断）: 人物3人 */
export const OSHI_VOD_COMPARE_INPUT_KIND = 'oshi-vod-compare-persons' as const;
export const OSHI_VOD_COMPARE_PERSON_COUNT = 3;

/**
 * 推し布教カード紹介: 1ジョブ=1人物のまま、おすすめ作品（1〜3件・選んだ順）とデザインを保存する。
 * 作品がその人物の公開作品かどうかは、ジョブ作成時にサーバーで確認する（src/server/video-jobs/job-store.ts）
 */
export const OSHI_CARD_SELECTION_INPUT_KIND = 'oshi-card-selection' as const;
export const OSHI_CARD_VIDEO_MAX_WORKS = 3;

export type TemplateInputKind = typeof OSHI_VOD_COMPARE_INPUT_KIND | typeof OSHI_CARD_SELECTION_INPUT_KIND;
export const TEMPLATE_INPUT_KINDS: readonly TemplateInputKind[] = [OSHI_VOD_COMPARE_INPUT_KIND, OSHI_CARD_SELECTION_INPUT_KIND];

export interface OshiVodCompareTemplateInput {
  version: 1;
  /** 選択順（人物1→人物3）。動画内の表示順・診断の人物順になる */
  personSlugs: [string, string, string];
}

export interface OshiCardSelectionTemplateInput {
  version: 1;
  /** works.id（選んだ順にカードへ載る。公式の順位ではない） */
  workIds: string[];
  /** cool＝ノーマル・cute＝デコ（布教カードの共有URLの v と同じ値） */
  variant: 'cool' | 'cute';
}

export type VideoTemplateInput = OshiVodCompareTemplateInput | OshiCardSelectionTemplateInput;

/** personVideoSlug の形式 */
const PERSON_SLUG_PATTERN = /^p-[0-9a-f]{12}$/;

export function isTemplateInputKind(value: unknown): value is TemplateInputKind {
  return typeof value === 'string' && (TEMPLATE_INPUT_KINDS as readonly string[]).includes(value);
}

export class TemplateInputError extends Error {}

/**
 * 推しでサブスク比較の入力を検証して正規化する（3人ちょうど・重複なし・slug形式・順番を保持）。
 * DBに存在するかどうかは呼び出し側（サーバー）で確認する。
 */
export function parseOshiVodCompareInput(raw: unknown): OshiVodCompareTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('人物3人の指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  const slugs = obj.personSlugs;
  if (!Array.isArray(slugs)) throw new TemplateInputError('人物3人の指定がありません。');
  if (slugs.length !== OSHI_VOD_COMPARE_PERSON_COUNT) {
    throw new TemplateInputError(`人物は${OSHI_VOD_COMPARE_PERSON_COUNT}人ちょうど選んでください（指定: ${slugs.length}人）。`);
  }
  for (const s of slugs) {
    if (typeof s !== 'string' || !PERSON_SLUG_PATTERN.test(s)) throw new TemplateInputError('不正な人物の指定があります。');
  }
  if (new Set(slugs).size !== slugs.length) throw new TemplateInputError('同じ人物が重複して選ばれています。');
  return { version: 1, personSlugs: [slugs[0], slugs[1], slugs[2]] as [string, string, string] };
}

const WORK_ID_MAX_LENGTH = 200;

/** 推し布教カード紹介の入力を検証して正規化する（1〜3件・重複なし・順番を保持・デザインは cool / cute） */
export function parseOshiCardSelectionInput(raw: unknown): OshiCardSelectionTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('おすすめ作品とデザインの指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  const ids = obj.workIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > OSHI_CARD_VIDEO_MAX_WORKS) {
    throw new TemplateInputError(`おすすめ作品は1〜${OSHI_CARD_VIDEO_MAX_WORKS}件選んでください。`);
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || id.length > WORK_ID_MAX_LENGTH) throw new TemplateInputError('不正な作品の指定があります。');
  }
  if (new Set(ids).size !== ids.length) throw new TemplateInputError('同じ作品が重複して選ばれています。');
  if (obj.variant !== 'cool' && obj.variant !== 'cute') throw new TemplateInputError('デザインはノーマルかデコを選んでください。');
  return { version: 1, workIds: [...(ids as string[])], variant: obj.variant };
}

/** テンプレートの入力種別に応じて検証する */
export function parseTemplateInput(kind: TemplateInputKind, raw: unknown): VideoTemplateInput {
  switch (kind) {
    case OSHI_VOD_COMPARE_INPUT_KIND:
      return parseOshiVodCompareInput(raw);
    case OSHI_CARD_SELECTION_INPUT_KIND:
      return parseOshiCardSelectionInput(raw);
  }
}
