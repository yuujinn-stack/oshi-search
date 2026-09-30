/**
 * Preview専用の投稿テンプレート候補（5種類）共通のデザイン設定。
 * 既存4テンプレート・search-flow とは独立しており、値を共有しない。
 * 配色は推しサーチの水色系ブランド（accent / accentDark / accentSoft / navy）に揃える。
 *
 * - Instagramの正方形投稿（1080×1080）用。
 * - 白一色で弱く見えないよう、ページごとに水色グラデーション・濃紺・白カードを使い分ける。
 * - 文字サイズは「1080px画像がスマホのフィードで約1/3に縮小される」前提で、
 *   注記以外は最小26px以上にしている。
 */

export const CANVAS = { width: 1080, height: 1080 } as const;

export const FONT_FAMILY = 'Noto Sans JP';

export const COLORS = {
  accent: '#1fb6e0',
  accentDark: '#0e88ac',
  accentSoft: '#e3f7fd',
  /** 濃紺（推しサーチの本文色）。コントラストを出すページの背景にも使う */
  navy: '#103349',
  navySoft: '#1d4a66',
  textDark: '#103349',
  textMuted: '#4d6f80',
  /** 濃紺背景上の補足文字 */
  textOnNavyMuted: '#a9dcee',
  white: '#ffffff',
  cardBorder: '#cfeaf5',
  fallbackFrom: '#d9f3fb',
  fallbackTo: '#f6fcfe',
  glowRgb: '255,255,255',
} as const;

export const BACKGROUNDS = {
  /** 濃い水色（表紙向け） */
  cyan: 'linear-gradient(180deg, #aee9f8 0%, #d8f4fc 55%, #eefafd 100%)',
  /** 淡い水色（情報ページ向け） */
  pale: 'linear-gradient(180deg, #dcf4fc 0%, #f1fbfe 100%)',
  /** 濃紺（コントラスト重視のページ向け） */
  navy: 'linear-gradient(160deg, #103349 0%, #164864 60%, #0e5f80 100%)',
} as const;

export const BRAND = { label: '推しサーチ', letterSpacing: 2 } as const;

/** 全テンプレート共通の文言 */
export const COMMON_TEXT = {
  cta: 'プロフィールのリンクから推しサーチへ',
  vodNote: '※配信情報は確認時点の情報です',
  swipe: 'スワイプ',
} as const;

export interface DecorCircleConfig {
  size: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  opacity: number;
}

export const GLOW_TOP_LEFT_BOTTOM_RIGHT: DecorCircleConfig[] = [
  { size: 420, left: -170, top: -150, opacity: 0.55 },
  { size: 380, right: -160, bottom: -140, opacity: 0.45 },
];
