/**
 * 「search-flow」テンプレート（検索体験型、人物写真なし）専用のデザイン設定。
 * 「人物名を検索 → 出演作品 → 配信先」の3ステップで推しサーチの使い方を見せ、
 * 推しサーチを知らない人にも1枚目で「何ができるサイトか」を伝えることが目的。
 *
 * 既存4テンプレート（default-person / works-only / works-picks / vod-compare）とは独立しており、
 * 値を共有しない。配色は推しサーチの水色系ブランドに揃えている。
 * Instagramの正方形投稿（1080×1080）用。
 *
 * - 白いフィードに溶け込まないよう、背景は3枚とも水色系にし、検索窓・カードは白で浮かせる
 *   （1枚目が最も濃く、2・3枚目は淡い水色）。
 * - 文字サイズは「1080px画像がスマホのフィードで約1/3に縮小される」前提で、
 *   注記以外は最小26px以上にしている。
 */

export const CANVAS = {
  width: 1080,
  height: 1080,
} as const;

export const FONT_FAMILY = 'Noto Sans JP';

export const COLORS = {
  accent: '#1fb6e0',
  accentDark: '#0e88ac',
  accentSoft: '#e3f7fd',
  textDark: '#103349',
  /** 注記など控えめな文字色（水色背景上でも読めるコントラストにしている） */
  textMuted: '#4d6f80',
  placeholder: '#8fb0c0',
  white: '#ffffff',
  cardBorder: '#cfeaf5',
  /** 作品画像が取得できない場合のフォールバックカードのグラデーション */
  fallbackFrom: '#d9f3fb',
  fallbackTo: '#f6fcfe',
  /** 背景に重ねる白い光の円（R,G,Bのみ。透明度は各装飾のopacityで指定） */
  glowRgb: '255,255,255',
} as const;

/** ページ背景。1枚目はスクロール中に目を止めるため最も濃い水色にする */
export const BACKGROUNDS = {
  page1: 'linear-gradient(180deg, #aee9f8 0%, #d8f4fc 55%, #eefafd 100%)',
  page2: 'linear-gradient(180deg, #dcf4fc 0%, #f1fbfe 100%)',
  page3: 'linear-gradient(180deg, #d2f1fb 0%, #eefafd 100%)',
} as const;

