/**
 * Instagram投稿画像3枚（1〜3枚目）の見た目に関する設定を、すべてこの1ファイルに集約したもの。
 *
 * 【今後デザインを変更するときは、基本的にこのファイルの値を書き換えるだけでよい】
 * ・生成ロジック（og-render.tsx）・API処理（build-post.ts等）・Instagram API・DB・
 *   Vercel Blobの処理には一切触れる必要がない。
 * ・色を変える → COLORS
 * ・文字サイズ・余白・角丸・カードサイズを変える → PAGE1 / PAGE2 / PAGE3 の該当項目
 * ・CTA文言・タイトル文言を変える → 各ページの text / buildTitleLines 等
 * ・「推しサーチ」ロゴ（ワードマーク）表示を変える → BRAND
 *
 * 装飾円・ドットの座標（circles/dots）は各ページのレイアウトに強く紐づく数値のため、
 * 便宜上COLORS等とは別に各ページの設定内に置いているが、置き場所は同じくこのファイル。
 *
 * 値を変えるだけでは対応できない「構造的な変更」（例: カードの並びを横並びにする、
 * 4枚目を追加する等）は各ページのテンプレートファイル（page1.tsx〜page3.tsx）を編集する。
 */

export const CANVAS = {
  width: 1080,
  height: 1350,
} as const;

/** 全ページ共通のフォント（next/og(Satori)に渡す日本語フォント名と一致させること） */
export const FONT_FAMILY = 'Noto Sans JP';

/** 配色。ここを変えると3枚すべてに反映される（背景色・メインカラー・アクセントカラー・文字色） */
export const COLORS = {
  /** 背景色（1〜3枚目共通） */
  background: '#ffffff',
  /** メインカラー（現状はaccentDarkと同系統で運用。将来的にボタン等の主色を分けたい場合はここを使う） */
  accent: '#1fb6e0',
  /** アクセントカラー（ブランドラベル・CTA文言・CTAボタン背景・VODバッジ文字色などに使用） */
  accentDark: '#0e88ac',
  /** 淡いアクセント（VODバッジの背景・作品画像の背景プレースホルダー） */
  accentSoft: '#e3f7fd',
  /** 本文・タイトルの文字色 */
  textDark: '#103349',
  white: '#ffffff',
  /** 背景装飾円・ドットの色（R,G,Bのみ。透明度は各装飾のopacityで指定） */
  decorRgb: '31,182,224',
  /** 人物写真フレームの枠線色（1・3枚目共通） */
  photoFrameBorder: '#bfe8f5',
  /** 人物写真フレームの背景色（画像読み込み前や余白部分に見える色） */
  photoFrameBackground: '#eef8fc',
  /** 2枚目の作品一覧パネルの背景色 */
  panelBackground: '#e4f6fc',
  panelBorder: '#d3edf7',
  /** 2枚目の作品カードの枠線色 */
  cardBorder: '#cfeaf5',
  /** 3枚目の写真下に重ねるブランド帯の背景色 */
  overlayBackground: 'rgba(16,51,73,0.55)',
  /** 3枚目のブランド帯に表示する人物名の文字色 */
  overlayNameColor: '#cdeefb',
} as const;

