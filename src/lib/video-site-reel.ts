// 動画「サイト誘導リール」10種類（templateCategory=site_referral）の構成・台本（純粋関数・'use client' 可）。
//
// ・目的は、Instagram で動画を見た人が「自分の推しでも試したい」と思い、プロフィールのリンクから推しサーチへ来ること。
//   主役は推しサーチ本番を実際に操作した画面（oshi-video-maker の Worker が撮影。B5 は実画面の録画）。機能の説明だけの画面は作らない。
// ・対象（人物・グループ・作品・配信サービス等）と撮影するページの正式なパスは、ジョブ作成時にサーバーがDBで確かめて作る
//   （src/server/video-jobs/site-target.ts。画面から送られたパスは使わない）。存在しない機能・架空の結果は見せない。
// ・台本は 冒頭 → テンプレートの手順 → 締め（区間=ナレーション1文）。名前の読みは固定辞書 → 推しサーチDBの登録読み → かなだけの名前。
//   作品名・商品名は読み上げない（画面に出るだけ。読みを推測しない）。締めの言葉は1本の動画に1つだけ。
// ・リンク: 動画の中に押せるURLは出さない。管理画面に推奨リンク先（個別ページの正式なパス）・UTM付きリンク・プロフィール用のリンクを出す。

import { countFollowMora } from './video-follow-reel';
import { ninKana } from './video-registered-groups';
import { saleVideoConfigOf, type SaleVideoState } from './sale-video/core';

export const SITE_TEMPLATE_CATEGORY = 'site_referral' as const;
export const SITE_CATEGORY_LABEL = 'サイト誘導';
export const SITE_ORIGIN = 'https://oshi-search.jp';

export const SITE_TEMPLATE_IDS = [
  'site_person_search',
  'site_group_member_search',
  'site_work_cast_search',
  'site_three_person_search',
  'site_live_search_demo',
  'site_subscription_diagnosis',
  'site_shopping_diagnosis',
  'site_photobook_search',
  'site_fan_card_demo',
  'site_vod_service_search',
  // 期間限定セール（楽天ブラックフライデー）の3種類。管理画面では「楽天ブラックフライデー」として別に並べる
  'site_bf_goods',
  'site_bf_live',
  'site_bf_shopping',
] as const;
export type SiteTemplateId = (typeof SITE_TEMPLATE_IDS)[number];
export const isSiteTemplateId = (id: unknown): id is SiteTemplateId => typeof id === 'string' && (SITE_TEMPLATE_IDS as readonly string[]).includes(id);

/** 期間限定セールのリール（A 推しグッズ紹介・B 過去ライブ映像・C 予算5,000円×お買い物診断）。セールの開催前・開催中だけ作れる */
export const SALE_SITE_TEMPLATE_IDS = ['site_bf_goods', 'site_bf_live', 'site_bf_shopping'] as const;
export type SaleSiteTemplateId = (typeof SALE_SITE_TEMPLATE_IDS)[number];
export const isSaleSiteTemplateId = (id: unknown): id is SaleSiteTemplateId => typeof id === 'string' && (SALE_SITE_TEMPLATE_IDS as readonly string[]).includes(id);
export const SALE_SITE_SECTION_TITLE = '楽天ブラックフライデー';

/** テンプレートごとの操作の手順（oshi-video-maker の SITE_TEMPLATE_STEPS と同じ。この順に撮影し、この順に見せる） */
export const SITE_TEMPLATE_STEPS = {
  site_person_search: ['search', 'works', 'vod', 'goods'],
  site_group_member_search: ['search', 'members', 'member'],
  site_work_cast_search: ['filter', 'work', 'cast', 'next'],
  site_three_person_search: ['first', 'second', 'last'],
  site_live_search_demo: ['typing', 'opening', 'scrolling'],
  site_subscription_diagnosis: ['pick', 'result', 'ranking'],
  site_shopping_diagnosis: ['pick', 'answers', 'result'],
  site_photobook_search: ['list', 'filter', 'item'],
  site_fan_card_demo: ['pick', 'works', 'card'],
  site_vod_service_search: ['services', 'provider', 'person'],
  // セールのリールは 冒頭（大きなセール名）→ intro（テンプレートごとの一言・実画面を小さく）→ 操作の手順 → 締め
  site_bf_goods: ['intro', 'search', 'goods', 'live'],
  site_bf_live: ['intro', 'corner', 'list', 'discs'],
  site_bf_shopping: ['intro', 'entry', 'pick', 'answers', 'result'],
} as const satisfies Record<SiteTemplateId, readonly string[]>;
export type SiteStep = (typeof SITE_TEMPLATE_STEPS)[SiteTemplateId][number];

export function siteStepsFor(templateId: SiteTemplateId, personCount = 3): readonly SiteStep[] {
  if (templateId === 'site_three_person_search' && personCount === 2) return ['first', 'last'];
  return SITE_TEMPLATE_STEPS[templateId];
}

/** 長さ: 目安15〜20秒。読みの見積もりに合わせて自然に伸ばし、24秒を超える台本は作らない（早送り・途中切れはしない） */
export const SITE_MAX_SECONDS = 24;
export const SITE_TARGET_SECONDS = 20;
export const SITE_MORA_PER_SECOND = 8;

export type SiteTargetKind = 'person' | 'group' | 'personOrGroup';

export interface SiteTemplateSpec {
  name: string;
  /** 冒頭の文（ユーザー指定の文。{n} はメンバー数・人数） */
  hook: string;
  /** 対象の種類 */
  target: SiteTargetKind;
  guide: string;
  /** 締めで次に入力・開くもの（人物名・グループ名を入れるテンプレートは null＝名前を出す） */
  feature: string | null;
}

