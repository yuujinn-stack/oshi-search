// Instagramストーリーズ作成（/admin/story-maker）のテンプレート定義（DB非依存・'use client' からも import 可）。
//
// - 5テンプレート × 1〜3枚の構成を静的に持つ。テキストは {name} / {name推し} を選択中の人物・グループ名に置き換える。
// - 実際のサイト画面（スクリーンショット）を使うページは image='required'。画像が入るまで PNG 保存させない
//   （架空の画面・架空の商品情報を本番出力に混ぜないため、モックアップは描かない）。
// - リンク先は既存の公開ページのパスだけ（パスの組み立ては既存の params モジュールと同じ形式）。
// 既存の /admin/instagram-stories（静的テンプレート閲覧）とは独立している。

import { OSHI_VOD_PATH, buildOshiVodGroupPath, buildOshiVodWithPath } from '@/lib/oshi-vod/params';

export type StoryTemplateId = 'vod' | 'goods' | 'request' | 'card' | 'goodsmaking' | 'bf';
export type SlideCount = 1 | 2 | 3;
export const SLIDE_COUNTS: SlideCount[] = [1, 2, 3];
/**
 * 構成。'single'＝1枚完結版（見出し・実画面・CTA・リンク余白を1枚に収めた専用レイアウト）、数字＝標準版などの枚数別構成。
 * 1枚完結版は標準版の1枚構成（structures[1]）とは別の定義（B・C は標準版も1枚のため、標準版は従来どおり残す）。
 */
export type StoryStructure = 'single' | SlideCount;

/** 構成のページ一覧 */
export function structureSlides(tpl: Pick<StoryTemplateDef, 'single' | 'structures'>, s: StoryStructure): SlideDef[] {
  return s === 'single' ? [tpl.single] : tpl.structures[s];
}

/** 構成の枚数（計測の記録・リーチ欄に使う） */
export function structureSlideCount(s: StoryStructure): SlideCount {
  return s === 'single' ? 1 : s;
}

/** 管理画面の表示名 */
export function structureLabel(tpl: Pick<StoryTemplateDef, 'defaultSlides'>, s: StoryStructure): string {
  if (s === 'single') return '1枚完結版（1枚）';
  return s === tpl.defaultSlides ? `標準版（${s}枚）` : `${s}枚構成`;
}

/** スライドの組み方。テンプレートごとの装飾（decoration）と組み合わせて見た目を変える */
export type SlideLayout = 'hook' | 'screen' | 'combined' | 'cta' | 'points' | 'question' | 'single'
  /** 楽天BF・推し別セール紹介（フィード 1080×1350。src/app/admin/story-maker/BfSaleSlide.tsx） */
  | 'bf-cover' | 'bf-products' | 'bf-final';
/** スタンプ用に空けておく場所の種類（本物のスタンプは Instagram アプリで置く。画像には描かない） */
export type StickerKind = 'link' | 'question' | 'none';
/** 画像の差し込み口。同じ口の画像は枚数を変えても引き継ぐ */
export type ImageSlot = 'screen' | 'card';

export interface SlideText {
  heading: string;
  subheading: string;
  body: string;
  cta: string;
  note: string;
  /** スタンプの近くに置く説明文 */
  stickerCaption: string;
}
export type SlideTextField = keyof SlideText;
export const SLIDE_TEXT_FIELDS: { key: SlideTextField; label: string; multiline: boolean }[] = [
  { key: 'heading', label: 'メイン見出し', multiline: true },
  { key: 'subheading', label: 'サブ見出し', multiline: true },
  { key: 'body', label: '説明文', multiline: true },
  { key: 'cta', label: 'CTA文言', multiline: false },
  { key: 'stickerCaption', label: 'スタンプ横の説明文', multiline: false },
  { key: 'note', label: '補足文', multiline: false },
];

export interface SlideDef {
  layout: SlideLayout;
  sticker: StickerKind;
  /** 'required' は実画面が入るまで保存不可。'optional' は無ければ画像枠ごと省く */
  image: 'required' | 'optional' | 'none';
  imageSlot?: ImageSlot;
  /** 画像として何を入れるか（管理画面の案内） */
  imageHint?: string;
  text: SlideText;
}

