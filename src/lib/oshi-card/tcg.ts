// 推し布教カードのトレカ風テンプレート（ベーシック／SSR／レジェンド）の定義（DB非依存。'use client' からも import 可）。
//
// - 人物写真・イラストは使わず、推しの名前そのものを装飾してカードの主役にする（描画は src/server/oshi-card/tcg-card-image.tsx）。
// - カスタマイズ項目：メインの名前（初期値は人物名）・特性・沼ポイント・推し力（演出の数値）・推し色。
//   すべて共有URL（nm・tr・np・pw・c）で再現し、既定値のときは URL から省く。
// - 既存の2デザイン（ノーマル＝cool／デコ＝cute）は従来どおりで、これらのパラメータは使わない。
// - 自由入力は「短い文字列」だけを受け付ける：制御文字を除き、空白をまとめ、長さを制限する。
//   URL・メールアドレス・@ID のような文字列は（宣伝・個人情報の拡散に使われないよう）受け付けず既定値に戻す。
// - 推し力はファンが楽しむための演出値。公式の評価・順位ではないことをカードと画面に明記する。

export type OshiCardTcgVariant = 'basic' | 'ssr' | 'legend';
export const OSHI_CARD_TCG_VARIANTS: readonly OshiCardTcgVariant[] = ['basic', 'ssr', 'legend'];

export function isOshiCardTcgVariant(raw: unknown): raw is OshiCardTcgVariant {
  return raw === 'basic' || raw === 'ssr' || raw === 'legend';
}

export type OshiCardColorId = 'pink' | 'red' | 'sky' | 'blue' | 'purple' | 'yellow' | 'green' | 'orange' | 'white' | 'black';

export interface OshiCardColor {
  id: OshiCardColorId;
  label: string;
  /** 主要な装飾の色 */
  base: string;
  /** 明るい色（グラデーションの上側・光） */
  light: string;
  /** 濃い色（縁取り・影） */
  deep: string;
}

export const OSHI_CARD_COLORS: readonly OshiCardColor[] = [
  { id: 'pink', label: 'ピンク', base: '#FF5FA2', light: '#FFC6DF', deep: '#D11F6C' },
  { id: 'red', label: '赤', base: '#F23B4C', light: '#FFC2C8', deep: '#B0102A' },
  { id: 'sky', label: '水色', base: '#3FC1F5', light: '#C9EFFF', deep: '#1386C2' },
  { id: 'blue', label: '青', base: '#3D6BFF', light: '#C9D6FF', deep: '#1D37B5' },
  { id: 'purple', label: '紫', base: '#9B5CFF', light: '#DECBFF', deep: '#6526CC' },
  { id: 'yellow', label: '黄色', base: '#FFC928', light: '#FFF0B0', deep: '#C98A00' },
  { id: 'green', label: '緑', base: '#2DC97A', light: '#C3F3D9', deep: '#108C54' },
  { id: 'orange', label: 'オレンジ', base: '#FF8A2B', light: '#FFD8B6', deep: '#CC5A00' },
  { id: 'white', label: '白', base: '#FFFFFF', light: '#FFFFFF', deep: '#9AA4B8' },
  { id: 'black', label: '黒', base: '#2C2C36', light: '#8C8C99', deep: '#0C0C10' },
];

export function isOshiCardColorId(raw: unknown): raw is OshiCardColorId {
  return OSHI_CARD_COLORS.some((c) => c.id === raw);
}

export function oshiCardColor(id: OshiCardColorId): OshiCardColor {
  return OSHI_CARD_COLORS.find((c) => c.id === id)!;
}

export const OSHI_CARD_TCG_TEMPLATES: Record<OshiCardTcgVariant, { label: string; hint: string; defaultColor: OshiCardColorId }> = {
  basic: { label: 'ベーシック', hint: 'ピンク・ハート・リボンのかわいいカード', defaultColor: 'pink' },
  ssr: { label: 'SSR', hint: '虹色ホログラムのキラキラカード', defaultColor: 'purple' },
  legend: { label: 'レジェンド', hint: '黒×ゴールドの高級感カード', defaultColor: 'yellow' },
};

export const OSHI_CARD_NAME_MAX = 20;
export const OSHI_CARD_TRAIT_MAX = 18;
export const OSHI_CARD_POWER_MIN = 0;
export const OSHI_CARD_POWER_MAX = 99999;

export const OSHI_CARD_DEFAULT_TRAIT = '唯一無二の魅力';
export const OSHI_CARD_DEFAULT_NUMA = '笑顔の破壊力';
export const OSHI_CARD_DEFAULT_POWER = 9999;

/** 入力の候補（タップで入れられる。自由に書き換えてもよい） */
export const OSHI_CARD_TRAIT_PRESETS = ['唯一無二の魅力', '全方位に優しい', '努力の天才', 'ギャップの宝庫', '表現力の鬼', '存在が国宝'] as const;
export const OSHI_CARD_NUMA_PRESETS = ['笑顔の破壊力', '声が良すぎる', 'ふとした仕草', '本気の眼差し', 'メンバー愛', '全部が好き'] as const;

/** 推し力はファンの気持ちを表す演出値（公式の評価・順位ではない） */
export const OSHI_CARD_POWER_NOTE = '※推し力はファンの気持ちを表す演出の数値です（公式の評価ではありません）';

export interface OshiCardTcgOptions {
  /** メインの名前。null＝人物名のまま */
  name: string | null;
  trait: string;
  numa: string;
  power: number;
  /** 推し色。null＝テンプレートの既定色 */
  color: OshiCardColorId | null;
}