export const SITE_TEMPLATE_SPECS: Record<SiteTemplateId, SiteTemplateSpec> = {
  site_person_search: { name: 'B1 推しの名前を検索するだけ', hook: '推しの出演作品、まとめて探せるの知ってた？', target: 'person', feature: null, guide: 'トップページで名前を検索 → 人物ページ → 出演作品 → 配信中の作品と配信先 → 関連商品。人物はいつでも変更できます（出演作品・配信中の出演作品・関連商品の欄がある人物）。' },
  site_group_member_search: { name: 'B2 グループからメンバーをまとめて探す', hook: '{group}の{n}、ここから探せます', target: 'group', feature: null, guide: 'グループ名で検索 → グループページのメンバー一覧 → メンバー1人の人物ページ → 出演作品。人数はグループページに表示される人数（撮影時に照合）。' },
  site_work_cast_search: { name: 'B3 作品名から出演者を探す', hook: 'この作品に出ている人、ほかに何に出てる？', target: 'person', feature: null, guide: '推しサーチの検索欄は作品名では検索できないため、人物ページの「出演作品」にある「作品名で検索」で絞り込みます → 作品ページ → 出演者（当サイト登録）→ 別の出演者の人物ページ。出演者が2人以上登録された作品だけ選べます。作品名は読み上げません。' },
  site_three_person_search: { name: 'B4 気になる3人を続けて検索', hook: '気になる{n}、まとめて調べてみた', target: 'person', feature: null, guide: '2〜3人を順番に検索します（1人目=出演作品、2人目=配信中の出演作品、最後=関連商品）。比較・順位は作りません。' },
  site_live_search_demo: { name: 'B5 実際の検索画面をそのまま見せる', hook: '推しサーチで検索すると、こうなります', target: 'person', feature: null, guide: 'トップページで名前を入力 → 候補をタップ → 人物ページ → スクロール を実画面の録画で見せます（録画は等速。テロップは最小限）。' },
  site_subscription_diagnosis: { name: 'B6 推しに合うサブスク診断を体験', hook: '推しを選んで、診断してみた', target: 'personOrGroup', feature: '推しに合うサブスク診断', guide: '実際の「推しに合うサブスク診断」で推しを選んで診断し、表示された結果とランキングをそのまま見せます（サービスの優劣・作品数を台本で言いません）。' },
  site_shopping_diagnosis: { name: 'B7 推し活お買い物診断を体験', hook: '推し活グッズ、用途と予算から探せます', target: 'person', feature: '推し活お買い物診断', guide: '推し・用途・予算を選ぶ → 実際の診断結果 → 関連商品。価格は楽天から取得した時点の表示で、購入は楽天の商品ページ（外部ショップ）です。' },
  site_photobook_search: { name: 'B8 写真集・フォトブックを探す', hook: '推しの写真集、ここからチェックできます', target: 'person', feature: '写真集を探す', guide: '写真集の一覧 → 人物で絞り込み → 掲載中の写真集。写真集の一覧に掲載中の写真集がある人物だけ選べます。商品の購入ページ（楽天）へは移動しません。' },
  site_fan_card_demo: { name: 'B9 推し布教カードを作ってみる', hook: '推しを紹介するカード、作ってみた！', target: 'person', feature: '推し布教カード', guide: '既存の推し布教カードで、推しを選ぶ → おすすめ作品（1〜3件）を選ぶ → カードの完成。カードに載る作品は推し布教カードで選べる公開作品だけです。' },
  site_vod_service_search: { name: 'B10 配信サービスから出演作品を探す', hook: '使っているサブスクから作品を探してみた', target: 'person', feature: null, guide: 'トップページの「配信サービスから探す」→ サービスのページ →「配信作品から人物を探す」の人物 → 人物ページの配信中の出演作品。配信の種類（見放題・レンタル・追加チャンネル）は画面の表示どおりで、台本では区別を言いません。' },
  // 冒頭・締めの文はセールの設定（src/lib/sale-video/config.ts）から作る（ここの hook は管理画面の説明用）
  site_bf_goods: { name: 'A ブラックフライデー × 推しグッズ紹介', hook: '楽天ブラックフライデーセールが始まります！', target: 'personOrGroup', feature: null, guide: 'トップページで名前を検索 → 人物・グループのページ → 関連商品 → 過去のライブ映像（DVD・Blu-ray）。過去のライブ映像のコーナーがある人物・グループ（過去のライブ映像特集の対象グループと、その現在のメンバー）だけ選べます。セール価格・割引率・ポイント還元率は台本に入れません。' },
  site_bf_live: { name: 'B 過去ライブ映像 × ブラックフライデー', hook: '推しを好きになる前のライブ、見たことある？', target: 'personOrGroup', feature: null, guide: '人物・グループのページの過去のライブ映像のコーナー → ライブ映像の一覧（スクロール）→ 公演のDVD・Blu-ray。推しサーチに掲載中のライブ映像・商品だけを撮影します（過去のライブ映像特集の対象グループと、その現在のメンバー）。' },
  site_bf_shopping: { name: 'C 予算5,000円 × 推し活お買い物診断', hook: 'ブラックフライデー、予算5,000円なら何を探す？', target: 'person', feature: '推し活お買い物診断', guide: '実際の推し活お買い物診断で、推し（人物1人）→ 用途 → 予算「5,000円まで」→ 診断結果。診断は人物を1人選ぶ方式のため、グループは選べません（グループ名を入れるとメンバーを選ぶ画面になります）。価格は楽天から取得した時点の表示で、購入は楽天の商品ページ（外部サイト）です。' },
};

