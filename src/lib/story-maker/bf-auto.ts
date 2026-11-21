// 楽天BFの「掲載候補」を自動で絞り込むための純粋関数。
// 楽天APIが返す itemPrice は現在の販売価格であり、BF対象・通常価格・割引率の証明ではない。
// 自動選定は承認ではなく、承認・PNG掲載は従来どおり管理者が楽天の商品ページを確認して行う。

import { productKeyFromPageUrl } from '@/lib/rakuten-affiliate-link';
import type { BfSaleCandidate } from './bf-sale';

/** 1回の操作で照合する上限。共通API制限（1秒1回）と管理画面の応答時間を守る。 */
export const BF_AUTO_LOOKUP_LIMIT = 6;
/** ストーリーズ（最大3件）でもフィードでも、最初に確認するおすすめ件数。 */
export const BF_AUTO_RECOMMEND_LIMIT = 3;

export interface BfLookupTarget {
  productId: string;
  key: string;
  title: string;
  pageUrl: string;
}

export type BfAutoStatus = 'available' | 'out_of_stock' | 'not_found' | 'unavailable';
export interface BfAutoItem {
  productId: string;
  status: BfAutoStatus;
  /** 楽天APIが返す現在価格。通常価格・BF価格と断定しない。 */
  currentPrice: number | null;
  fetchedAt: number | null;
  /** タイムセールの時間が返っても「BF対象」の証明にはしない。 */
  hasTimeSalePeriod: boolean;
}

export interface BfAutoResult {
  items: BfAutoItem[];
  recommendedIds: string[];
  checkedCount: number;
  warning: string | null;
}

/** 商品URLから楽天APIの照合キーを生成。URLが特定できない商品は取得対象から除外。 */
export function pickBfLookupTargets(candidates: readonly BfSaleCandidate[], limit = BF_AUTO_LOOKUP_LIMIT): BfLookupTarget[] {
  const targets: BfLookupTarget[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    if (!item.pageUrl) continue;
    const key = productKeyFromPageUrl(item.pageUrl);
    if (!key) continue;
    const apiKey = key.source === 'books' ? `book:${key.productNumber}` : `${key.shop}:${key.itemCode}`;
    if (seen.has(apiKey)) continue;
    seen.add(apiKey);
    targets.push({ productId: item.productId, title: item.title, pageUrl: item.pageUrl, key: apiKey });
    if (targets.length >= limit) break;
  }
  return targets;
}

/** APIで現在価格と在庫を確認できた候補だけを先頭に並べる。BFの割引率では順位付けしない。 */
export function rankBfAutoCandidates(items: readonly BfAutoItem[], limit = BF_AUTO_RECOMMEND_LIMIT): string[] {
  return items
    .filter((x) => x.status === 'available' && x.currentPrice !== null)
    .slice(0, limit)
    .map((x) => x.productId);
}

/** APIの現在価格は「参考の下書き」にだけ入れる。確認済みフラグや通常価格には一切触れない。 */
export function currentPriceDraft(price: number | null): string | null {
  return price !== null && Number.isInteger(price) && price > 0 && price <= 10_000_000 ? String(price) : null;
}