export type Decoration = 'bubble' | 'polaroid' | 'hearts' | 'sparkle' | 'steps';

export interface StoryTemplateDef {
  id: StoryTemplateId;
  /** utm_campaign（story_{key}）・ファイル名に使う英数字 */
  key: string;
  title: string;
  purpose: string;
  defaultSlides: SlideCount;
  decoration: Decoration;
  /** 人物・グループを選ぶと文言に反映するか（追加リクエスト募集は名前を入れない） */
  usesTarget: boolean;
  structures: Record<SlideCount, SlideDef[]>;
  /**
   * 1枚完結版（layout='single'）。文言の割り当て：heading＝見出し、subheading＝見出し下の一言、
   * body＝画像の下の説明、stickerCaption＝CTAの1行目、cta＝「↓ ◯◯ ↓」、note＝最下部の補足。
   */
  single: SlideDef;
  /**
   * 構成・背景色・リンク位置・A/Bテストを選ばせない固定のテンプレート（楽天BF・推し別セール紹介）。
   * 枚数は defaultSlides で固定し、structures のどの枚数を選んでも同じページ一覧を返す。
   */
  fixed?: boolean;
  /** 画像の高さ（省略時は 1920＝ストーリーズ。フィード投稿は 1350） */
  frameHeight?: number;
}

const T = (t: Partial<SlideText>): SlideText => ({
  heading: '', subheading: '', body: '', cta: '', note: '', stickerCaption: '', ...t,
});

// ── A：サブスク診断 ─────────────────────────────────────────────
const VOD_SCREEN_HINT = '実際のサブスク診断ページ（/oshi-vod）の画面';
const VOD: StoryTemplateDef = {
  id: 'vod',
  key: 'vod',
  title: 'A：サブスク診断への誘導',
  purpose: '出演作品をどのサブスクで見られるか調べる手間を入口に、推しに合うサブスク診断へ誘導します。',
  defaultSlides: 2,
  decoration: 'bubble',
  usesTarget: true,
  single: { layout: 'single', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: '選んだ推しで実際に診断した結果画像（自動作成で取得）',
    text: T({ heading: '{name推し}の人！', subheading: '推しの出演作品、\nどこで見られるか知ってる？', stickerCaption: '推しを選ぶだけでサブスクを比較！', cta: '無料で診断する' }) },
  structures: {
    1: [
      { layout: 'combined', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: VOD_SCREEN_HINT,
        text: T({ heading: '{name推し}の人！', subheading: '出演作品、どこのサブスクで\n見られるか毎回調べてない？', cta: '無料で診断する', stickerCaption: 'ここから無料で診断できます！', note: '推しを選ぶだけでサブスクを比較' }) },
    ],
    2: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '{name推し}の人！', subheading: '出演作品、どこのサブスクで\n見られるか毎回調べてない？', note: '次のページへ →' }) },
      { layout: 'screen', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: VOD_SCREEN_HINT,
        text: T({ heading: '推しを選ぶだけで\nサブスクを比較！', cta: '無料で診断する', stickerCaption: 'ここから無料で診断できます！' }) },
    ],
    3: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '{name推し}の人！', subheading: '出演作品、どこのサブスクで\n見られるか毎回調べてない？', note: '次のページへ →' }) },
      { layout: 'screen', sticker: 'none', image: 'required', imageSlot: 'screen', imageHint: VOD_SCREEN_HINT,
        text: T({ heading: '推しを選ぶだけで\nサブスクを比較！', subheading: '出演作品が見られるサービスを\nまとめてチェック' }) },
      { layout: 'cta', sticker: 'link', image: 'none',
        text: T({ heading: 'どのサブスクが\n合うか診断しよう', subheading: '推しを選ぶだけ', cta: '無料で診断する', stickerCaption: 'ここから無料で診断できます！' }) },
    ],
  },
};

