import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

// 推し活お買い物診断のデータ取得（src/lib/oshi-shopping/data.ts）：価格の確認待ち・販売終了の確認済みを読み取りだけで除外し、
// 読めない場合も診断は従来どおり表示する。DB・Redis は偽物（書き込みは無い）。
const h = vi.hoisted(() => ({
  reviewRows: [] as { item_id: string }[] | Error,
  mget: vi.fn(),
  redis: true,
  sqlCalls: [] as string[],
}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('@/lib/persons', () => ({ getPersonWithConfigMerged: async (name: string) => ({ name, group: '乃木坂46', config: {} }) }));
vi.mock('@/lib/person-meta', () => ({ getPersonMeta: async () => ({ generation: '3期生' }) }));
const book = (num: string, title: string): RakutenItem => ({
  id: `bk-${num}`, title, price: 2000, reviewCount: 0, reviewAverage: 0, imageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg',
  itemUrl: `https://books.rakuten.co.jp/rb/${num}/`, affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/x/?pc=${encodeURIComponent(`https://books.rakuten.co.jp/rb/${num}/`)}`,
  category: '写真集', relevanceScore: 0,
});
const items = [book('1', '梅澤美波 1st写真集'), book('2', '梅澤美波 2nd写真集'), book('3', '梅澤美波 3rd写真集')];
vi.mock('@/lib/product-store', () => ({ getAllStoredProductsOrThrow: async () => ({ '写真集': { products: items } }) }));
vi.mock('@/lib/judgment-store', () => ({ getAllVerdictsOrThrow: async () => Object.fromEntries(items.map((p) => [p.id, { verdict: 'related' }])) }));
vi.mock('@/db/client', () => ({
  neonSql: (strings: TemplateStringsArray) => {
    h.sqlCalls.push(strings.join('?'));
    return h.reviewRows instanceof Error ? Promise.reject(h.reviewRows) : Promise.resolve(h.reviewRows);
  },
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => (h.redis ? { mget: h.mget } : null) }));
vi.mock('@/lib/price-refresh', () => ({ lookupCodeOf: (p: RakutenItem) => (p.itemUrl?.match(/rb\/(\d+)/) ? `book:${p.itemUrl.match(/rb\/(\d+)/)![1]}` : null) }));
vi.mock('@/lib/price-refresh-runner', () => ({ LOOKUP_CACHE_PREFIX: 'price-lookup:' }));
vi.mock('../oshi-shopping/general-items', () => ({ getGeneralItemEntries: () => [] }));
vi.mock('../oshi-shopping/rakuten-lookup', () => ({ lookupGeneralItems: vi.fn() }));

import { loadOshiShoppingPersonPart } from '../oshi-shopping/data';

describe('推しの関連商品の取得', () => {
  beforeEach(() => {
    h.reviewRows = []; h.redis = true; h.sqlCalls.length = 0;
    h.mget.mockReset().mockResolvedValue([null, null, null]);
  });

  test('価格の確認待ち（pending）の商品と、価格更新で販売終了を確認した商品を除く（読み取りだけ）', async () => {
    h.reviewRows = [{ item_id: 'bk-1' }];
    h.mget.mockResolvedValue([null, JSON.stringify({ itemCode: 'book:2', price: 0, fetchedAt: 1, status: 'unavailable' }), { itemCode: 'book:3', price: 2100, fetchedAt: 1 }]);
    const r = await loadOshiShoppingPersonPart('梅澤美波', 'gift', 'any');
    expect(r?.personItems?.items.map((x) => x.product.id)).toEqual(['bk-3']);
    expect(r?.personItems?.excluded).toEqual({ ambiguousId: 0, priceReview: 1, unavailable: 1 });
    expect(h.sqlCalls[0]).toMatch(/^SELECT item_id FROM price_reviews WHERE person_name = \? AND status = 'pending'$/);
    expect(h.mget).toHaveBeenCalledWith('price-lookup:book:1', 'price-lookup:book:2', 'price-lookup:book:3');
  });

  test('確認待ちの表を読めない・Redis が無い／読めない場合も、除外なしで従来どおり表示する', async () => {
    h.reviewRows = new Error('relation "price_reviews" does not exist');
    h.redis = false;
    const a = await loadOshiShoppingPersonPart('梅澤美波', 'gift', 'any');
    expect(a?.personError).toBe(false);
    expect(a?.personItems?.items).toHaveLength(2); // 同じセクションは最大2件
    h.redis = true;
    h.mget.mockRejectedValue(new Error('redis down'));
    const b = await loadOshiShoppingPersonPart('梅澤美波', 'gift', 'any');
    expect(b?.personError).toBe(false);
    expect(b?.personItems?.excluded).toEqual({ ambiguousId: 0, priceReview: 0, unavailable: 0 });
  });
});