export const SITE_CTA_OPTIONS = {
  profile: { text: 'あなたの推しも、プロフィールのリンクから検索してみてね！', kana: 'あなたのおしも、ぷろふぃーるのりんくからけんさくしてみてね！', title: 'あなたの推しも、\nプロフィールのリンクから\n検索してみてね！' },
  try: { text: '自分の推しでも試してみてね。推しサーチはプロフィールから！', kana: 'じぶんのおしでもためしてみてね。おしさーちはぷろふぃーるから！', title: '自分の推しでも\n試してみてね。\n推しサーチはプロフィールから！' },
} as const;
/** profile / try = サイト誘導リールの締め（選べる）。sale = 期間限定セールのリールの締め（セールの設定の文。選べない） */
export type SiteCtaKey = keyof typeof SITE_CTA_OPTIONS | 'sale';
export const isSiteCtaKey = (v: unknown): v is SiteCtaKey => v === 'profile' || v === 'try' || v === 'sale';

export interface SiteCtaText {
  text: string;
  kana: string;
  title: string;
  /** 締めの画面の、大きな文字の下の案内（セールのリールだけ。ほかのテンプレートは検索ワード等を出す） */
  sub?: string;
}

const SALE_CTA_KIND: Record<SaleSiteTemplateId, 'goods' | 'live' | 'shopping'> = { site_bf_goods: 'goods', site_bf_live: 'live', site_bf_shopping: 'shopping' };

/** テンプレートの締めの言葉。セールのリールはセールの設定の文だけ（profile/try は使わない）。合わないときは null */
export function siteCtaOf(templateId: SiteTemplateId, key: SiteCtaKey, sale?: Pick<SaleVideoState, 'id'> | null): SiteCtaText | null {
  if (isSaleSiteTemplateId(templateId)) {
    if (key !== 'sale' || !sale) return null;
    const c = saleVideoConfigOf(sale.id);
    return c ? c.cta[SALE_CTA_KIND[templateId]] : null;
  }
  return key === 'sale' ? null : SITE_CTA_OPTIONS[key];
}

/** 推し活お買い物診断の選択肢（サイトの表示文言。src/lib/oshi-shopping/params.ts と同じ値。読みはここで決める） */
export const SITE_SHOPPING_USE_KANA: Record<string, string> = {
  自分用に集める: 'じぶんようにあつめる',
  'ライブ・遠征に持っていく': 'らいぶ、えんせいにもっていく',
  部屋に飾る: 'へやにかざる',
  プレゼントにする: 'ぷれぜんとにする',
};
export const SITE_SHOPPING_BUDGET_KANA: Record<string, string> = {
  '1,000円まで': 'せんえんまで',
  '3,000円まで': 'さんぜんえんまで',
  '5,000円まで': 'ごせんえんまで',
  '10,000円まで': 'いちまんえんまで',
  上限なし: 'じょうげんなし',
};

// ─── 対象 ───────────────────────────────

export type SitePageRef = { name: string; pagePath: string };

/** 撮影する対象（サーバーがDBで確かめた値。oshi-video-maker の SiteTarget と同じ形） */
export interface SiteTarget {
  kind: 'person' | 'group';
  name: string;
  pagePath: string;
  member?: SitePageRef | null;
  memberCount?: number | null;
  work?: { id: string; title: string; pagePath: string; from: SitePageRef; to: SitePageRef } | null;
  persons?: SitePageRef[] | null;
  shopping?: { use: string; useLabel: string; budget: string; budgetLabel: string } | null;
  card?: { workIds: string[]; variant: 'cool' | 'cute' } | null;
  provider?: { slug: string; name: string; pagePath: string } | null;
  /** 期間限定セールのリール: セール名・開催状態・日時（サーバーがジョブ作成時の日時で決める） */
  sale?: SaleVideoState | null;
  /** 期間限定セールのリール A・B: 過去のライブ映像のコーナー（対象のページの #live-archive）と一覧ページ */
  live?: { groupName: string; listPath: string; performances: number } | null;
}

/** 管理画面で選んだもの（名前・ID・選択肢の値だけ。パス・人数はサーバーが付ける） */
export interface SiteSelection {
  kind: 'person' | 'group';
  name: string;
  member?: string | null;
  workId?: string | null;
  toPerson?: string | null;
  persons?: string[] | null;
  use?: string | null;
  budget?: string | null;
  workIds?: string[] | null;
  variant?: 'cool' | 'cute' | null;
  provider?: string | null;
}

export type SiteSegmentKind = 'hook' | 'step' | 'cta';
export interface SiteSegment {
  id: string;
  kind: SiteSegmentKind;
  step?: SiteStep;
  slotSeconds: number;
  label?: string;
  title?: string;
  sub?: string;
  note?: string;
}
export interface SiteLine {
  id: string;
  text: string;
  kana: string;
}

export interface SiteLinks {
  /** 推奨リンク先（個別ページの正式なパス。ストーリーズのリンクスタンプにもそのまま使える） */
  pageUrl: string;
  /** 推奨リンク先に UTM を付けたもの */
  utmUrl: string;
  /** プロフィールのリンク用（トップページ + UTM） */
  profileUrl: string;
}

// ─── 読み ───────────────────────────────

