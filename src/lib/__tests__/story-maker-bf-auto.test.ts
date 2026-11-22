import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/server/story-maker/goods-data', () => ({
  loadStorySaleCandidates: vi.fn(),
  StoryGoodsError: class extends Error { status = 400; },
}));
vi.mock('@/lib/rakuten-event/item-check', () => ({
  checkRakutenItems: vi.fn(),
  ITEM_CHECK_MESSAGE: { busy: 'API混雑', rate_limited: '利用制限', cooldown: '一時停止中', unavailable: 'API利用不可', config_missing: '設定不足', error: '取得失敗' },
}));

import { pickBfLookupTargets, rankBfAutoCandidates, currentPriceDraft } from '@/lib/story-maker/bf-auto';
import { loadStorySaleCandidates } from '@/server/story-maker/goods-data';
import { checkRakutenItems } from '@/lib/rakuten-event/item-check';
import { suggestBfProducts } from '@/server/story-maker/bf-auto';
import { POST as postSuggest } from '@/app/api/admin/story-maker/bf-auto/route';

const candidate = (productId: string, pageUrl: string, section = 'CD') => ({
  productId, title: `M!LK ${productId}`, section, pageUrl, thumbUrl: null, storedPrice: 9999,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadStorySaleCandidates).mockResolvedValue({ targetName: 'M!LK', totalOnSite: 10, candidates: [
    candidate('cd-123', 'https://books.rakuten.co.jp/rb/123/'),
    candidate('ich-shop:xy1', 'https://item.rakuten.co.jp/shop/xy1/'),
    candidate('ich-shop:xy2', 'https://item.rakuten.co.jp/shop/xy2/'),
  ] });
});

describe('楽天BFの自動選定・現在価格の下書き', () => {
  it('商品URLから照合キーを安全に生成し、同じ商品や不明URLを重複取得しない（最大6件）', () => {
    const list = [
      candidate('a', 'https://books.rakuten.co.jp/rb/123/'),
      candidate('b', 'https://books.rakuten.co.jp/rb/123/?aff=1'),
      candidate('c', 'https://item.rakuten.co.jp/shop/code/'),
      candidate('d', 'https://evil.example.com/foo'),
      candidate('e', 'https://item.rakuten.co.jp/shop/code2/'),
    ];
    expect(pickBfLookupTargets(list, 2).map((x) => x.key)).toEqual(['book:123', 'shop:code']);
  });

  it('在庫と現在価格の両方が確認できた商品だけをおすすめ候補にする', () => {
    expect(rankBfAutoCandidates([
      { productId: 'bad', status: 'out_of_stock', currentPrice: null, fetchedAt: null, hasTimeSalePeriod: false },
      { productId: 'one', status: 'available', currentPrice: 3000, fetchedAt: 1, hasTimeSalePeriod: false },
      { productId: 'two', status: 'available', currentPrice: 2500, fetchedAt: 1, hasTimeSalePeriod: true },
    ])).toEqual(['one', 'two']);
    expect(currentPriceDraft(null)).toBeNull();
    expect(currentPriceDraft(0)).toBeNull();
    expect(currentPriceDraft(3000)).toBe('3000');
    expect(currentPriceDraft(10_000_001)).toBeNull();
  });

  it('公式APIの現在価格と在庫を照合。通常価格・割引率・BF対象の断定を返さず、キャッシュ保存もしない', async () => {
    vi.mocked(checkRakutenItems).mockResolvedValue([
      { code: 'ok', info: { itemCode: 'book:123', itemName: 'M!LK CD', itemPrice: 3117, availability: 1, pointRate: null, pointRateStartTime: null, pointRateEndTime: null, saleStartTime: null, saleEndTime: null, shopName: '楽天ブックス', fetchedAt: 123, source: 'books' } },
      { code: 'ok', info: { itemCode: 'shop:xy1', itemName: 'M!LK CD', itemPrice: 2000, availability: 0, pointRate: null, pointRateStartTime: null, pointRateEndTime: null, saleStartTime: null, saleEndTime: null, shopName: '店', fetchedAt: 123, source: 'ichiba' } },
      { code: 'not_found' },
    ]);
    const r = await suggestBfProducts({ type: 'group', name: 'M!LK' });
    expect(r.recommendedIds).toEqual(['cd-123']);
    expect(r.items[0]).toEqual({ productId: 'cd-123', status: 'available', currentPrice: 3117, fetchedAt: 123, hasTimeSalePeriod: false });
    expect(r.items[1].status).toBe('out_of_stock');
    expect(r.items[2].status).toBe('not_found');
    expect(vi.mocked(checkRakutenItems).mock.calls[0][1]).toEqual({ cache: null });
    expect(JSON.stringify(r)).not.toContain('regularPrice');
    expect(JSON.stringify(r)).not.toContain('confirmed');
    expect(JSON.stringify(r)).not.toContain('salePrice');
  });

  it('APIの利用制限では未取得とし、推測で価格や承認を埋めない', async () => {
    vi.mocked(checkRakutenItems).mockResolvedValue([{ code: 'rate_limited' }, { code: 'skipped' }, { code: 'skipped' }]);
    const r = await suggestBfProducts({ type: 'group', name: 'M!LK' });
    expect(r.warning).toBe('利用制限');
    expect(r.recommendedIds).toEqual([]);
    expect(r.items.every((x) => x.currentPrice === null)).toBe(true);
  });

  it('管理APIは不正な対象を拒否し、正常時は no-store で結果を返す', async () => {
    expect((await postSuggest(new NextRequest('http://localhost/api/admin/story-maker/bf-auto', { method: 'POST', body: JSON.stringify({ type: 'admin', name: 'M!LK' }) }))).status).toBe(400);
    vi.mocked(checkRakutenItems).mockResolvedValue([{ code: 'not_found' }, { code: 'not_found' }, { code: 'not_found' }]);
    const res = await postSuggest(new NextRequest('http://localhost/api/admin/story-maker/bf-auto', { method: 'POST', body: JSON.stringify({ type: 'group', name: 'M!LK' }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).recommendedIds).toEqual([]);
  });
});
