/**
 * 「works-only」テンプレート（人物写真を使わない投稿）専用のデザイン設定。
 *
 * default-person用の theme.ts（og-templates/theme.ts）とは意図的に完全に独立させている
 * （将来テンプレートごとにデザインを個別調整できるように、値を共有しない）。
 * 配色トーン（白・水色・青系アクセント）は推しサーチらしさを保つため揃えている。
 *
 * このテンプレートはInstagramの正方形投稿（1080×1080）用。
 *
 * 【今後デザインを変更するときは、基本的にこのファイルの値を書き換えるだけでよい】
 */

export const CANVAS = {
  width: 1080,
  height: 1080,
} as const;

export const FONT_FAMILY = 'Noto Sans JP';

export const COLORS = {
  background: '#ffffff',
  accent: '#1fb6e0',
  accentDark: '#0e88ac',
  accentSoft: '#e3f7fd',
  textDark: '#103349',
  white: '#ffffff',
  decorRgb: '31,182,224',
  cardBorder: '#cfeaf5',
  panelBackground: '#e4f6fc',
  panelBorder: '#d3edf7',
  /** 人物写真の代わりに表示する装飾カード群の背景・枠線 */
  artCardBackground: '#eef8fc',
  artCardBorder: '#bfe8f5',
  /** 装飾カード（抽象的な作品カード）に使う3色のパレット */
  artChipColors: ['#1fb6e0', '#0e88ac', '#8fd7ee'] as const,
} as const;

export const BRAND = {
  label: '推しサーチ',
  fontSize: 26,
  letterSpacing: 2,
} as const;

export interface DecorCircleConfig {
  size: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  opacity: number;
}
export interface DecorDotConfig {
  size: number;
  top: number;
  left?: number;
  right?: number;
}

// ─── 1枚目: 表紙（人物写真の代わりに抽象的な作品カード装飾） ─────────────────────
export const PAGE1 = {
  // 下部の余白が広すぎた点を調整（2026-09）: brandLabelMarginTop/title.marginToptを詰め、
  // artCardを大きくし、キャンバス下部の空白を大幅に縮小した。
  brandLabelMarginTop: 36,
  title: {
    marginTop: 18,
    fontSize: 46,
    lineHeight: 1.25,
    paddingX: 70,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作`, 'どのサブスクで見る？'],
  /** 人物写真の代わりに表示する装飾カードエリア */
  artCard: {
    width: 700,
    height: 630,
    marginTop: 26,
    borderRadius: 40,
    borderWidth: 4,
  },
  cta: {
    marginTop: 34,
    fontSize: 30,
    text: '出演作・配信先をまとめてチェック',
  },
  decorations: {
    circles: [
      { size: 360, left: -130, bottom: -130, opacity: 0.28 },
      { size: 380, right: -140, bottom: -100, opacity: 0.2 },
      { size: 180, right: -60, top: 30, opacity: 0.16 },
    ] as DecorCircleConfig[],
    // 下部に浮いて見えていたドット装飾は削除（2026-09）。背景の円装飾のみで十分な質感のため。
    dots: [] as DecorDotConfig[],
  },
} as const;

// ─── 2枚目: 出演作品・配信サービス一覧（default-personの2枚目デザインを流用） ─────
export const PAGE2 = {
  brandLabelMarginTop: 36,
  title: {
    marginTop: 12,
    fontSize: 40,
  },
  buildTitle: (personName: string): string => `${personName}の出演作`,
  panel: {
    marginTop: 26,
    width: 860,
    borderRadius: 44,
    borderWidth: 1,
    paddingY: 26,
    paddingX: 34,
    gap: 18,
    boxShadow: '0 16px 32px rgba(16,51,73,0.08)',
  },
  card: {
    height: 216,
    borderRadius: 26,
    borderWidth: 1.5,
    paddingY: 16,
    paddingX: 22,
    gap: 22,
    boxShadow: '0 6px 14px rgba(16,51,73,0.06)',
    image: {
      width: 110,
      height: 154,
      borderRadius: 14,
    },
    titleFontSize: 27,
    titleLineHeight: 1.25,
    vodFontSize: 20,
    vodPaddingY: 6,
    vodPaddingX: 18,
  },
  decorations: {
    circles: [
      { size: 340, left: -130, bottom: -130, opacity: 0.24 },
      { size: 360, right: -140, bottom: -110, opacity: 0.18 },
    ] as DecorCircleConfig[],
    dots: [] as DecorDotConfig[],
  },
} as const;

// ─── 3枚目: CTA専用ページ（検索窓風UI・簡易作品チップ） ───────────────────────
export const PAGE3 = {
  brandLabelMarginTop: 0,
  title: {
    marginTop: 18,
    fontSize: 48,
    lineHeight: 1.25,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作を`, 'もっとチェック'],
  subtitle: {
    marginTop: 12,
    fontSize: 23,
    lineHeight: 1.4,
    lines: ['ドラマ・映画・配信先を', '推しサーチでまとめて確認'] as [string, string],
  },
  /** 検索窓風UI＋簡易作品チップを収める装飾エリア */
  artCard: {
    width: 700,
    height: 380,
    marginTop: 30,
    borderRadius: 40,
    borderWidth: 4,
    searchBarWidth: 580,
    searchBarHeight: 74,
  },
  // 検索アイコン装飾を削除した分、CTAボタンをわずかに強調（2026-09調整）。
  cta: {
    marginTop: 34,
    width: 720,
    fontSize: 35,
    paddingY: 30,
    paddingX: 36,
    borderRadius: 28,
    boxShadow: '0 16px 32px rgba(16,51,73,0.16)',
    text: 'プロフィールのリンクから推しサーチへ',
  },
  decorations: {
    circles: [
      { size: 360, left: -130, bottom: -130, opacity: 0.26 },
      { size: 380, right: -140, bottom: -110, opacity: 0.2 },
      { size: 180, left: -60, top: 20, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [
      { size: 11, top: 220, left: 70 },
      { size: 9, top: 980, right: 90 },
    ] as DecorDotConfig[],
  },
} as const;
