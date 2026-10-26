// 推し布教カード（/oshi-card）の URL パラメータ・定型フレーズ・パスの組み立て（DB非依存。'use client' からも import 可）。
//
// 人物の識別子は既存の正式な一意キーである personName（人物ページ /person/{name} と同じ）。
// 作品の識別子は works テーブルの id（その人物の公開作品の行の id）。順序は w の並び順そのもの。
//
//   /oshi-card                         … 推しを選ぶ
//   /oshi-card?p=人物                  … 作品・デザイン・ひとことを選ぶ（人物ページからの入口）
//   /oshi-card?p=人物&w=作品&w=作品…   … 完成したカード（共有するURL。v・ph は既定値なら省略）
//
// - p     … 人物（1人）
// - w     … おすすめ作品の id（1〜3件・この順で表示）
// - v     … デザイン（cool / cute。既定 cool）
// - ph    … ひとこと（定型フレーズの id。既定 fukyo）
// - edit  … 1 のとき、完成カードの内容を引き継いで編集画面を開く
// - from  … 入口（person / top / share）。計測用
// - sm    … 共有リンク経由の訪問（x / line / copy / native）。計測用・表示後に URL から除去
import { OSHI_VOD_DEFAULT_SHARE_VARIANT, parseOshiVodShareVariant, type OshiVodShareVariant } from '@/lib/oshi-vod/share-variant';

export const OSHI_CARD_PATH = '/oshi-card';
export const OSHI_CARD_MAX_WORKS = 3;
const MAX_NAME_LENGTH = 60;
const MAX_WORK_ID_LENGTH = 200;

/** カードのデザイン（サブスク診断の共有画像と同じ2系統） */
export type OshiCardVariant = OshiVodShareVariant;
export const OSHI_CARD_DEFAULT_VARIANT: OshiCardVariant = OSHI_VOD_DEFAULT_SHARE_VARIANT;

/**
 * 見出しの定型フレーズ。自由入力は受け付けない（不適切な文章・個人情報・権利上の問題を避けるため）。
 * 「おすすめ」は投稿者の主観であり、公式ランキングや客観的な順位ではない表現にする。
 */
export const OSHI_CARD_PHRASES = [
  { id: 'fukyo', text: '私の推しを布教します' },
  { id: 'first', text: 'まずはこの作品から見てほしい' },
  { id: 'numa', text: 'この作品で沼に落ちました' },
  { id: 'miryoku', text: '推しの魅力が伝わる作品たち' },
  { id: 'again', text: '何度でも見返したい推しの作品' },
] as const;
export type OshiCardPhraseId = (typeof OSHI_CARD_PHRASES)[number]['id'];
export const OSHI_CARD_DEFAULT_PHRASE: OshiCardPhraseId = 'fukyo';

export function isOshiCardPhraseId(raw: unknown): raw is OshiCardPhraseId {
  return OSHI_CARD_PHRASES.some((p) => p.id === raw);
}

export function oshiCardPhraseText(id: OshiCardPhraseId): string {
  return OSHI_CARD_PHRASES.find((p) => p.id === id)!.text;
}

/** カードに必ず載せる誘導 */
export const OSHI_CARD_CTA = 'あなたの推しでも作ってみて';
/** おすすめが投稿者の主観であることの注記 */
export const OSHI_CARD_DISCLAIMER = '※作品は投稿者が選んだおすすめです（公式の順位ではありません）';

export type OshiCardShareMethod = 'x' | 'line' | 'copy' | 'native';
const SHARE_METHODS: readonly OshiCardShareMethod[] = ['x', 'line', 'copy', 'native'];
export type OshiCardEntrySource = 'person' | 'top' | 'share';
const ENTRY_SOURCES: readonly OshiCardEntrySource[] = ['person', 'top', 'share'];

type RawParam = string | string[] | undefined;
const toList = (raw: RawParam): string[] => (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]);
const first = (raw: RawParam): string | undefined => toList(raw)[0];

export interface ParsedOshiCardParams {
  person: string | null;
  /** 重複・空・長すぎる値を除いた作品 id（最大3件・指定順） */
  workIds: string[];
  /** 4件目以降・重複が指定されていた */
  workOverflow: boolean;
  variant: OshiCardVariant;
  phrase: OshiCardPhraseId;
  edit: boolean;
  from: OshiCardEntrySource | null;
  shareMethod: OshiCardShareMethod | null;
}

