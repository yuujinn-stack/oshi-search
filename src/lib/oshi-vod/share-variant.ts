// 診断結果のシェア画像デザイン（かっこいい／可愛い）の定義（DB非依存。'use client' からも import 可）。
// デザインは見た目だけの違いで、画像に載せる情報・数値（image-data.ts）は両パターンで共通。

export type OshiVodShareVariant = 'cool' | 'cute';

export const OSHI_VOD_SHARE_VARIANTS: readonly OshiVodShareVariant[] = ['cool', 'cute'];

/** 指定なし・不正値のときのデザイン（以前の共有画像URL `?p=...` もこれで描画される） */
export const OSHI_VOD_DEFAULT_SHARE_VARIANT: OshiVodShareVariant = 'cool';

export const OSHI_VOD_SHARE_VARIANT_LABELS: Record<OshiVodShareVariant, string> = {
  cool: 'かっこいい',
  cute: '可愛い',
};

export function isOshiVodShareVariant(raw: unknown): raw is OshiVodShareVariant {
  return raw === 'cool' || raw === 'cute';
}

export function parseOshiVodShareVariant(raw: string | string[] | null | undefined): OshiVodShareVariant {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isOshiVodShareVariant(v) ? v : OSHI_VOD_DEFAULT_SHARE_VARIANT;
}