/** 「推しサーチ」ロゴ（ワードマーク）表示に関する設定。3ページ共通のスタイルを1箇所で管理する */
export const BRAND = {
  label: '推しサーチ',
  fontSize: 28,
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

// ─── 1枚目: 人物写真 ─────────────────────────────────────────────────────────
export const PAGE1 = {
  brandLabelMarginTop: 72,
  title: {
    marginTop: 28,
    fontSize: 53,
    lineHeight: 1.3,
    paddingX: 64,
  },
  /** 人物写真のサイズ・角丸・余白 */
  photo: {
    width: 670,
    height: 730,
    marginTop: 46,
    borderRadius: 36,
    borderWidth: 6,
    objectPosition: 'center 18%',
  },
  /** CTA文言・文字サイズ・余白 */
  cta: {
    marginTop: 40,
    fontSize: 37,
    text: '出演作や配信先をチェック',
  },
  /** タイトル文言（2行）。人物名を差し込む部分だけ関数にしている */
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作`, 'どのサブスクで見る？'],
  decorations: {
    circles: [
      { size: 420, left: -140, bottom: -140, opacity: 0.3 },
      { size: 460, right: -160, bottom: -80, opacity: 0.22 },
      { size: 220, left: -80, top: -80, opacity: 0.16 },
      { size: 180, right: -60, top: 40, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [
      { size: 14, top: 640, right: 150 },
      { size: 10, top: 930, left: 60 },
      { size: 8, top: 1050, right: 70 },
    ] as DecorDotConfig[],
  },
} as const;

// ─── 2枚目: 出演作品・配信サービス一覧 ────────────────────────────────────────
export const PAGE2 = {
  // 上部の余白（ブランドラベル・タイトル・パネルまでのmarginTop）を詰めて、
  // 作品カードのパネルをより大きく・画像全体で目立たせる（2026-09調整）。
  brandLabelMarginTop: 40,
  title: {
    marginTop: 14,
    fontSize: 44,
  },
  buildTitle: (personName: string): string => `${personName}の出演作`,
  /** 作品カードを囲む水色パネルの幅・余白・角丸 */
  panel: {
    marginTop: 40,
    width: 860,
    borderRadius: 48,
    borderWidth: 1,
    paddingY: 30,
    paddingX: 36,
    gap: 22,
    boxShadow: '0 16px 32px rgba(16,51,73,0.08)',
  },
  /** 作品カード1件分の幅・高さ・角丸・画像サイズ・文字サイズ（スマホでも読みやすいよう拡大） */
  card: {
    height: 250,
    borderRadius: 28,
    borderWidth: 1.5,
    paddingY: 20,
    paddingX: 26,
    gap: 24,
    boxShadow: '0 6px 14px rgba(16,51,73,0.06)',
    image: {
      width: 128,
      height: 178,
      borderRadius: 16,
    },
    titleFontSize: 32,
    titleLineHeight: 1.25,
    vodFontSize: 23,
    vodPaddingY: 7,
    vodPaddingX: 20,
  },
  decorations: {
    circles: [
      { size: 380, left: -140, bottom: -140, opacity: 0.26 },
      { size: 400, right: -150, bottom: -120, opacity: 0.2 },
      { size: 200, right: -70, top: -60, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [] as DecorDotConfig[],
  },
} as const;

// ─── 3枚目: 人物ページへのCTA（スクリーンショットではなく専用テンプレート） ─────────
export const PAGE3 = {
  brandLabelMarginTop: 0,
  title: {
    marginTop: 22,
    fontSize: 54,
    lineHeight: 1.3,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作を`, 'もっとチェック'],
  /** 人物写真フレームのサイズ・角丸・余白（スクリーンショットの代わりに人物写真を表示する枠） */
  photoFrame: {
    width: 820,
    height: 650,
    marginTop: 48,
    borderRadius: 36,
    borderWidth: 6,
    objectPosition: 'top center',
  },
  /** 写真下に重ねる「推しサーチ ＋ 人物名」帯の文字サイズ・余白 */
  overlay: {
    paddingY: 20,
    gap: 12,
    brandFontSize: 26,
    nameFontSize: 22,
  },
  /** CTAボタンのサイズ・文言・角丸（スマホで誘導先が一目でわかるよう拡大、2026-09調整） */
  cta: {
    marginTop: 40,
    width: 740,
    fontSize: 36,
    paddingY: 32,
    paddingX: 40,
    borderRadius: 30,
    boxShadow: '0 16px 32px rgba(16,51,73,0.16)',
    text: 'プロフィールのリンクから推しサーチへ',
  },
  decorations: {
    circles: [
      { size: 380, left: -140, bottom: -140, opacity: 0.26 },
      { size: 400, right: -150, bottom: -120, opacity: 0.2 },
      { size: 200, left: -70, top: -60, opacity: 0.16 },
      { size: 180, right: -60, top: 60, opacity: 0.16 },
    ] as DecorCircleConfig[],
    dots: [
      { size: 12, top: 260, left: 90 },
      { size: 9, top: 1080, right: 110 },
    ] as DecorDotConfig[],
  },
} as const;
