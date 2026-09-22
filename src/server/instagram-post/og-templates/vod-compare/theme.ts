/**
 * 「vod-compare」テンプレート（配信サービス比較、人物写真なし）専用のデザイン設定。
 * 他の写真なしテンプレート（works-only・works-picks）とは独立しており、値を共有しない。
 * 配色トーンは推しサーチらしさを保つため他テンプレートと揃えている。
 * Instagramの正方形投稿（1080×1080）用。
 *
 * 実在サービスの公式ロゴ画像は一切使用せず、サービス名はテキストのみで表示する。
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
  barTrack: '#e3f7fd',
  barFill: '#0e88ac',
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

// ─── 1枚目: 表紙（比較バーのプレビュー風装飾、人物写真は使わない） ───────────────
export const PAGE1 = {
  brandLabelMarginTop: 40,
  title: {
    marginTop: 20,
    fontSize: 46,
    lineHeight: 1.3,
    paddingX: 70,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}を見るなら`, 'どのサブスク？'],
  /** 実データではない「比較バー風」のプレビュー装飾（本物の集計は2枚目に表示） */
  previewCard: {
    width: 760,
    height: 560,
    marginTop: 46,
    borderRadius: 40,
    borderWidth: 4,
    barHeight: 26,
    barWidths: [560, 420, 300] as const,
  },
  cta: {
    marginTop: 40,
    fontSize: 30,
    text: '配信サービスをまとめて比較',
  },
  decorations: {
    circles: [
      { size: 360, left: -130, bottom: -130, opacity: 0.28 },
      { size: 380, right: -140, bottom: -100, opacity: 0.2 },
      { size: 180, right: -60, top: 30, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [] as DecorDotConfig[],
  },
} as const;

// ─── 2枚目: サービス別の作品数比較（実データ） ─────────────────────────────────
export const PAGE2 = {
  brandLabelMarginTop: 36,
  title: {
    marginTop: 12,
    fontSize: 38,
  },
  buildTitle: (personName: string): string => `${personName}の配信サービス比較`,
  panel: {
    marginTop: 40,
    width: 860,
    borderRadius: 44,
    borderWidth: 1,
    paddingY: 40,
    paddingX: 44,
    boxShadow: '0 16px 32px rgba(16,51,73,0.08)',
  },
  row: {
    gap: 34,
    labelFontSize: 27,
    countFontSize: 24,
    barHeight: 28,
    barRadius: 14,
    /** 件数が最大件数に対してごく小さい場合でも視認できる最小バー幅（px） */
    minBarWidth: 60,
  },
  decorations: {
    circles: [
      { size: 340, left: -130, bottom: -130, opacity: 0.24 },
      { size: 360, right: -140, bottom: -110, opacity: 0.18 },
    ] as DecorCircleConfig[],
    dots: [] as DecorDotConfig[],
  },
} as const;

// ─── 3枚目: CTA専用ページ ────────────────────────────────────────────────────
export const PAGE3 = {
  brandLabelMarginTop: 0,
  title: {
    marginTop: 24,
    fontSize: 50,
    lineHeight: 1.3,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作・配信先を`, 'まとめてチェック'],
  cta: {
    marginTop: 56,
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
      { size: 380, left: -140, bottom: -140, opacity: 0.28 },
      { size: 400, right: -150, bottom: -110, opacity: 0.2 },
      { size: 200, left: -60, top: 20, opacity: 0.16 },
      { size: 180, right: -60, top: 60, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [
      { size: 12, top: 240, left: 90 },
    ] as DecorDotConfig[],
  },
} as const;