export const BRAND = {
  label: '推しサーチ',
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

// ─── 1枚目: 検索窓に人物名が入力された状態（STEP 1）＋検索結果の予告サムネ ─────────
export const PAGE1 = {
  /** ロゴは白いピル型の上に置き、色付き背景の上でも「推しサーチ」がはっきり読めるようにする */
  brand: { marginTop: 44, fontSize: 38, iconSize: 40, paddingY: 12, paddingX: 30 },
  /** ロゴより下の本文ブロック。スワイプ表示と重ならないよう下側に余白を取る */
  body: { paddingBottom: 56 },
  title: {
    /** 人物名が長い場合は文字数に応じて最小値まで縮小する */
    maxFontSize: 74,
    minFontSize: 50,
    lineHeight: 1.28,
    paddingX: 70,
  },
  buildTitleLines: (personName: string): [string, string] => [`${personName}の出演作、`, 'どこで見れる？'],
  step: { marginTop: 30, fontSize: 28, label: 'STEP 1', text: '名前で検索' },
  searchBox: {
    marginTop: 14,
    width: 900,
    height: 136,
    borderWidth: 5,
    paddingX: 22,
    gap: 22,
    iconCircleSize: 94,
    iconSize: 52,
    maxFontSize: 54,
    minFontSize: 36,
    cursorHeight: 58,
    buttonText: '検索',
    buttonFontSize: 30,
    buttonWidth: 124,
    buttonHeight: 80,
    boxShadow: '0 18px 40px rgba(16,51,73,0.16)',
  },
  /** 検索窓の下に並べる作品サムネ（最大3枚）。少し傾けて「検索結果が出てくる」印象を出す */
  thumbs: {
    marginTop: 34,
    width: 160,
    height: 224,
    gap: 30,
    borderWidth: 6,
    borderRadius: 18,
    rotations: [-6, 0, 6] as number[],
    /** 中央のサムネだけ少し上に出す */
    centerLift: 14,
    fallbackFontSize: 64,
    boxShadow: '0 14px 28px rgba(16,51,73,0.18)',
  },
  lead: { marginTop: 30, fontSize: 36, text: '人物名から出演作品・配信先をチェック' },
  swipe: { bottom: 40, right: 52, fontSize: 26, text: 'スワイプ' },
  decorations: [
    { size: 420, left: -170, top: -150, opacity: 0.55 },
    { size: 360, right: -150, bottom: 120, opacity: 0.45 },
  ] as DecorCircleConfig[],
} as const;

// ─── 2枚目: 検索結果（STEP 2 出演作品 → STEP 3 配信先 の2列表示） ──────────────────
export const PAGE2 = {
  brand: { marginTop: 36, fontSize: 32, iconSize: 34, paddingY: 8, paddingX: 22 },
  body: { paddingBottom: 60 },
  /** 列見出し（STEP 2 出演作品 → STEP 3 配信先）。作品カードと同じ列幅で揃える */
  header: { fontSize: 36, pillFontSize: 24, marginBottom: 18 },
  rows: {
    width: 940,
    gap: 18,
    /** 作品数（1〜3件）に応じた作品カードの高さ */
    heightByCount: { 1: 250, 2: 236, 3: 212 } as Record<number, number>,
    paddingX: 22,
    borderRadius: 26,
    borderWidth: 1.5,
    boxShadow: '0 10px 24px rgba(16,51,73,0.10)',
    /** 作品カード左側（サムネ＋タイトル）と右側（配信先）の間の矢印 */
    arrowSize: 46,
    arrowGap: 12,
    /** 右側の配信先列の幅 */
    vodColumnWidth: 250,
  },
  thumb: {
    paddingY: 22,
    /** 縦長（ポスター）画像の幅/高さ比 */
    portraitAspect: 0.72,
    /** 横長画像（16:9等）は横長の枠で表示する */
    landscapeWidth: 184,
    borderRadius: 14,
    fallbackFontSize: 56,
    gap: 20,
  },
  title: { fontSize: 36, lineHeight: 1.28 },
  vod: { maxFontSize: 30, minFontSize: 20, paddingY: 10, paddingX: 14, gap: 10 },
  note: { bottom: 30, fontSize: 24, text: '※配信情報は確認時点の情報です' },
  decorations: [
    { size: 360, left: -150, bottom: -120, opacity: 0.6 },
    { size: 300, right: -120, top: -100, opacity: 0.5 },
  ] as DecorCircleConfig[],
} as const;

// ─── 3枚目: 推しサーチへの導線 ─────────────────────────────────────────────────
export const PAGE3 = {
  brand: { fontSize: 104, iconSize: 108 },
  copy: { marginTop: 46, fontSize: 62, text: '推しの名前を入れるだけ' },
  searchBox: {
    marginTop: 42,
    width: 860,
    height: 128,
    borderWidth: 5,
    paddingX: 22,
    gap: 22,
    iconCircleSize: 86,
    iconSize: 48,
    fontSize: 44,
    placeholder: '推しの名前を入力',
    cursorHeight: 54,
    boxShadow: '0 18px 40px rgba(16,51,73,0.14)',
  },
  sub: { marginTop: 34, fontSize: 36, text: '出演作品・配信先をまとめてチェック' },
  /**
   * CTA。Instagramの投稿画像はタップしてもサイトへ遷移しないため、
   * 押せるボタンに見えないよう影を付けず、白い帯＋枠線の「案内表示」にしている。
   */
  cta: {
    marginTop: 54,
    width: 800,
    fontSize: 38,
    paddingY: 28,
    borderRadius: 999,
    borderWidth: 3,
    text: 'プロフィールのリンクから推しサーチへ',
  },
  decorations: [
    { size: 420, left: -170, top: -150, opacity: 0.55 },
    { size: 380, right: -160, bottom: -140, opacity: 0.5 },
  ] as DecorCircleConfig[],
} as const;