export interface SiteReadings {
  fixed: Readonly<Record<string, string>>;
  registered: Readonly<Record<string, string>>;
}

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u;
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 名前の読み（固定辞書 → 登録読み → かなだけの名前）。無ければ null（推測しない） */
export function siteReadingOf(term: string, readings: SiteReadings): string | null {
  if (Object.prototype.hasOwnProperty.call(readings.fixed, term)) return readings.fixed[term];
  if (Object.prototype.hasOwnProperty.call(readings.registered, term)) return readings.registered[term];
  if (KANA_ONLY.test(term)) return toHiragana(term).replace(/[・\s]/g, '');
  return null;
}

export const estimateSiteSeconds = (kana: string) => Math.round((countFollowMora(kana) / SITE_MORA_PER_SECOND) * 100) / 100;

// ─── リンク ───────────────────────────────

export const SITE_UTM = { source: 'instagram', medium: 'social', campaign: 'site_referral' } as const;

/** campaign: 期間限定セールのリールはセールの id（例 rakuten-blackfriday-2026）。それ以外は site_referral */
export function withSiteUtm(pathOrUrl: string, templateId: SiteTemplateId, campaign: string = SITE_UTM.campaign): string {
  const u = new URL(pathOrUrl, SITE_ORIGIN);
  u.searchParams.set('utm_source', SITE_UTM.source);
  u.searchParams.set('utm_medium', SITE_UTM.medium);
  u.searchParams.set('utm_campaign', campaign);
  u.searchParams.set('utm_content', templateId);
  return u.toString();
}

/** テンプレートの推奨リンク先のパス（人物・グループ・作品は正式なパス、診断・カード・写真集はその機能のページ） */
export function siteLinkPath(templateId: SiteTemplateId, target: SiteTarget): string {
  switch (templateId) {
    case 'site_group_member_search':
      return target.pagePath;
    case 'site_work_cast_search':
      return target.work?.pagePath ?? target.pagePath;
    case 'site_subscription_diagnosis':
      return '/oshi-vod';
    case 'site_shopping_diagnosis':
      return '/oshi-shopping';
    case 'site_photobook_search':
      return '/photobooks';
    case 'site_fan_card_demo':
      return '/oshi-card';
    case 'site_vod_service_search':
      return target.provider?.pagePath ?? '/';
    case 'site_bf_live':
      return target.live?.listPath ?? target.pagePath;
    case 'site_bf_shopping':
      return '/oshi-shopping';
    default:
      return target.pagePath;
  }
}

export function buildSiteLinks(templateId: SiteTemplateId, target: SiteTarget): SiteLinks {
  const p = siteLinkPath(templateId, target);
  const campaign = isSaleSiteTemplateId(templateId) && target.sale ? target.sale.id : SITE_UTM.campaign;
  return { pageUrl: new URL(p, SITE_ORIGIN).toString(), utmUrl: withSiteUtm(p, templateId, campaign), profileUrl: withSiteUtm('/', templateId, campaign) };
}

// ─── 台本 ───────────────────────────────

export type SitePlan =
  | { ok: true; segments: SiteSegment[]; lines: SiteLine[]; title: string; unresolved: string[]; links: SiteLinks; totalSeconds: number }
  | { ok: false; missing: string[] };

type Draft = { key: 'hook' | 'cta' | SiteStep; text: string; kana: string; label?: string; title?: string; sub?: string; note?: string };

const circled = ['①', '②', '③', '④', '⑤'];

/** セールの冒頭の大きな文字の改行（「、」の後、無ければ「…フライデー」の後） */
export function splitSaleTitle(text: string): string {
  if (text.includes('、')) return text.replace(/、/, '、\n');
  const m = /^(.*?フライデー)(.+)$/.exec(text);
  return m ? `${m[1]}\n${m[2]}` : text;
}

/**
 * 台本と区間を作る（対象はサーバーがDBで確かめたもの）。読みが無い名前は unresolved に出し、読みの欄には名前をそのまま入れる
 * （読みを登録するまで音声用台本はコピーできない）
 */
