import { describe, it, expect, vi } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

vi.mock('@/db/write', () => ({ upsertProduct: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/db/client', () => ({ db: {}, neonSql: vi.fn() }));

import { mergeProductItems, mergeRakutenItem, normalizeItemUrl } from '@/lib/product-store';

const HGC = 'aaaa1111.bbbb2222.aaaa1111.cccc3333';
const SHOP_AFF = 'ssss0000.tttt1111.ssss0000.uuuu2222'; // 楽天市場の店舗単位の識別部分（同じ店舗の全商品で共通）
const aff = (page: string, hgc = HGC) => `https://hb.afl.rakuten.co.jp/hgc/${hgc}/?pc=${encodeURIComponent(page)}`;

function item(id: string, o: Partial<RakutenItem> = {}): RakutenItem {
  return {
    id, title: `商品${id}`, price: 1000, imageUrl: '', itemUrl: '', affiliateUrl: '',
    category: 'CD', relevanceScore: 1, reviewAverage: 0, reviewCount: 0, ...o,
  };
}

describe('再取得時に正規のアフィリエイトURLを通常URLで上書きしない', () => {
  it('楽天APIが affiliateUrl を返さず itemUrl で代用された場合は、既存の正規URLを残す', () => {
    const existing = item('cd-1', { itemUrl: 'https://books.rakuten.co.jp/rb/1/', affiliateUrl: aff('https://books.rakuten.co.jp/rb/1/') });
    const fetched = item('cd-1', { itemUrl: 'https://books.rakuten.co.jp/rb/1/', affiliateUrl: 'https://books.rakuten.co.jp/rb/1/', price: 1200 });
    const merged = mergeRakutenItem(fetched, existing);
    expect(merged.affiliateUrl).toBe(existing.affiliateUrl);
    expect(merged.price).toBe(1200); // 他のフィールドは従来どおり更新
  });

  it('新しい正規URLへの更新は従来どおり行う', () => {
    const existing = item('cd-1', { affiliateUrl: aff('https://books.rakuten.co.jp/rb/1/') });
    const next = aff('https://books.rakuten.co.jp/rb/1/', 'zzzz9999.yyyy8888.zzzz9999.xxxx7777');
    expect(mergeRakutenItem(item('cd-1', { affiliateUrl: next }), existing).affiliateUrl).toBe(next);
  });

  it('修正済みの手動商品（通常URLの itemUrl＋正規 affiliateUrl）に同じ商品が再取得されても通常URLに戻らない', () => {
    const page = 'https://books.rakuten.co.jp/rb/18507785/';
    const manual = item('mn-a', { itemUrl: page, affiliateUrl: aff(page) });
    const fetched = item('cd-18507785', { itemUrl: page, affiliateUrl: page }); // affiliateUrl が付かなかった取得
    const { items } = mergeProductItems([fetched], [manual], new Set(['mn-a']));
    expect(items).toHaveLength(1);
    expect(items[0].affiliateUrl).toBe(aff(page));
  });
});

describe('同じ店舗の別商品を同一とみなさない', () => {
  const p1 = 'https://item.rakuten.co.jp/cocohouse/b014bs1fuu/';
  const p2 = 'https://item.rakuten.co.jp/cocohouse/b01gg4vc32/';

  it('アフィリエイトURLは遷移先の商品ページで比較する', () => {
    expect(normalizeItemUrl(aff(p1, SHOP_AFF))).not.toBe(normalizeItemUrl(aff(p2, SHOP_AFF)));
    expect(normalizeItemUrl(aff(p1, SHOP_AFF))).toBe(normalizeItemUrl(p1));
  });

  it('手動登録した楽天市場の商品が、同じ店舗の別商品の再取得で上書き・統合されない', () => {
    const manual = item('mn-a', { title: '予習DVD', itemUrl: aff(p1, SHOP_AFF), affiliateUrl: aff(p1, SHOP_AFF) });
    const fetched = item('ic-other', { title: '3rd YEAR BIRTHDAY LIVE', itemUrl: aff(p2, SHOP_AFF), affiliateUrl: aff(p2, SHOP_AFF) });
    const { items } = mergeProductItems([fetched], [manual], new Set(['mn-a']));
    expect(items.map((i) => i.title).sort()).toEqual(['3rd YEAR BIRTHDAY LIVE', '予習DVD']);
    expect(items.find((i) => i.id === 'mn-a')?.itemUrl).toBe(aff(p1, SHOP_AFF));
  });

  it('同じ商品（同じ遷移先）なら従来どおり1件に統合する', () => {
    const existing = item('ic-1', { itemUrl: aff(p1, SHOP_AFF) });
    const fetched = item('ic-2', { itemUrl: aff(p1, SHOP_AFF), title: '更新後' });
    const { items } = mergeProductItems([fetched], [existing], new Set());
    expect(items).toHaveLength(1);
  });
});