// ── B：関連商品・写真集・CD ──────────────────────────────────────
const GOODS_SCREEN_HINT = '対象人物ページの商品一覧（写真集・CDなど）の画面';
const GOODS: StoryTemplateDef = {
  id: 'goods',
  key: 'goods',
  title: 'B：関連商品・写真集・CDの紹介',
  purpose: '推しの写真集やCDをまとめて探せることを、人物ページの実際の商品一覧で見せます。',
  defaultSlides: 1,
  decoration: 'polaroid',
  usesTarget: true,
  single: { layout: 'single', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: '関連商品のカード（自動作成）または人物ページの商品一覧の画面',
    text: T({ heading: '{name推し}の人、\nチェックして！', stickerCaption: '写真集・CD・グッズをまとめて探せる！', cta: '関連商品を見る' }) },
  structures: {
    1: [
      { layout: 'combined', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: GOODS_SCREEN_HINT,
        text: T({ subheading: '{name}の関連商品', heading: '推しの写真集やCD、\nまとめて探せる！', cta: '関連商品を見る', stickerCaption: '推しの関連商品をチェック！' }) },
    ],
    2: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '{name}の写真集やCD、\nどこで探してる？', subheading: '推しサーチなら\nまとめて探せます', note: '次のページへ →' }) },
      { layout: 'screen', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: GOODS_SCREEN_HINT,
        text: T({ heading: '推しの写真集やCD、\nまとめて探せる！', cta: '関連商品を見る', stickerCaption: '推しの関連商品をチェック！' }) },
    ],
    3: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '{name}の写真集やCD、\nどこで探してる？', subheading: 'お店ごとに探すのは大変…', note: '次のページへ →' }) },
      { layout: 'screen', sticker: 'none', image: 'required', imageSlot: 'screen', imageHint: GOODS_SCREEN_HINT,
        text: T({ heading: '推しの関連商品を\n1ページでチェック', subheading: '写真集・CDなどをまとめて掲載' }) },
      { layout: 'cta', sticker: 'link', image: 'none',
        text: T({ heading: '推しの写真集やCD、\nまとめて探せる！', cta: '関連商品を見る', stickerCaption: '推しの関連商品をチェック！' }) },
    ],
  },
};

// ── C：追加希望リクエスト募集（推し投票ではない） ───────────────────
const REQUEST: StoryTemplateDef = {
  id: 'request',
  key: 'request',
  title: 'C：追加希望リクエスト募集',
  purpose: '推しサーチに追加してほしいグループ・人物を、Instagramの質問スタンプで募集します（回答は手動で確認）。',
  defaultSlides: 1,
  decoration: 'hearts',
  usesTarget: false,
  single: { layout: 'single', sticker: 'question', image: 'none',
    text: T({ heading: '推しサーチに\n追加してほしいのは？', body: '追加してほしいグループ・人物を\n教えて！', note: 'いただいたリクエストを今後の登録候補にします！' }) },
  structures: {
    1: [
      { layout: 'question', sticker: 'question', image: 'none',
        text: T({ heading: 'あなたの推しを\n教えて♡', subheading: '推しサーチに追加してほしい\nグループ・人物を募集中！', stickerCaption: '質問スタンプで教えてね', note: 'いただいた声をもとに追加を検討します' }) },
    ],
    2: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '推しサーチに\n追加してほしい推し、\nいる？', subheading: 'グループ・人物の\nリクエストを募集中！', note: '次のページへ →' }) },
      { layout: 'question', sticker: 'question', image: 'none',
        text: T({ heading: 'あなたの推しを\n教えて♡', stickerCaption: '質問スタンプで教えてね', note: 'いただいた声をもとに追加を検討します' }) },
    ],
    3: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '推しサーチに\n追加してほしい推し、\nいる？', subheading: 'グループ・人物の\nリクエストを募集中！', note: '次のページへ →' }) },
      { layout: 'points', sticker: 'none', image: 'none',
        text: T({ heading: 'リクエストの方法', body: '次のページの質問スタンプに回答\nグループ名・人物名を書くだけ\nいただいた声をもとに追加を検討' }) },
      { layout: 'question', sticker: 'question', image: 'none',
        text: T({ heading: 'あなたの推しを\n教えて♡', stickerCaption: '質問スタンプで教えてね', note: 'いただいた声をもとに追加を検討します' }) },
    ],
  },
};