export function buildSitePlan(opts: { templateId: SiteTemplateId; target: SiteTarget; cta: SiteCtaKey; readings: SiteReadings }): SitePlan {
  const { templateId, target, readings } = opts;
  const spec = SITE_TEMPLATE_SPECS[templateId];
  const unresolved = new Set<string>();
  const k = (term: string) => {
    const r = siteReadingOf(term, readings);
    if (r === null) {
      unresolved.add(term);
      return term;
    }
    return r;
  };
  const missing: string[] = [];
  const steps = siteStepsFor(templateId, target.persons?.length ?? 3);
  const name = target.name;
  const drafts: Draft[] = [];
  const hook = (text: string, kana: string, sub?: string, title?: string, note?: string) => drafts.push({ key: 'hook', text, kana, title: title ?? text.replace(/、/, '、\n'), sub, ...(note ? { note } : {}) });
  const sale = target.sale ? saleVideoConfigOf(target.sale.id) : null;
  if (isSaleSiteTemplateId(templateId) && (!target.sale || !sale)) return { ok: false, missing: ['開催前・開催中のセールがありません（セールの設定を確認してください）'] };
  /** セールの冒頭: 0〜1.5秒 大きなセール名（字幕なし）→ 1.5〜3.5秒 テンプレートごとの一言（実画面を小さく・特典の注記） */
  const saleOpening = (kind: 'goods' | 'live' | 'shopping') => {
    const t = sale!.title;
    hook(t.text, t.kana, undefined, t.display);
    const line = sale!.intro[kind][target.sale!.phase];
    drafts.push({ key: 'intro', text: line.text, kana: line.kana, title: line.text.replace(/、/, '、\n'), sub: name, note: sale!.entryNote });
  };
  const step = (key: SiteStep, label: string, text: string, kana: string, note?: string) => drafts.push({ key, label, text, kana, note });

  switch (templateId) {
    case 'site_person_search':
      hook(spec.hook, 'おしのしゅつえんさくひん、まとめてさがせるのしってた？', name);
      step('search', '名前で検索', `推しサーチで「${name}」と検索すると`, `おしさーちで${k(name)}とけんさくすると`);
      step('works', '出演作品', '出演作品がまとめて出てきます', 'しゅつえんさくひんがまとめてでてきます');
      step('vod', '配信中の作品と配信先', '配信中の作品と、見られるサービスもわかります', 'はいしんちゅうのさくひんと、みられるさーびすもわかります');
      step('goods', '関連商品', '関連商品もここでチェック！', 'かんれんしょうひんもここでちぇっく！');
      break;
    case 'site_group_member_search': {
      const n = target.memberCount ?? 0;
      const m = target.member;
      if (!m || n < 1) missing.push('メンバーを選んでください');
      hook(`${name}の${n}人、ここから探せます`, `${k(name)}の${ninKana(n)}、ここからさがせます`, name);
      step('search', 'グループ名で検索', 'グループ名で検索すると', 'ぐるーぷめいでけんさくすると');
      step('members', 'メンバー一覧', 'メンバー一覧が出てきます', 'めんばーいちらんがでてきます');
      step('member', `${m?.name ?? ''}のページ`, `${m?.name ?? ''}のページでは、出演作品もチェックできます`, `${m ? k(m.name) : ''}のぺーじでは、しゅつえんさくひんもちぇっくできます`);
      break;
    }
    case 'site_work_cast_search': {
      const w = target.work;
      if (!w) {
        missing.push('作品と出演者を選んでください');
        break;
      }
      hook(spec.hook, 'このさくひんにでているひと、ほかになににでてる？', w.title.length <= 24 ? w.title : `${w.title.slice(0, 23)}…`);
      // 推しサーチの検索欄は作品名では検索できない。人物ページの出演作品の「作品名で検索」（絞り込み）であることを見出しで明示する
      step('filter', `${w.from.name}のページの「作品名で検索」`, '出演作品は、作品名でしぼりこめます', 'しゅつえんさくひんは、さくひんめいでしぼりこめます');
      step('work', '作品のページ', '作品のページを開くと', 'さくひんのぺーじをひらくと');
      step('cast', '出演者（当サイト登録）', '推しサーチに登録された出演者がわかります', 'おしさーちにとうろくされたしゅつえんしゃがわかります');
      step('next', `${w.to.name}の出演作品`, `${w.to.name}の、ほかの出演作品もすぐ見られます`, `${k(w.to.name)}の、ほかのしゅつえんさくひんもすぐみられます`);
      break;
    }
    case 'site_three_person_search': {
      const ps = target.persons ?? [];
      if (ps.length < 2 || ps.length > 3) {
        missing.push('人物を2〜3人選んでください');
        break;
      }
      hook(`気になる${ps.length}人、まとめて調べてみた`, `きになる${ninKana(ps.length)}、まとめてしらべてみた`, ps.map((p) => p.name).join('・'));
      const say: Record<string, (p: SitePageRef) => [string, string, string]> = {
        first: (p) => [`${p.name}の出演作品`, `まずは${p.name}。出演作品がひと目でわかります`, `まずは${k(p.name)}。しゅつえんさくひんがひとめでわかります`],
        second: (p) => [`${p.name}の配信中の作品`, `次は${p.name}。配信中の作品もチェック`, `つぎは${k(p.name)}。はいしんちゅうのさくひんもちぇっく`],
        last: (p) => [`${p.name}の関連商品`, `最後に${p.name}。関連商品まで見られます`, `さいごに${k(p.name)}。かんれんしょうひんまでみられます`],
      };
      steps.forEach((s, i) => {
        const [label, text, kana] = say[s](ps[i]);
        step(s, label, text, kana);
      });
      break;
    }
    case 'site_live_search_demo':
      hook(spec.hook, 'おしさーちでけんさくすると、こうなります', name);
      step('typing', '実際の画面', '名前を入れて、候補をタップ', 'なまえをいれて、こうほをたっぷ');
      step('opening', '実際の画面', `${name}のページが開きます`, `${k(name)}のぺーじがひらきます`);
      step('scrolling', '実際の画面', '出演作品も配信先も、スクロールするだけ', 'しゅつえんさくひんもはいしんさきも、すくろーるするだけ');
      break;
    case 'site_subscription_diagnosis':
      hook(spec.hook, 'おしをえらんで、しんだんしてみた', name);
      step('pick', '推しを選んで診断', `サブスク診断で、${name}を選んで診断`, `さぶすくしんだんで、${k(name)}をえらんでしんだん`);
      step('result', '実際の診断結果', '見放題で見られる作品の数から、診断結果が出ます', 'みほうだいでみられるさくひんのかずから、しんだんけっかがでます');
      step('ranking', '目的別ランキング', '月額やコスパで比べたランキングもチェック', 'げつがくやこすぱでくらべたらんきんぐもちぇっく');
      break;
    case 'site_shopping_diagnosis': {
      const s = target.shopping;
      if (!s) {
        missing.push('用途と予算を選んでください');
        break;
      }
      const useKana = SITE_SHOPPING_USE_KANA[s.useLabel];
      const budgetKana = SITE_SHOPPING_BUDGET_KANA[s.budgetLabel];
      if (!useKana || !budgetKana) missing.push('用途・予算の読みがありません');
      hook(spec.hook, 'おしかつぐっず、ようとよさんからさがせます', name);
      step('pick', '推しを選ぶ', `推しは「${name}」`, `おしは${k(name)}`);
      step('answers', '用途と予算を選ぶ', `用途は「${s.useLabel}」、予算は「${s.budgetLabel}」`, `ようとは${useKana ?? s.useLabel}、よさんは${budgetKana ?? s.budgetLabel}`);
      step('result', '実際の診断結果', '楽天の関連商品から、条件に合うものが出てきます', 'らくてんのかんれんしょうひんから、じょうけんにあうものがでてきます', '価格は楽天から取得した時点の表示／購入は楽天の商品ページ（外部サイト）');
      break;
    }
    case 'site_photobook_search':
      hook(spec.hook, 'おしのしゃしんしゅう、ここからちぇっくできます', name);
      step('list', '写真集を探す', '写真集の一覧から', 'しゃしんしゅうのいちらんから');
      step('filter', '人物で絞り込み', `人物で「${name}」を選ぶと`, `じんぶつで${k(name)}をえらぶと`);
      step('item', `${name}の写真集`, '掲載中の写真集が見つかります', 'けいさいちゅうのしゃしんしゅうがみつかります', '購入は楽天の商品ページ（外部サイト）／価格は取得時点の表示');
      break;
    case 'site_fan_card_demo':
      hook(spec.hook, 'おしをしょうかいするかーど、つくってみた！', name);
      step('pick', '推しを選ぶ', `推し布教カードで、${name}を選んで`, `おしふきょうかーどで、${k(name)}をえらんで`);
      step('works', 'おすすめ作品を選ぶ', 'おすすめしたい作品を選んだら', 'おすすめしたいさくひんをえらんだら');
      step('card', 'カードの完成', '布教カードの完成！保存してシェアできます', 'ふきょうかーどのかんせい！ほぞんしてしぇあできます');
      break;
    case 'site_vod_service_search': {
      const p = target.provider;
      if (!p) {
        missing.push('配信サービスを選んでください');
        break;
      }
      hook(spec.hook, 'つかっているさぶすくからさくひんをさがしてみた', p.name);
      step('services', '配信サービスから探す', `配信サービスの一覧から、${p.name}を選ぶと`, `はいしんさーびすのいちらんから、${k(p.name)}をえらぶと`);
      step('provider', `${p.name}のページ`, `${p.name}で配信を確認できた作品が並びます`, `${k(p.name)}ではいしんをかくにんできたさくひんがならびます`);
      step('person', `${name}の配信中の作品`, `人物を選べば、出演作品の配信先もわかります`, 'じんぶつをえらべば、しゅつえんさくひんのはいしんさきもわかります');
      break;
    }
    // ─ 期間限定セール（冒頭・締めはセールの設定の文。セール価格・割引率・ポイント・条件は言わない） ─
    case 'site_bf_goods': {
      const live = target.live;
      if (!live) {
        missing.push('過去のライブ映像のコーナーがある人物・グループを選んでください');
        break;
      }
      saleOpening('goods');
      step('search', '名前で検索', `推しサーチで「${name}」を検索`, `おしさーちで${k(name)}をけんさく`);
      step('goods', '関連商品', '写真集やCDも、まとめて見つかります', 'しゃしんしゅうやしーでぃーも、まとめてみつかります', '価格は楽天から取得した時点の表示／購入は楽天の商品ページ（外部サイト）');
      step('live', '過去のライブ映像', '過去のライブDVD・Blu-rayもチェック', 'かこのらいぶでぃーぶいでぃー、ぶるーれいもちぇっく');
      break;
    }
    case 'site_bf_live': {
      const live = target.live;
      if (!live) {
        missing.push('過去のライブ映像のコーナーがある人物・グループを選んでください');
        break;
      }
      saleOpening('live');
      step('corner', `${live.groupName}のライブ映像`, `${live.groupName}の過去のライブ映像は、ここから`, `${k(live.groupName)}のかこのらいぶえいぞうは、ここから`);
      step('list', 'ライブ映像の一覧', '公演ごとに、一覧でチェックできます', 'こうえんごとに、いちらんでちぇっくできます');
      step('discs', 'DVD・Blu-ray', 'DVDもBlu-rayも、ここからチェック', 'でぃーぶいでぃーもぶるーれいも、ここからちぇっく', '価格は楽天から取得した時点の表示／購入は楽天の商品ページ（外部サイト）');
      break;
    }
    case 'site_bf_shopping': {
      const s = target.shopping;
      if (!s) {
        missing.push('用途を選んでください');
        break;
      }
      const useKana = SITE_SHOPPING_USE_KANA[s.useLabel];
      const budgetKana = SITE_SHOPPING_BUDGET_KANA[s.budgetLabel];
      if (!useKana || !budgetKana) missing.push('用途・予算の読みがありません');
      saleOpening('shopping');
      step('entry', '推し活お買い物診断', '推し活お買い物診断を開いて', 'おしかつおかいものしんだんをひらいて');
      step('pick', '推しを選ぶ', `推しは「${name}」`, `おしは${k(name)}`);
      step('answers', '用途と予算', `用途を選んで、予算は「${s.budgetLabel}」`, `ようとをえらんで、よさんは${budgetKana ?? s.budgetLabel}`);
      step('result', '実際の診断結果', '条件に合う商品が見つかります', 'じょうけんにあうしょうひんがみつかります', '価格は楽天から取得した時点の表示／購入は楽天の商品ページ（外部サイト）');
      break;
    }
  }
  if (missing.length > 0) return { ok: false, missing };

  const cta = siteCtaOf(templateId, opts.cta, target.sale);
  if (!cta) return { ok: false, missing: [isSaleSiteTemplateId(templateId) ? '締めの言葉はセールの設定の文です（台本を作り直してください）' : '締めの言葉を選んでください'] };
  const keyword = cta.sub
    ? cta.sub
    : spec.feature
    ? `サイトで\n「${spec.feature}」`
    : templateId === 'site_work_cast_search'
      ? `検索ワード：${target.work!.from.name}`
      : templateId === 'site_three_person_search'
        ? '検索ワード：推しの名前'
        : templateId === 'site_vod_service_search'
          ? `トップページ「配信サービスから探す」`
          : `検索ワード：${name}`;
  drafts.push({ key: 'cta', text: cta.text, kana: cta.kana, title: cta.title, sub: keyword });

  // 区間の ID・順番は 冒頭 → 手順 → 締め（oshi-video-maker の parseSiteInput と同じ）
  const expected = ['hook', ...steps, 'cta'];
  if (drafts.length !== expected.length || drafts.some((d, i) => d.key !== expected[i])) return { ok: false, missing: ['台本の構成がテンプレートの手順と合いません'] };
  let n = 0;
  const segments: SiteSegment[] = [];
  const lines: SiteLine[] = [];
  drafts.forEach((d, i) => {
    const id = `${String(i + 1).padStart(2, '0')}-${d.key}`;
    const kind: SiteSegmentKind = d.key === 'hook' ? 'hook' : d.key === 'cta' ? 'cta' : 'step';
    const label = kind === 'step' && d.label ? (templateId === 'site_live_search_demo' ? d.label : `${circled[n++] ?? ''} ${d.label}`.trim()) : undefined;
    segments.push({ id, kind, ...(kind === 'step' ? { step: d.key as SiteStep } : {}), slotSeconds: 0, ...(label ? { label } : {}), ...(d.title ? { title: d.title } : {}), ...(d.sub ? { sub: d.sub } : {}), ...(d.note ? { note: d.note } : {}) });
    lines.push({ id, text: d.text, kana: d.kana });
  });
  const slots = allocateSiteSlots(segments, lines, templateId);
  segments.forEach((s, i) => (s.slotSeconds = slots[i]));
  const totalSeconds = Math.round(slots.reduce((a, b) => a + b, 0) * 10) / 10;
  const titleName = isSaleSiteTemplateId(templateId)
    ? name
    : templateId === 'site_vod_service_search' ? `${target.provider!.name}・${name}` : templateId === 'site_work_cast_search' ? target.work!.title : templateId === 'site_three_person_search' ? (target.persons ?? []).map((p) => p.name).join('・') : name;
  const title = `${drafts[0].text}｜${titleName}`.slice(0, 80);
  return { ok: true, segments, lines, title, unresolved: [...unresolved], links: buildSiteLinks(templateId, target), totalSeconds };
}

