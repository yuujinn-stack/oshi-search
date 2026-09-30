/**
 * Preview専用テンプレート F〜I（name-to-everything / search-too-much / watch-and-buy / oshi-products）共通のデザイン設定。
 *
 * 推しサーチの現在の公開サイト（人物ページ「Graphic Pop」: src/app/person/[slug]/person-graphic.css）の
 * 配色・部品（ドット柄の生成り背景、黒罫線、オレンジのアクセント、「01 — WATCH NOW」形式の見出しラベル、
 * 統計ボックス）をベースにし、実際のサイト画面に見えるようにしている。
 * 既存の水色系テンプレート（default-person / works-only / works-picks / vod-compare / search-flow / 候補A〜E）とは
 * 見た目を分けている。1080×1080。
 */

export const CANVAS = { width: 1080, height: 1080 } as const;

export const FONT_FAMILY = 'Noto Sans JP';

/** person-graphic.css の --ds-* と同じ値 */
export const COLORS = {
  bg: '#F4F4F1',
  surface: '#FFFFFF',
  ink: '#0A0A0A',
  inkSoft: '#EFEEE8',
  accent: '#FF5A00',
  accentSoft: '#FFE4D2',
  text: '#141414',
  muted: '#62625C',
  border: '#D9D8D1',
  cta: '#E85400',
  white: '#FFFFFF',
  /** 濃い背景ページ上の補足文字 */
  onInkMuted: '#B9B8B0',
} as const;

/** 生成りの背景＋20px間隔のドット（サイトの body 背景と同じ） */
export const DOT_BACKGROUND = {
  backgroundColor: COLORS.bg,
  backgroundImage: 'radial-gradient(circle, rgba(10,10,10,0.09) 1.5px, transparent 1.5px)',
  backgroundSize: '20px 20px',
} as const;

export const BRAND_LABEL = '推しサーチ';

export const COMMON_TEXT = {
  cta: 'プロフィールのリンクから推しサーチへ',
  /** 3枚目の主なCTA（広告のボタンに見えない自然な表現） */
  searchCta: '気になる人を名前から検索 →',
  vodNote: '※配信情報は確認時点の情報です',
  productNote: '※商品情報は確認時点の情報です',
} as const;
