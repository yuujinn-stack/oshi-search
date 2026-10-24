/**
 * Instagramストーリーズ用テンプレート（静的定義）。
 *
 * 管理画面 /admin/instagram-stories で「文章・CTAをコピーして手動で作る」ためのもの。
 * DB保存・Instagram API・予約投稿・自動投稿には一切接続しない。
 *
 * 【リンク導線の設計】
 * ストーリーズは最後まで見られるとは限らないため、3枚目だけにリンクを置かない。
 * すべてのスライドが linkCTA / linkPosition を持ち、役割を分ける：
 *   - hook   … 1枚目。興味を持った人がその場で押せる自然なCTA
 *   - detail … 途中のスライド。説明内容と直接つながるCTA
 *   - final  … 最後のスライド。最も明確な行動喚起
 *
 * 【テンプレートを追加する場合】STORY_TEMPLATES に1件追加するだけでよい。
 * slides は配列なので4枚以上にも増やせる。
 *
 * 【リンク先URL】テンプレートの linkUrl が全スライド共通の既定値。スライドの linkUrl を指定すると
 * そのスライドだけ上書きできる（resolveSlideLinkUrl）。コード上で正式URLを確認できないものは null（未設定）。
 * Instagramへの自動設定は行わない（管理画面で確認・コピーするだけ）。
 */

import { OSHI_VOD_PATH } from '@/lib/oshi-vod/params';
import { SUPPORT_ADS_PATH } from '@/lib/support-ads/content';

/** ストーリーズのキャンバスサイズ（px） */
export const STORY_CANVAS = { width: 1080, height: 1920 } as const;

/**
 * ストーリーズのリンクステッカーは本番URLを直接設定するため、本番の正式オリジンを固定で持つ
 * （robots.ts・sitemap テストと同じ値。プレビュー環境の NEXT_PUBLIC_SITE_URL に引きずられないようにする）。
 */
export const STORY_LINK_ORIGIN = 'https://oshi-search.jp';

/** 人物検索ページ（/search：「推し・有名人を検索」） */
const SEARCH_URL = `${STORY_LINK_ORIGIN}/search`;
/** 推しに合うサブスク診断 */
const OSHI_VOD_URL = `${STORY_LINK_ORIGIN}${OSHI_VOD_PATH}`;
/** はじめての応援広告ガイド（推しアドの広告枠を掲載している自サイトのページ） */
const SUPPORT_ADS_URL = `${STORY_LINK_ORIGIN}${SUPPORT_ADS_PATH}`;
/** トップページ */
const TOP_URL = `${STORY_LINK_ORIGIN}/`;

export type StoryCtaRole = 'hook' | 'detail' | 'final';

export interface StoryLinkPosition {
  /** 現状は下部中央のみ。将来ほかの配置を追加する余地として型で持つ */
  placement: 'bottom-center';
  /** リンクステッカーの下端が、画面下端から何px上にあるか（InstagramのUIと重ならない範囲） */
  bottomOffsetMinPx: number;
  /** リンクステッカーの上端が、画面下端から何px上にあるか */
  bottomOffsetMaxPx: number;
}

export interface StorySlide {
  text: string;
  linkCTA: string;
  ctaRole: StoryCtaRole;
  linkPosition: StoryLinkPosition;
  recommendedAsset: string;
  /** 指定するとテンプレートの linkUrl を上書きする。null は「このスライドは未設定」 */
  linkUrl?: string | null;
}

export interface StoryTemplate {
  id: string;
  title: string;
  purpose: string;
  /** true のテンプレートはPR表記を必須として管理画面で明示する */
  isPR: boolean;
  /** Instagramのリンクステッカーに設定するURL（全スライド共通の既定値）。null は未設定 */
  linkUrl: string | null;
  slides: StorySlide[];
}

/** 下端から300〜450px上：画面最下部の返信欄・送信UIと重ならない標準位置 */
export const DEFAULT_LINK_POSITION: StoryLinkPosition = {
  placement: 'bottom-center',
  bottomOffsetMinPx: 300,
  bottomOffsetMaxPx: 450,
};

