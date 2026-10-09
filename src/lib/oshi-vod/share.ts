// 診断結果のSNS共有テキスト・共有URLの組み立て（純粋関数・DB非依存）。
// 外部APIは使わず、各SNSの公開シェア用URLへ遷移させるだけ。
import { formatPersonList } from './format';

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