export function parseOshiCardParams(params: Record<string, RawParam>): ParsedOshiCardParams {
  const personRaw = first(params.p)?.trim() ?? '';
  const seen = new Set<string>();
  const ids: string[] = [];
  let dropped = false;
  for (const raw of toList(params.w)) {
    const id = raw.trim();
    if (!id || id.length > MAX_WORK_ID_LENGTH || seen.has(id)) { dropped = true; continue; }
    seen.add(id);
    ids.push(id);
  }
  const phraseRaw = first(params.ph);
  const fromRaw = first(params.from);
  const smRaw = first(params.sm);
  return {
    person: personRaw && personRaw.length <= MAX_NAME_LENGTH ? personRaw : null,
    workIds: ids.slice(0, OSHI_CARD_MAX_WORKS),
    workOverflow: dropped || ids.length > OSHI_CARD_MAX_WORKS,
    variant: parseOshiVodShareVariant(first(params.v)),
    phrase: isOshiCardPhraseId(phraseRaw) ? phraseRaw : OSHI_CARD_DEFAULT_PHRASE,
    edit: first(params.edit) === '1',
    from: ENTRY_SOURCES.find((s) => s === fromRaw) ?? null,
    shareMethod: SHARE_METHODS.find((m) => m === smRaw) ?? null,
  };
}

export interface OshiCardSelection {
  person: string;
  workIds: string[];
  variant: OshiCardVariant;
  phrase: OshiCardPhraseId;
}

/** p・w・v・ph のクエリ（既定値は省略。正規形） */
function selectionQuery({ person, workIds, variant, phrase }: OshiCardSelection): string {
  const parts = [`p=${encodeURIComponent(person)}`, ...workIds.slice(0, OSHI_CARD_MAX_WORKS).map((w) => `w=${encodeURIComponent(w)}`)];
  if (variant !== OSHI_CARD_DEFAULT_VARIANT) parts.push(`v=${variant}`);
  if (phrase !== OSHI_CARD_DEFAULT_PHRASE) parts.push(`ph=${phrase}`);
  return parts.join('&');
}

/** 推しを選んだ編集画面（人物ページ・トップからの入口） */
export function buildOshiCardEditPath(person: string, opts: { from?: OshiCardEntrySource; selection?: Omit<OshiCardSelection, 'person'> } = {}): string {
  const q = opts.selection
    ? `${selectionQuery({ person, ...opts.selection })}&edit=1`
    : `p=${encodeURIComponent(person)}`;
  return `${OSHI_CARD_PATH}?${q}${opts.from ? `&from=${opts.from}` : ''}`;
}

/** 完成したカードのページ（共有するURL） */
export function buildOshiCardResultPath(sel: OshiCardSelection): string {
  return `${OSHI_CARD_PATH}?${selectionQuery(sel)}`;
}

/** 共有するURL（共有方法 sm 付き） */
export function buildOshiCardSharedUrl(origin: string, sel: OshiCardSelection, method: OshiCardShareMethod): string {
  return `${origin}${buildOshiCardResultPath(sel)}&sm=${method}`;
}

export type OshiCardImageSize = 'feed' | 'story' | 'og';
export const OSHI_CARD_IMAGE_SIZES: Record<OshiCardImageSize, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
};

export function parseOshiCardImageSize(raw: string | null | undefined): OshiCardImageSize {
  return raw === 'story' || raw === 'og' ? raw : 'feed';
}

/** 投稿用・ストーリーズ用の画像（プレビュー・保存・端末の共有） */
export function buildOshiCardImagePath(sel: OshiCardSelection, size: OshiCardImageSize = 'feed'): string {
  return `/api/oshi-card/image?${selectionQuery(sel)}${size === 'feed' ? '' : `&size=${size}`}`;
}

/** X・LINE のカード画像（og:image）。/api/ は robots.txt でクロール禁止のため /oshi-card/og から配信する */
export const OSHI_CARD_OG_IMAGE_PATH = `${OSHI_CARD_PATH}/og`;
export function buildOshiCardOgImagePath(sel: OshiCardSelection): string {
  return `${OSHI_CARD_OG_IMAGE_PATH}?${selectionQuery(sel)}`;
}