/** 縦方向の範囲（上端からのpx） */
export interface StoryZone {
  top: number;
  bottom: number;
}

/**
 * 1080×1920 の簡易レイアウト。リンクステッカー予定位置と本文・画像が重ならないよう、
 * 最初からリンク用余白を確保している（tests で非重複を検証）。
 */
export const STORY_LAYOUT = {
  /** 上部：進行バー・アカウント名などInstagramのUIが重なる範囲 */
  topUi: { top: 0, bottom: 220 },
  text: { top: 240, bottom: 760 },
  image: { top: 800, bottom: 1420 },
  /** 下部：返信欄・送信ボタンなどInstagramのUIが重なる範囲 */
  bottomUi: { top: 1720, bottom: 1920 },
} as const satisfies Record<string, StoryZone>;

/** linkPosition からリンクステッカー予定位置（上端からのpx）を求める */
export function getLinkStickerZone(pos: StoryLinkPosition): StoryZone {
  return {
    top: STORY_CANVAS.height - pos.bottomOffsetMaxPx,
    bottom: STORY_CANVAS.height - pos.bottomOffsetMinPx,
  };
}

const PLACEMENT_LABELS: Record<StoryLinkPosition['placement'], string> = {
  'bottom-center': '下部中央',
};

export function describeLinkPosition(pos: StoryLinkPosition): string {
  return `${PLACEMENT_LABELS[pos.placement]}（下端から約${pos.bottomOffsetMinPx}〜${pos.bottomOffsetMaxPx}px上）`;
}

export const CTA_ROLE_LABELS: Record<StoryCtaRole, string> = {
  hook: 'フック：その場で押せる自然なCTA',
  detail: '説明：内容とつながるCTA',
  final: '最後：最も明確なCTA',
};

function slide(
  text: string,
  linkCTA: string,
  ctaRole: StoryCtaRole,
  recommendedAsset: string,
  overrides: Pick<StorySlide, 'linkUrl'> = {},
): StorySlide {
  return { text, linkCTA, ctaRole, linkPosition: DEFAULT_LINK_POSITION, recommendedAsset, ...overrides };
}

/** スライドのリンク先URL（スライドの指定 → テンプレートの既定値の順） */
export function resolveSlideLinkUrl(template: StoryTemplate, slide: StorySlide): string | null {
  return slide.linkUrl !== undefined ? slide.linkUrl : template.linkUrl;
}