/** 操作の区間の最短の長さ（読みが短くても画面を読める長さ。これ以上の待ち時間は作らない） */
export const SITE_STEP_MIN_SECONDS = 2.6;
/**
 * 実画面を読む時間が必要な区間だけ、最短の長さを延ばす（B1 の出演作品は作品名が読める速さで送る、
 * B2 のメンバー一覧は全員を見せてから紹介するメンバーをタップする）
 */
export const SITE_STEP_MIN_BY_TEMPLATE: Partial<Record<SiteTemplateId, Partial<Record<SiteStep, number>>>> = {
  site_person_search: { works: 3.4 },
  site_group_member_search: { members: 3.6 },
};
/** 合計がこれより短いときだけ、操作の区間を3秒まで延ばす（目安15〜20秒） */
export const SITE_MIN_TOTAL_SECONDS = 15;

/**
 * 期間限定セールのリールの区間の長さ（音声なし・秒。冒頭 → 手順 → 締め）。依頼の構成どおり
 * 冒頭は全テンプレート共通で 0〜1.5 大きなセール名・1.5〜3.5 テンプレートごとの一言（音声なしの動画はこの長さのまま。
 * CapCut 音声付きは読み上げが収まらなければ Worker が画面を延ばす）。そのあと
 * A 3.5〜6.5 検索・6.5〜10.5 関連商品・10.5〜14.5 ライブ映像・14.5〜17.5 締め（17.5秒）
 * B 3.5〜7.5 コーナー・7.5〜11.5 一覧・11.5〜15.5 DVD/BD・15.5〜19.5 締め（19.5秒）
 * C 3.5〜6.5 診断画面・6.5〜10.5 推し・10.5〜14.5 用途と予算・14.5〜17.5 結果・17.5〜20.5 締め（20.5秒）
 * 操作の区間・締めは読みの見積もりが長い区間だけ延ばす（早送り・途中切れはしない）
 */
