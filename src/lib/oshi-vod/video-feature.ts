// 動画「推しでサブスク比較」: 診断結果から、動画の独自結果シーン（＝ナレーション台本）の種類を判定する（純粋関数）。
// 正本は oshi-video-maker の decideVodCompareFeature / vodCompareNarrationFeature（台本の文章はあちら側だけが持つ）。
// ここでは同じ条件で「種類」だけを求め、Workerが報告したテンプレート共通CapCut音声の利用条件（requires）と照らし合わせる。
// 種類が同じなら台本は完全に同じになる（Worker側でも生成直前に台本ハッシュで最終確認する）。

import type { VideoDiagnosisPayload } from './video-payload';

/** pair=2サービスの組み合わせ（80%以上の表示なし） / pair-over80=その組み合わせで80%以上 / single=組み合わせなし / single-covers-all=1サービスで全作品 */
export type OshiVodVideoFeature = 'pair' | 'pair-over80' | 'single' | 'single-covers-all';

const FEATURES: readonly OshiVodVideoFeature[] = ['pair', 'pair-over80', 'single', 'single-covers-all'];

/** Workerが報告する共通CapCut音声の利用条件の種別（推しでサブスク比較の台本の種類） */
export const OSHI_VOD_COMPARE_FEATURE_REQUIREMENT = 'oshi-vod-compare-feature';

/**
 * 動画「サブスク比較機能紹介」: 共通CapCut音声の台本が診断結果に依存しない（固定文だけ）ことを表す利用条件の種別。
 * この種別のときだけ、診断結果の種類を見ずに共通音声を使える
 */
export const OSHI_VOD_COMPARE_ANY_REQUIREMENT = 'oshi-vod-compare-any';

export type SharedCapcutRequirement =
  | { kind: typeof OSHI_VOD_COMPARE_FEATURE_REQUIREMENT; feature: OshiVodVideoFeature }
  | { kind: typeof OSHI_VOD_COMPARE_ANY_REQUIREMENT };

/** 共通CapCut音声を使えない3人のとき、管理画面・ジョブ作成で表示する理由 */
export const VOD_COMPARE_CAPCUT_MISMATCH_MESSAGE =
  'この3人の診断結果は保存済みCapCut音声の台本と一致しないため、音声なしで生成してください';

type FeatureInput = Pick<VideoDiagnosisPayload, 'bestPair' | 'singleCoversAll' | 'over80'>;

function sameServices(a: Array<{ service: string }>, b: Array<{ service: string }>): boolean {
  return a.map((s) => s.service).sort().join('|') === b.map((s) => s.service).sort().join('|');
}

/** 診断結果の台本の種類（oshi-video-maker の vodCompareNarrationFeature と同じ条件） */
export function oshiVodVideoFeature(d: FeatureInput): OshiVodVideoFeature {
  const pair = d.bestPair;
  if (!pair || pair.services.length < 2 || d.singleCoversAll) return d.singleCoversAll ? 'single-covers-all' : 'single';
  const over80 = d.over80.achieved && !!d.over80.combo && sameServices(d.over80.combo.services, pair.services);
  return over80 ? 'pair-over80' : 'pair';
}

/** Worker報告の requires を検証する（知らない種別・不正な値は null = 条件不明） */
export function parseSharedCapcutRequirement(raw: unknown): SharedCapcutRequirement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === OSHI_VOD_COMPARE_ANY_REQUIREMENT) return { kind: OSHI_VOD_COMPARE_ANY_REQUIREMENT };
  if (r.kind !== OSHI_VOD_COMPARE_FEATURE_REQUIREMENT) return null;
  if (typeof r.feature !== 'string' || !(FEATURES as readonly string[]).includes(r.feature)) return null;
  return { kind: OSHI_VOD_COMPARE_FEATURE_REQUIREMENT, feature: r.feature as OshiVodVideoFeature };
}

export type VodCompareCapcutCheck = { ok: true } | { ok: false; reason: string };

/**
 * 推しでサブスク比較で、この3人の診断結果がテンプレート共通CapCut音声を使えるか。
 * Workerが共通音声を報告していない・準備できていない・利用条件が不明・種類が違う場合は使えない（安全側）。
 */
export function checkVodCompareSharedCapcut(
  template: { narrationModes: string[]; sharedCapcut?: { ready: boolean; message: string; requires?: SharedCapcutRequirement } },
  diagnosis: FeatureInput,
): VodCompareCapcutCheck {
  if (!template.narrationModes.includes('capcut') || !template.sharedCapcut) {
    return { ok: false, reason: 'このテンプレートは現在CapCutナレーションに対応していません（Workerの報告待ち）。音声なしで生成してください' };
  }
  if (!template.sharedCapcut.ready) {
    return { ok: false, reason: `共通CapCut音声が使えないため生成できません: ${template.sharedCapcut.message}` };
  }
  const requires = template.sharedCapcut.requires;
  if (!requires) {
    return { ok: false, reason: '共通CapCut音声の利用条件をWorkerから確認できません。音声なしで生成してください' };
  }
  // 台本が診断結果に依存しない共通音声（サブスク比較機能紹介）は、どの3人でも使える
  if (requires.kind === OSHI_VOD_COMPARE_ANY_REQUIREMENT) return { ok: true };
  if (oshiVodVideoFeature(diagnosis) !== requires.feature) return { ok: false, reason: VOD_COMPARE_CAPCUT_MISMATCH_MESSAGE };
  return { ok: true };
}