export const STORY_TEMPLATES: StoryTemplate[] = [
  {
    id: 'oshikatsu-mendoi',
    title: '推し活の「めんどい」を解決',
    purpose: '出演作を1作品ずつ探す手間に共感してもらい、推しサーチの人物ページへ誘導する。',
    isPR: false,
    linkUrl: SEARCH_URL,
    slides: [
      slide(
        `推しの出演作、
毎回1作品ずつ検索してない？🔍

「あのドラマどこで見れる？」
「ほかに何出てる？」
って探すの、意外と大変。`,
        '推しから探してみる ↓',
        'hook',
        '検索や人物ページへ進む導線が分かるスクショ',
      ),
      slide(
        `推しサーチなら

👤 気になる人を選ぶ
🎬 出演作品を見る
▶️ 配信先を確認
🛍 関連商品も探す

ここまでまとめてチェックできます。`,
        '推しサーチを使ってみる ↓',
        'detail',
        '人物ページの実画面',
      ),
      slide(
        `「気になる人ができた」
その瞬間から使える推し活検索。

推しの出演作・配信先・商品を
まとめて探すなら

→ 推しサーチ`,
        '推しの出演作・配信先を探す ↓',
        'final',
        '推しサーチの人物ページまたは検索画面',
      ),
    ],
  },
  {
    id: 'oshi-vod-diagnosis',
    title: '推しからサブスク診断',
    purpose: '推しを選ぶだけでサブスクを比較できる診断（/oshi-vod）へ誘導する。',
    isPR: false,
    linkUrl: OSHI_VOD_URL,
    slides: [
      slide(
        `推しから
サブスク診断してみない？

どのサブスクがいいか、
作品数だけじゃなく
料金までまとめて比較できます。`,
        '今すぐ診断してみる ↓',
        'hook',
        'サブスク診断の入口画面',
      ),
      slide(
        `使い方はかんたん。

気になる人を選ぶだけ。

✓ 1人だけでもOK
✓ 3人まとめてもOK

出演作と配信先をもとに
まとめて比較します。`,
        '気になる人を選んでみる ↓',
        'detail',
        '1人・3人を選べる画面',
      ),
      slide(
        `「この人を見るなら
どのサブスク？」

を毎回自分で調べなくてOK。

推しからサブスクを探す
→ 推しサーチ`,
        'あなたの推しでも診断する ↓',
        'final',
        'サブスク診断結果画面',
      ),
    ],
  },
  {
    id: 'oshi-search-features',
    title: '推しサーチでできること',
    purpose: '出演作検索以外の機能（配信先・商品・写真集・サブスク比較）を知ってもらう。',
    isPR: false,
    linkUrl: SEARCH_URL,
    slides: [
      slide(
        `推しサーチ、
実は「出演作品を探す」だけじゃありません。`,
        '推しサーチを見てみる ↓',
        'hook',
        '推しサーチのトップまたは人物ページ',
        { linkUrl: TOP_URL },
      ),
      slide(
        `人物を選ぶと

・出演作品
・現在の配信先
・関連商品
・写真集
・サブスク比較

までまとめてチェックできます。`,
        '気になる人から探す ↓',
        'detail',
        '人物ページをスクロールした画面',
      ),
      slide(
        `新しく気になる人ができたときに
まず開ける推し活検索に。

→ 推しサーチ`,
        '推しサーチを使ってみる ↓',
        'final',
        '人物検索または人物ページ',
      ),
    ],
  },
  {
    id: 'support-ads-oshiad',
    title: '応援広告・推しアド',
    purpose: '応援広告という推し活を紹介し、推しアド（PR）の費用・始め方へ誘導する。',
    isPR: true,
    linkUrl: SUPPORT_ADS_URL,
    slides: [
      slide(
        `推しの誕生日や周年、
駅広告でお祝いできるって知ってる？

“応援広告”は、
推しへのお祝いを広告として出せる推し活。

費用や始め方もチェックできます。

※PR`,
        '応援広告を見てみる ↓',
        'hook',
        '完成イメージ（お祝い・応援広告のイラスト）をPNG保存して使う',
      ),
      slide(
        `応援広告って知ってる？

推しを応援する気持ちを、
広告という形に。

誕生日・周年・ライブ記念など、
特別な日の応援に。

※PR`,
        '仕組み・始め方を見る ↓',
        'detail',
        '完成イメージ（駅ポスター・駅サイネージの掲載イメージ）をPNG保存して使う',
      ),
      slide(
        `応援広告、
いくらかかるの？

何から始める？
費用はどれくらい？

まずは推しアドで
費用や始め方をチェック。

※PR`,
        '費用・始め方を確認 ↓',
        'final',
        '完成イメージ（応援広告ガイドの費用の目安・掲載までの流れ）をPNG保存して使う',
      ),
    ],
  },
];

export function getStoryTemplate(id: string): StoryTemplate | undefined {
  return STORY_TEMPLATES.find((t) => t.id === id);
}

/** 「3枚まとめてコピー」用のテキスト。スライド数に依存しない */
export function formatStoryTemplateForCopy(template: StoryTemplate): string {
  const header = [`【${template.title}】`];
  if (template.isPR) header.push('※PR案件：すべてのスライドの「※PR」表記を消さないこと');
  const body = template.slides.map((s, i) =>
    [
      `━━ ${i + 1}枚目 ━━`,
      s.text,
      '',
      `リンクCTA：${s.linkCTA}`,
      `リンク先URL：${resolveSlideLinkUrl(template, s) ?? '未設定'}`,
      `リンク位置：${describeLinkPosition(s.linkPosition)}`,
      `おすすめ素材：${s.recommendedAsset}`,
    ].join('\n'),
  );
  return [header.join('\n'), ...body].join('\n\n');
}
