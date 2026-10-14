// 動画生成ジョブのテンプレート固有入力（video_generation_jobs.template_input）。DB非依存（'use client' からも import 可）。
//
// 従来のテンプレート（1ジョブ=1人物）は template_input を使わない（NULL のまま）。
// 複数人物を1本の動画にするテンプレートだけが、Workerの報告するテンプレート情報の templateInputKind で
// 入力の種類を宣言し、ジョブ作成時にここで検証した値を template_input に保存する。
// 人物の識別子は推しサーチDBの人物slug（personVideoSlug: 'p-' + sha256(人物名)の先頭12桁）を正本にする。

/** 推しでサブスク比較（3人の推しに合うサブスク診断）: 人物3人 */
export const OSHI_VOD_COMPARE_INPUT_KIND = 'oshi-vod-compare-persons' as const;
export const OSHI_VOD_COMPARE_PERSON_COUNT = 3;

export type TemplateInputKind = typeof OSHI_VOD_COMPARE_INPUT_KIND;
export const TEMPLATE_INPUT_KINDS: readonly TemplateInputKind[] = [OSHI_VOD_COMPARE_INPUT_KIND];

export interface OshiVodCompareTemplateInput {
  version: 1;
  /** 選択順（人物1→人物3）。動画内の表示順・診断の人物順になる */
  personSlugs: [string, string, string];
}

export type VideoTemplateInput = OshiVodCompareTemplateInput;

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

/** テンプレートの入力種別に応じて検証する */
export function parseTemplateInput(kind: TemplateInputKind, raw: unknown): VideoTemplateInput {
  switch (kind) {
    case OSHI_VOD_COMPARE_INPUT_KIND:
      return parseOshiVodCompareInput(raw);
  }
}
