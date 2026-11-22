import 'server-only';

import {
  checkRakutenItems,
  ITEM_CHECK_MESSAGE,
  type ItemCheckResult,
} from '@/lib/rakuten-event/item-check';
import {
  BF_AUTO_PREVIEW_RESULT,
  bfAutoLookupBlocked,
  currentPriceDraft,
  pickBfLookupTargets,
  rankBfAutoCandidates,
  type BfAutoItem,
  type BfAutoResult,
} from '@/lib/story-maker/bf-auto';
import { loadStorySaleCandidates } from './goods-data';
import { storyPostsScope } from './post-store';

/** 商品候補を楽天の公式APIで照合。候補・承認・商品データをDB/Redisへ保存しない。 */
export async function suggestBfProducts(target: { type: 'person' | 'group'; name: string }): Promise<BfAutoResult> {
  // Vercel の Preview：候補の読み込み・楽天API・API制御用のRedisロックのどれにも触れる前に止める
  if (bfAutoLookupBlocked(storyPostsScope())) return { ...BF_AUTO_PREVIEW_RESULT };
  const { candidates } = await loadStorySaleCandidates(target);
  const lookup = pickBfLookupTargets(candidates);
  if (lookup.length === 0) return { items: [], recommendedIds: [], checkedCount: 0, warning: '楽天の商品ページを特定できる候補がありません。手動で商品ページを確認してください。' };

  // 他機能の楽天API利用量を奪わないよう6件まで・共通使用権を通す。
  // cache:null により「24時間前の価格」を現在価格と見せず、商品情報キャッシュの書き込みも行わない。
  const results = await checkRakutenItems(lookup.map((x) => ({ key: x.key, title: x.title, itemUrl: x.pageUrl })), { cache: null });
  const items: BfAutoItem[] = lookup.map((x, i) => toAutoItem(x.productId, results[i]));
  const stopped = results.find((r) => r.code === 'busy' || r.code === 'cooldown' || r.code === 'rate_limited' || r.code === 'unavailable' || r.code === 'config_missing' || r.code === 'error');
  return {
    items,
    recommendedIds: rankBfAutoCandidates(items),
    checkedCount: lookup.length,
    warning: stopped && stopped.code !== 'ok' ? ITEM_CHECK_MESSAGE[stopped.code] : null,
  };
}

export function toAutoItem(productId: string, result: ItemCheckResult | undefined): BfAutoItem {
  if (result?.code !== 'ok') return { productId, status: result?.code === 'not_found' ? 'not_found' : 'unavailable', currentPrice: null, fetchedAt: null, hasTimeSalePeriod: false };
  const price = currentPriceDraft(result.info.itemPrice);
  const inStock = result.info.availability === 1;
  return {
    productId,
    status: inStock ? 'available' : 'out_of_stock',
    currentPrice: inStock && price !== null ? Number(price) : null,
    fetchedAt: result.info.fetchedAt,
    hasTimeSalePeriod: !!result.info.saleStartTime && !!result.info.saleEndTime,
  };
}