export const SALE_SITE_TIMING: Record<SaleSiteTemplateId, number[]> = {
  site_bf_goods: [1.5, 2, 3, 4, 4, 3],
  site_bf_live: [1.5, 2, 4, 4, 4, 4],
  site_bf_shopping: [1.5, 2, 3, 4, 4, 3, 3],
};

/**
 * 区間の長さ（音声なし）: 読みの見積もり + 余白0.6秒。冒頭は2.6〜3.4秒、操作は2.6秒以上（画面を見せる）、締めは2.8秒以上。
 * 合計が15秒に満たないときだけ、操作の区間を順に3秒まで延ばす（読み終わったあとの無駄な待ち時間を作らない）
 */
export function allocateSiteSlots(segments: Pick<SiteSegment, 'kind' | 'step'>[], lines: Pick<SiteLine, 'kana'>[], templateId?: SiteTemplateId): number[] {
  const mins = templateId ? SITE_STEP_MIN_BY_TEMPLATE[templateId] ?? {} : {};
  const r = (v: number) => Math.round(v * 10) / 10;
  if (templateId && isSaleSiteTemplateId(templateId)) {
    const fixed = SALE_SITE_TIMING[templateId];
    return segments.map((s, i) => {
      const est = estimateSiteSeconds(lines[i]?.kana ?? '');
      const base = fixed[i] ?? SITE_STEP_MIN_SECONDS;
      // 冒頭の2区間は構成どおりの長さ（音声なしの見積もりでは延ばさない）
      if (s.kind === 'hook' || s.step === 'intro') return base;
      return r(Math.min(6, Math.max(base, est + 0.6)));
    });
  }
  const slots = segments.map((s, i) => {
    const est = estimateSiteSeconds(lines[i]?.kana ?? '');
    if (s.kind === 'hook') return r(Math.min(3.4, Math.max(2.6, est + 0.4)));
    if (s.kind === 'cta') return r(Math.max(2.8, est + 0.6));
    return r(Math.min(6, Math.max((s.step && mins[s.step]) || SITE_STEP_MIN_SECONDS, est + 0.6)));
  });
  let short = r(SITE_MIN_TOTAL_SECONDS - slots.reduce((a, b) => a + b, 0));
  for (let i = 0; i < slots.length && short > 0; i++) {
    if (segments[i].kind !== 'step' || slots[i] >= 3) continue;
    const add = Math.min(short, r(3 - slots[i]));
    slots[i] = r(slots[i] + add);
    short = r(short - add);
  }
  return slots;
}