// ── D：推し布教カード ───────────────────────────────────────────
const CARD_HINT = '推し布教カード（/oshi-card）で作った実際のカード画像';
const CARD: StoryTemplateDef = {
  id: 'card',
  key: 'card',
  title: 'D：推し布教カード紹介',
  purpose: '実際に作った布教カードを見せて、カード作成ページへ誘導します。',
  defaultSlides: 2,
  decoration: 'sparkle',
  usesTarget: true,
  single: { layout: 'single', sticker: 'link', image: 'required', imageSlot: 'card', imageHint: CARD_HINT,
    text: T({ heading: '{name}の推しカード、\n作れるの知ってた？', stickerCaption: 'あなたの推しでも作ってみて！', cta: '無料でカードを作る' }) },
  structures: {
    1: [
      { layout: 'combined', sticker: 'link', image: 'required', imageSlot: 'card', imageHint: CARD_HINT,
        text: T({ subheading: '推し布教カード', heading: 'あなたも推しの\nカードを作ってみない？', cta: '無料でカードを作る', stickerCaption: 'ここからカードを作れます！' }) },
    ],
    2: [
      { layout: 'screen', sticker: 'none', image: 'required', imageSlot: 'card', imageHint: CARD_HINT,
        text: T({ subheading: '推し布教カード', heading: '{name}の布教カード\nできました！', note: '次のページへ →' }) },
      { layout: 'cta', sticker: 'link', image: 'none',
        text: T({ heading: 'あなたも推しの\nカードを作ってみない？', subheading: '推しと出演作品を選ぶだけ', cta: '無料でカードを作る', stickerCaption: 'ここからカードを作れます！' }) },
    ],
    3: [
      { layout: 'screen', sticker: 'none', image: 'required', imageSlot: 'card', imageHint: CARD_HINT,
        text: T({ subheading: '推し布教カード', heading: '{name}の布教カード\nできました！', note: '次のページへ →' }) },
      { layout: 'points', sticker: 'none', image: 'none',
        text: T({ heading: '作り方はかんたん', body: '推しを選ぶ\n紹介したい出演作品を選ぶ\n画像を保存してシェア' }) },
      { layout: 'cta', sticker: 'link', image: 'none',
        text: T({ heading: 'あなたも推しの\nカードを作ってみない？', cta: '無料でカードを作る', stickerCaption: 'ここからカードを作れます！' }) },
    ],
  },
};