export const OSHI_CARD_DEFAULT_TCG: OshiCardTcgOptions = {
  name: null,
  trait: OSHI_CARD_DEFAULT_TRAIT,
  numa: OSHI_CARD_DEFAULT_NUMA,
  power: OSHI_CARD_DEFAULT_POWER,
  color: null,
};

// URL・メールアドレス・@ID・電話番号のような文字列（自由入力では受け付けない）
const LINK_LIKE = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|jp|co|io|me|ly|link|xyz|info|app)\b|@[a-z0-9_]{2,}|\d{2,4}-\d{2,4}-\d{3,4})/i;

/**
 * 自由入力の文字列をそろえる：制御文字・改行を除き、連続する空白を1つにし、前後の空白を除いて max 文字（コードポイント）まで。
 * 空・リンクのような文字列は null（呼び出し側で既定値を使う）。
 */
export function sanitizeOshiCardText(raw: string | null | undefined, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\t\n\r\f\v]/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || LINK_LIKE.test(cleaned)) return null;
  return [...cleaned].slice(0, max).join('').trim() || null;
}

export function sanitizeOshiCardPower(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return Math.min(OSHI_CARD_POWER_MAX, Math.max(OSHI_CARD_POWER_MIN, n));
}

/** 推し力の表示（3桁区切り） */
export function formatOshiCardPower(n: number): string {
  return n.toLocaleString('en-US');
}

type RawParam = string | string[] | undefined | null;
const first = (raw: RawParam): string | undefined => (Array.isArray(raw) ? raw[0] : raw ?? undefined);

/** URL の nm・tr・np・pw・c を検証して取り出す（不正な値は既定値）。person と同じ名前は省略扱い（null） */
export function parseOshiCardTcgOptions(params: { nm?: RawParam; tr?: RawParam; np?: RawParam; pw?: RawParam; c?: RawParam }, person: string | null): OshiCardTcgOptions {
  const name = sanitizeOshiCardText(first(params.nm), OSHI_CARD_NAME_MAX);
  const color = first(params.c);
  return {
    name: name && name !== person ? name : null,
    trait: sanitizeOshiCardText(first(params.tr), OSHI_CARD_TRAIT_MAX) ?? OSHI_CARD_DEFAULT_TRAIT,
    numa: sanitizeOshiCardText(first(params.np), OSHI_CARD_TRAIT_MAX) ?? OSHI_CARD_DEFAULT_NUMA,
    power: sanitizeOshiCardPower(first(params.pw)) ?? OSHI_CARD_DEFAULT_POWER,
    color: isOshiCardColorId(color) ? color : null,
  };
}

/** テンプレートの既定色と同じ色は省略扱い（null）にそろえる */
export function normalizeOshiCardTcgOptions(opts: OshiCardTcgOptions, variant: OshiCardTcgVariant, person: string): OshiCardTcgOptions {
  return {
    name: opts.name && opts.name !== person ? opts.name : null,
    trait: opts.trait,
    numa: opts.numa,
    power: opts.power,
    color: opts.color && opts.color !== OSHI_CARD_TCG_TEMPLATES[variant].defaultColor ? opts.color : null,
  };
}

/** 共有URL用のクエリ（既定値は省略）。順序は nm・tr・np・pw・c で固定（正規形） */
export function oshiCardTcgQueryParts(opts: OshiCardTcgOptions): string[] {
  const parts: string[] = [];
  if (opts.name) parts.push(`nm=${encodeURIComponent(opts.name)}`);
  if (opts.trait !== OSHI_CARD_DEFAULT_TRAIT) parts.push(`tr=${encodeURIComponent(opts.trait)}`);
  if (opts.numa !== OSHI_CARD_DEFAULT_NUMA) parts.push(`np=${encodeURIComponent(opts.numa)}`);
  if (opts.power !== OSHI_CARD_DEFAULT_POWER) parts.push(`pw=${opts.power}`);
  if (opts.color) parts.push(`c=${opts.color}`);
  return parts;
}

export const OSHI_CARD_TCG_QUERY_KEYS = ['nm', 'tr', 'np', 'pw', 'c'] as const;

/** 作成画面の入力中の値（文字列のまま。カードに使う値には oshiCardTcgFromDraft で変換する） */
export interface OshiCardTcgDraft {
  /** 空文字＝人物名のまま */
  name: string;
  trait: string;
  numa: string;
  /** 入力中の文字列（数字以外は使わない） */
  power: string;
  /** null＝テンプレートの色 */
  color: OshiCardColorId | null;
}

export function oshiCardTcgDraftFrom(opts: OshiCardTcgOptions): OshiCardTcgDraft {
  return { name: opts.name ?? '', trait: opts.trait, numa: opts.numa, power: String(opts.power), color: opts.color };
}

/** 入力中の値 → カードに使う値（空・不正な値は既定値。人物名と同じ名前は省略扱い） */
export function oshiCardTcgFromDraft(draft: OshiCardTcgDraft, person: string): OshiCardTcgOptions {
  const name = sanitizeOshiCardText(draft.name, OSHI_CARD_NAME_MAX);
  return {
    name: name && name !== person ? name : null,
    trait: sanitizeOshiCardText(draft.trait, OSHI_CARD_TRAIT_MAX) ?? OSHI_CARD_DEFAULT_TRAIT,
    numa: sanitizeOshiCardText(draft.numa, OSHI_CARD_TRAIT_MAX) ?? OSHI_CARD_DEFAULT_NUMA,
    power: sanitizeOshiCardPower(draft.power) ?? OSHI_CARD_DEFAULT_POWER,
    color: draft.color,
  };
}
