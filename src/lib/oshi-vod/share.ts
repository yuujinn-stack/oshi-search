// 診断結果のSNS共有テキスト・共有URLの組み立て（純粋関数・DB非依存）。
// 外部APIは使わず、各SNSの公開シェア用URLへ遷移させるだけ。
import { formatPersonList } from './format';
import { isOshiVodShareVariant, type OshiVodShareVariant } from './share-variant';

export const OSHI_VOD_HASHTAG = '推しサーチ';

export interface ShareSummary {
  personNames: string[];
  /** 作品数重視1位（同率なら「A・B」）。有料見放題0件なら null */
  topServiceLabel: string | null;
}

export function buildShareText({ personNames, topServiceLabel }: ShareSummary): string {
  const who = formatPersonList(personNames);
  if (!topServiceLabel) return `推しに合うサブスク診断をやってみた！（${who}）`;
  return `推しに合うサブスク診断の結果、${who}の出演作品を一番多く見られるのは「${topServiceLabel}」でした！あなたの推しでも診断してみて`;
}

export function buildXShareUrl(text: string, url: string): string {
  const q = new URLSearchParams({ text, url, hashtags: OSHI_VOD_HASHTAG });
  return `https://x.com/intent/post?${q.toString()}`;
}

export function buildLineShareUrl(url: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
}

// ── 共有リンク経由の計測 ──
// 共有するURLに「どのデザインの画像と一緒に・どの方法で共有したか」を付ける。
//   sv … デザイン（cool / cute）  sm … 共有方法（x / line / copy / native）
// 結果ページはこの2つを診断に使わない（parseOshiVodParams は p / with / group だけを読む）。
// 訪問時に計測したら URL から取り除き、同じタブで始めた新しい診断の計測に引き継ぐ。

export const OSHI_VOD_SHARE_VARIANT_PARAM = 'sv';
export const OSHI_VOD_SHARE_METHOD_PARAM = 'sm';

export type OshiVodShareLinkMethod = 'x' | 'line' | 'copy' | 'native';
const SHARE_LINK_METHODS: readonly OshiVodShareLinkMethod[] = ['x', 'line', 'copy', 'native'];

export interface OshiVodShareAttribution {
  variant: OshiVodShareVariant;
  method: OshiVodShareLinkMethod;
}

/** 結果ページのURL（絶対URL）に共有元の情報を付ける */
export function buildSharedResultUrl(resultUrl: string, attr: OshiVodShareAttribution): string {
  const sep = resultUrl.includes('?') ? '&' : '?';
  return `${resultUrl}${sep}${OSHI_VOD_SHARE_VARIANT_PARAM}=${attr.variant}&${OSHI_VOD_SHARE_METHOD_PARAM}=${attr.method}`;
}

/** 共有リンク経由の訪問か判定する（デザインが分からないURLは共有経由として扱わない） */
export function parseShareAttribution(params: Record<string, string | string[] | undefined>): OshiVodShareAttribution | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const variant = first(params[OSHI_VOD_SHARE_VARIANT_PARAM]);
  if (!isOshiVodShareVariant(variant)) return null;
  const rawMethod = first(params[OSHI_VOD_SHARE_METHOD_PARAM]);
  const method = SHARE_LINK_METHODS.find((m) => m === rawMethod) ?? 'copy';
  return { variant, method };
}

const ATTRIBUTION_STORAGE_KEY = 'oshi-vod-share-attribution';

/** 共有リンク経由で訪れたことを、このタブの間だけ覚えておく（新しい診断開始の計測用） */
export function rememberShareAttribution(attr: OshiVodShareAttribution): void {
  try {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attr));
  } catch { /* 保存できなくても画面操作は続行 */ }
}

export function readShareAttribution(): OshiVodShareAttribution | null {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    return parseShareAttribution({
      [OSHI_VOD_SHARE_VARIANT_PARAM]: typeof v.variant === 'string' ? v.variant : undefined,
      [OSHI_VOD_SHARE_METHOD_PARAM]: typeof v.method === 'string' ? v.method : undefined,
    });
  } catch {
    return null;
  }
}