// ── E：推し活グッズ制作・比較 ─────────────────────────────────────
// 品目・比較項目は /oshikatsu/goods-making の掲載内容（src/lib/oshikatsu-services/goods-making.ts の
// 品目・COMPARE_ROWS）から。料金・納期の数字は公式確認日のあるページ側に任せ、ここには書かない。
const GOODSMAKING_HINT = 'グッズ制作比較ページ（/oshikatsu/goods-making）の画面（任意）';
const GOODSMAKING: StoryTemplateDef = {
  id: 'goodsmaking',
  key: 'goods_making',
  title: 'E：推し活グッズ制作・比較',
  purpose: 'オリジナルグッズ作りに興味を持ってもらい、グッズ制作サービスの比較ページへ誘導します。',
  defaultSlides: 3,
  decoration: 'steps',
  usesTarget: false,
  single: { layout: 'single', sticker: 'link', image: 'required', imageSlot: 'screen', imageHint: 'グッズ制作サービスの比較カード（自動作成）または比較ページ（/oshikatsu/goods-making）の画面',
    text: T({ heading: '推しグッズ、\n自分で作ってみない？', stickerCaption: 'グッズ制作サービスをまとめて比較！', cta: '詳しく見てみる' }) },
  structures: {
    1: [
      { layout: 'points', sticker: 'link', image: 'none',
        text: T({ heading: '推しのオリジナルグッズ、\n作ってみたくない？', body: 'アクスタ・キーホルダー\nアクリルカード・缶バッジフレーム', cta: 'グッズ制作サービスを比較', stickerCaption: '料金・最小個数を比較できます' }) },
    ],
    2: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '推しのオリジナルグッズ、\n作ってみたくない？', subheading: 'アクスタやキーホルダーを\n自分の画像で作れる', note: '次のページへ →' }) },
      { layout: 'points', sticker: 'link', image: 'none',
        text: T({ heading: '制作サービスの\n比較ポイント', body: '作れるアイテム\n最小注文個数\n料金の目安・送料\n制作・発送期間', cta: 'グッズ制作サービスを比較', stickerCaption: 'ここから比較できます！' }) },
    ],
    3: [
      { layout: 'hook', sticker: 'none', image: 'none',
        text: T({ heading: '推しのオリジナルグッズ、\n作ってみたくない？', subheading: 'アクスタやキーホルダーを\n自分の画像で作れる', note: '次のページへ →' }) },
      { layout: 'points', sticker: 'none', image: 'none',
        text: T({ heading: '比べるポイントは\nここ！', body: '作れるアイテム\n最小注文個数\n料金の目安・送料\n制作・発送期間' }) },
      { layout: 'cta', sticker: 'link', image: 'optional', imageSlot: 'screen', imageHint: GOODSMAKING_HINT,
        text: T({ heading: '自分に合う\n制作サービスを探そう', cta: 'グッズ制作サービスを比較', stickerCaption: 'ここから比較できます！' }) },
    ],
  },
};

// ── 楽天BF・推し別セール紹介（フィード投稿・3〜4枚） ─────────────────────
// 表紙（黒×ゴールド・名前と最大割引率）→ 商品ページ1〜2枚（承認済みの商品を1ページ3件・最大6件）→ 最終ページ（プロフィールのリンクへ）。
// 枚数は採用した商品数で決まる（bfStructureSlides）。structures は既存の型に合わせた3枚（商品ページ1枚）の形。
// 割引率・価格は管理画面の承認欄で確認した値だけを描く（src/lib/story-maker/bf-sale.ts）。テキストは名前の置き換えだけ編集できる。
const BF_SLIDES: SlideDef[] = [
  { layout: 'bf-cover', sticker: 'none', image: 'none',
    text: T({ subheading: '楽天ブラックフライデー', heading: '{name}', body: 'セール対象商品を推し別に紹介', note: 'スワイプして商品をチェック →' }) },
  { layout: 'bf-products', sticker: 'none', image: 'none',
    text: T({ heading: '{name}のセール対象商品', note: '' }) },
  { layout: 'bf-final', sticker: 'none', image: 'none',
    text: T({ heading: '{name}の商品を\nもっと見るなら', body: 'プロフィールのリンクから\n推しサーチへ', cta: '推しサーチで「{name}」をチェック！' }) },
];
const BF: StoryTemplateDef = {
  id: 'bf',
  key: 'bf_sale',
  title: '楽天BF・推し別セール紹介',
  purpose: '楽天ブラックフライデーの対象と確認できた推しの商品（写真集・ライブDVD/Blu-ray・CD・グッズ）を、価格と割引率つきで紹介するフィード投稿（商品3件まで3枚・4〜6件で4枚）です。',
  defaultSlides: 3,
  decoration: 'sparkle',
  usesTarget: true,
  fixed: true,
  frameHeight: 1350,
  single: BF_SLIDES[0],
  structures: { 1: BF_SLIDES, 2: BF_SLIDES, 3: BF_SLIDES },
};

export const STORY_TEMPLATES: StoryTemplateDef[] = [VOD, GOODS, REQUEST, CARD, GOODSMAKING, BF];