/** 台本の確認（読みの見積もりが区間に収まるか・合計の長さ） */
export function checkSiteLines(segments: SiteSegment[], lines: SiteLine[], templateId?: SiteTemplateId): { total: number; overlong: string[]; tooLong: boolean } {
  const slots = allocateSiteSlots(segments, lines, templateId);
  const total = Math.round(slots.reduce((a, b) => a + b, 0) * 10) / 10;
  const overlong = lines.filter((l, i) => estimateSiteSeconds(l.kana) > slots[i]).map((l) => l.id);
  return { total, overlong, tooLong: total > SITE_MAX_SECONDS };
}

/** Instagram 投稿文の案（URLは本文に入れない。リンクはプロフィールから） */
export function buildSiteCaption(opts: { templateId: SiteTemplateId; title: string; target: SiteTarget; cta: SiteCtaKey }): string {
  const spec = SITE_TEMPLATE_SPECS[opts.templateId];
  if (isSaleSiteTemplateId(opts.templateId)) return buildSaleCaption(opts.templateId, opts.title, opts.target);
  const what = spec.feature ? `推しサーチの「${spec.feature}」を実際に使ってみました。` : '推しサーチで実際に検索してみました。';
  const tags = ['#推しサーチ', '#推し活', ...(opts.target.kind === 'group' || opts.templateId === 'site_group_member_search' ? [`#${opts.target.name.replace(/[\s!！&＆・/]/g, '')}`] : [])].join(' ');
  return `${opts.title}\n\n${what}\n${siteCtaOf(opts.templateId, opts.cta)?.text ?? ''}\n\n${tags}`;
}

/**
 * 期間限定セールのリールの Instagram 投稿文案（先頭に PR 表記。URLは本文に入れない）。
 * 日時はセールの設定（公式ページで確認した日時）だけ。参加条件・ポイント・割引は書かず、楽天の公式ページで確認するよう案内する
 */
export function buildSaleCaption(templateId: SaleSiteTemplateId, title: string, target: SiteTarget): string {
  const sale = target.sale;
  const cta = sale ? siteCtaOf(templateId, 'sale', sale) : null;
  const period = sale ? `${sale.name}：${formatJstRange(sale.startsAt, sale.endsAt)}（日本時間）` : '';
  const what =
    templateId === 'site_bf_shopping'
      ? '推しサーチの「推し活お買い物診断」で、予算5,000円までの推し活アイテムを探してみました。'
      : templateId === 'site_bf_live'
        ? `推しサーチで、${target.live?.groupName ?? target.name}の過去のライブ映像（DVD・Blu-ray）を探してみました。`
        : `推しサーチで「${target.name}」の写真集・CD・ライブ映像を探してみました。`;
  const tagName = target.kind === 'group' ? target.name : target.live?.groupName ?? null;
  const tags = ['#PR', '#推しサーチ', '#推し活', '#ブラックフライデー', ...(tagName ? [`#${tagName.replace(/[\s!！&＆・/]/g, '')}`] : [])].join(' ');
  return [
    sale?.prLabel ?? 'PR',
    '',
    title,
    '',
    what,
    cta ? cta.text : '',
    '',
    period,
    '価格・在庫・特典・参加条件は楽天の商品ページ・公式ページでご確認ください。',
    '推しサーチはプロフィールのリンクから。',
    '',
    tags,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

/** 「11/19 20:00〜11/25 1:59」（+9時間固定で計算＝実行環境のTZに依存しない） */
export function formatJstRange(startsAt: string, endsAt: string): string {
  const f = (iso: string) => {
    const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  return `${f(startsAt)}〜${f(endsAt)}`;
}