/** 楽天BFのページ一覧（表紙＋商品ページ productPages 枚＋最終ページ） */
export function bfStructureSlides(productPages: number): SlideDef[] {
  const n = Math.max(1, Math.floor(productPages));
  return [BF_SLIDES[0], ...Array.from({ length: n }, () => BF_SLIDES[1]), BF_SLIDES[2]];
}

/**
 * 文言の編集を保存する位置。楽天BFは商品ページの枚数で最終ページの位置が変わるため、
 * ページの種類（表紙0・商品1・最終2）で持つ（商品ページが2枚でも見出しは共通）。他のテンプレートはページ番号のまま。
 */
export function editSlotIndex(def: Pick<SlideDef, 'layout'>, index: number): number {
  if (def.layout === 'bf-cover') return 0;
  if (def.layout === 'bf-products') return 1;
  if (def.layout === 'bf-final') return 2;
  return index;
}

export function getStoryTemplate(id: StoryTemplateId): StoryTemplateDef {
  const t = STORY_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown story template: ${id}`);
  return t;
}

// ── 対象（人物・グループ） ───────────────────────────────────────

export interface StoryTarget {
  type: 'person' | 'group';
  name: string;
  /** 公開サイトの正規パス（/person/... ・ /groups/...）。サーバー側で公開サイトと同じ関数で作る */
  pagePath: string;
  /** グループの英数字slug（あれば UTM に使う） */
  slug?: string;
}

/** {name} / {name推し} を置き換える。対象なしは「推し」/「推し活中」 */
export function fillStoryText(text: string, target: StoryTarget | null): string {
  const name = target?.name ?? '';
  return text
    .replace(/\{name推し\}/g, name ? `${name}推し` : '推し活中')
    .replace(/\{name\}/g, name || '推し');
}

// ── リンク先 ────────────────────────────────────────────────────

export const STORY_SITE_ORIGIN = 'https://oshi-search.jp';
export const OSHI_CARD_PATH = '/oshi-card';
export const OSHI_SHOPPING_PATH = '/oshi-shopping';
export const GOODS_MAKING_PATH = '/oshikatsu/goods-making';

export interface LinkTargetOption {
  id: string;
  label: string;
  path: string;
  /** UTM を付けると表示が崩れる・案内が出る等の注意 */
  warning?: string;
}

/**
 * /oshi-shopping は p 以外のパラメータがあると「条件が足りない」案内を出す（src/app/oshi-shopping/page.tsx）。
 * 公開サイトは変更しない方針のため、UTM 付きリンクには使わないよう注意を出す。
 */
const SHOPPING_UTM_WARNING =
  'お買い物診断ページは、UTMなどのパラメータが付くと「条件が足りないため診断できませんでした」と表示されます。ストーリーズのリンクには人物ページをおすすめします。';

export function linkTargetOptions(templateId: StoryTemplateId, target: StoryTarget | null): LinkTargetOption[] {
  switch (templateId) {
    case 'vod': {
      const opts: LinkTargetOption[] = [];
      if (target?.type === 'person') opts.push({ id: 'vod-with', label: `サブスク診断（${target.name}を選択済み）`, path: buildOshiVodWithPath([target.name]) });
      if (target?.type === 'group') opts.push({ id: 'vod-group', label: `サブスク診断（${target.name}のメンバー選択を開く）`, path: buildOshiVodGroupPath(target.name) });
      opts.push({ id: 'vod', label: 'サブスク診断（入口）', path: OSHI_VOD_PATH });
      return opts;
    }
    case 'goods': {
      const opts: LinkTargetOption[] = [];
      if (target) opts.push({ id: 'page', label: `${target.type === 'person' ? '人物' : 'グループ'}ページ（${target.name}）`, path: target.pagePath });
      if (target?.type === 'person') opts.push({ id: 'shopping-p', label: `お買い物診断（${target.name}）`, path: `${OSHI_SHOPPING_PATH}?p=${encodeURIComponent(target.name)}`, warning: SHOPPING_UTM_WARNING });
      opts.push({ id: 'shopping', label: 'お買い物診断', path: OSHI_SHOPPING_PATH, warning: SHOPPING_UTM_WARNING });
      return opts;
    }
    case 'request':
      return [
        { id: 'top', label: '推しサーチ トップ', path: '/' },
        { id: 'search', label: '推し・有名人を検索', path: '/search' },
      ];
    case 'card': {
      const opts: LinkTargetOption[] = [];
      if (target?.type === 'person') opts.push({ id: 'card-p', label: `布教カード作成（${target.name}を選択済み）`, path: `${OSHI_CARD_PATH}?p=${encodeURIComponent(target.name)}` });
      opts.push({ id: 'card', label: '布教カード作成', path: OSHI_CARD_PATH });
      return opts;
    }
    case 'goodsmaking':
      return [{ id: 'gm', label: 'グッズ制作サービス比較', path: GOODS_MAKING_PATH }];
    case 'bf': {
      // フィード投稿はリンクを貼れないため、プロフィールのリンクに設定するURL
      const opts: LinkTargetOption[] = [];
      if (target) opts.push({ id: 'page', label: `${target.type === 'person' ? '人物' : 'グループ'}ページ（${target.name}）`, path: target.pagePath });
      opts.push({ id: 'top', label: '推しサーチ トップ', path: '/' });
      return opts;
    }
  }
}

/** スクリーンショットを撮るページの候補（取得できるのは推しサーチの公開ページだけ） */
export function screenshotPathOptions(templateId: StoryTemplateId, slot: ImageSlot, target: StoryTarget | null): { label: string; path: string }[] {
  if (slot === 'card') {
    return target?.type === 'person'
      ? [{ label: `布教カード作成（${target.name}）`, path: `${OSHI_CARD_PATH}?p=${encodeURIComponent(target.name)}` }, { label: '布教カード作成', path: OSHI_CARD_PATH }]
      : [{ label: '布教カード作成', path: OSHI_CARD_PATH }];
  }
  const fromLinks = linkTargetOptions(templateId, target).filter((o) => !o.warning).map((o) => ({ label: o.label, path: o.path.split('#')[0] }));
  if (templateId === 'goods' && !target) return [{ label: 'お買い物診断', path: OSHI_SHOPPING_PATH }];
  return fromLinks;
}

// ── デザイン ────────────────────────────────────────────────────

export type LinkPosition = 50 | 60 | 70;
export const LINK_POSITIONS: { value: LinkPosition; label: string }[] = [
  { value: 50, label: '中央付近（50%）' },
  { value: 60, label: '中央より下（60%）' },
  { value: 70, label: '下寄り（70%）' },
];

export type ColorPresetId = 'yellow' | 'pink' | 'cream';
export interface StoryColors { bg: string; accent: string; sub: string; text: string }
export const COLOR_PRESETS: Record<ColorPresetId, { label: string; colors: StoryColors }> = {
  yellow: { label: '黄色', colors: { bg: '#FFE45C', accent: '#FF8FB1', sub: '#FFF8E7', text: '#3B2F2A' } },
  pink: { label: 'パステルピンク', colors: { bg: '#FFD2E0', accent: '#FFC93C', sub: '#FFF8E7', text: '#3B2F2A' } },
  cream: { label: 'クリーム', colors: { bg: '#FFF4D6', accent: '#FFCF33', sub: '#FFD2E0', text: '#3B2F2A' } },
};

export type FontId = 'gothic' | 'maru';
export const FONT_STACKS: Record<FontId, { label: string; stack: string }> = {
  gothic: { label: 'ゴシック', stack: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif" },
  maru: { label: '丸ゴシック', stack: "'Hiragino Maru Gothic ProN', 'Zen Maru Gothic', 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif" },
};

export interface StoryDesign {
  colors: StoryColors;
  font: FontId;
  /** 文字サイズの倍率（0.8〜1.2） */
  fontScale: number;
  linkPos: LinkPosition;
}

export const DEFAULT_DESIGN: StoryDesign = {
  colors: { ...COLOR_PRESETS.yellow.colors },
  font: 'maru',
  fontScale: 1,
  linkPos: 60,
};
