import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import {
  ichibaItemIdFromApi,
  ichibaItemIdFromStoredItem,
  isLegacyIchibaId,
  isNewIchibaId,
  parseItemCode,
} from '../rakuten-item-id';

const SHOP_HGC = 'ssss0000.tttt1111.ssss0000.uuuu2222'; // 店舗単位の識別部分（架空）
const aff = (page: string, scheme = 'https') => `${scheme}://hb.afl.rakuten.co.jp/hgc/${SHOP_HGC}/?pc=${encodeURIComponent(page)}&m=${encodeURIComponent(page)}&rafcid=x`;
const page = (shop: string, code: string) => `https://item.rakuten.co.jp/${shop}/${code}/`;

describe('楽天市場の新しい商品ID（itemCode 由来）', () => {
  it('itemCode を分解する（大文字小文字は区別しない）／不正な形式は null', () => {
    expect(parseItemCode('CocoHouse:B01GG4VC32')).toEqual({ shop: 'cocohouse', code: 'b01gg4vc32' });
    expect(parseItemCode('no-colon')).toBeNull();
    expect(parseItemCode('a:b:c')).toBeNull();
    expect(parseItemCode('')).toBeNull();
  });

  it('同じ店舗の別商品は別ID（旧IDでは同じ店舗の全商品が同じIDだった）', () => {
    const a = ichibaItemIdFromApi({ itemCode: 'cocohouse:b014bs1fuu', itemUrl: aff(page('cocohouse', 'b014bs1fuu')) });
    const b = ichibaItemIdFromApi({ itemCode: 'cocohouse:b01gg4vc32', itemUrl: aff(page('cocohouse', 'b01gg4vc32')) });
    expect(a).toEqual({ id: 'ich-cocohouse:b014bs1fuu', status: 'ok' });
    expect(b.id).toBe('ich-cocohouse:b01gg4vc32');
    expect(a.id).not.toBe(b.id);
  });

  it('同じ商品は同じID（URLの表記ゆれ・アフィリエイトの包み・http/https・大文字小文字は無関係）', () => {
    const ids = [
      ichibaItemIdFromApi({ itemCode: 'shop1:item1', itemUrl: aff(page('shop1', 'item1')) }).id,
      ichibaItemIdFromApi({ itemCode: 'SHOP1:ITEM1', itemUrl: page('Shop1', 'Item1') }).id,
      ichibaItemIdFromApi({ itemCode: 'shop1:item1', itemUrl: aff('http://item.rakuten.co.jp/shop1/item1', 'http') }).id,
    ];
    expect(new Set(ids)).toEqual(new Set(['ich-shop1:item1']));
  });

  it('itemCode が無い・不正なら推測でIDを作らない', () => {
    expect(ichibaItemIdFromApi({ itemUrl: aff(page('shop1', 'item1')) })).toEqual({ id: null, status: 'missing_itemcode' });
    expect(ichibaItemIdFromApi({ itemCode: 'bad', itemUrl: aff(page('shop1', 'item1')) }).id).toBeNull();
  });

  it('商品URLの店舗が itemCode と一致しなければIDを作らない（別店舗の取り違え防止）', () => {
    expect(ichibaItemIdFromApi({ itemCode: 'shop1:item1', itemUrl: aff(page('shop2', 'item1')) })).toEqual({ id: null, status: 'shop_mismatch' });
  });

  it('店舗が一致し商品コードだけ URL と異なる場合は itemCode を正とする（記録用に区別）', () => {
    expect(ichibaItemIdFromApi({ itemCode: 'shop1:abc-001', itemUrl: aff(page('shop1', 'abc001')) })).toEqual({ id: 'ich-shop1:abc-001', status: 'ok_url_differs' });
  });

  it('楽天市場上の楽天ブックス店（book/<番号>）', () => {
    expect(ichibaItemIdFromApi({ itemCode: 'book:18507785', itemUrl: aff(page('book', '18507785')) }).id).toBe('ich-book:18507785');
  });

  it('移行用：itemCode を保存していない既存商品は、保存済みの遷移先URLから同じ形式のIDを作る', () => {
    expect(ichibaItemIdFromStoredItem({ itemUrl: aff(page('shop1', 'item1')), affiliateUrl: aff(page('shop1', 'item1')) })).toBe('ich-shop1:item1');
    expect(ichibaItemIdFromStoredItem({ itemUrl: 'https://example.com/x' })).toBeNull();
    // itemCode が保存されていればそちらを優先（取得時と同じID）
    expect(ichibaItemIdFromStoredItem({ itemCode: 'shop1:abc-001', itemUrl: aff(page('shop1', 'abc001')) })).toBe('ich-shop1:abc-001');
  });

  it('新旧IDの判別', () => {
    expect(isLegacyIchibaId('ic-g00tje4e.ely9r2d9.g00tje')).toBe(true);
    expect(isLegacyIchibaId('ich-shop1:item1')).toBe(false);
    expect(isNewIchibaId('ich-shop1:item1')).toBe(true);
    expect(isLegacyIchibaId('bk-123')).toBe(false);
  });
});

describe('楽天市場の取得処理（APIはモック）', () => {
  type Module = typeof import('@/lib/rakuten');
  let getProductsByCategory: Module['getProductsByCategory'];
  beforeAll(async () => {
    vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
    vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
    vi.stubEnv('RAKUTEN_AFFILIATE_ID', '');
    vi.resetModules();
    getProductsByCategory = (await vi.importActual<Module>('@/lib/rakuten')).getProductsByCategory;
  });
  afterEach(() => vi.restoreAllMocks());

  const apiItem = (code: string, o: Record<string, unknown> = {}) => ({
    itemName: `商品${code}`, itemPrice: 1000, reviewCount: 0, reviewAverage: 0,
    itemUrl: aff(page('cocohouse', code)), itemCode: `cocohouse:${code}`, affiliateUrl: aff(page('cocohouse', code)),
    mediumImageUrls: [], shopName: 'COCOHOUSE', ...o,
  });

  it('同じ店舗の別商品が1件に潰れず、別IDで両方残る／itemCode の無い商品は保存しない', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      Items: [{ Item: apiItem('b014bs1fuu') }, { Item: apiItem('b01gg4vc32') }, { Item: apiItem('nocode', { itemCode: undefined }) }],
      count: 3,
    }), { status: 200 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await getProductsByCategory('テスト', '', 'グッズ');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const ids = r.products.map((p) => p.id).sort();
    expect(ids).toEqual(['ich-cocohouse:b014bs1fuu', 'ich-cocohouse:b01gg4vc32']);
    expect(r.products.every((p) => p.itemCode?.startsWith('cocohouse:'))).toBe(true);
  });
});

describe('商品ID移行期間の互換（mergeProductItems）', () => {
  it('新IDで再取得した商品が旧IDの既存商品と同じ商品ページなら、既存の旧IDを残す（判定を外さない）', async () => {
    vi.doMock('@/db/write', () => ({ upsertProduct: vi.fn() }));
    vi.doMock('@/db/client', () => ({ db: {}, neonSql: vi.fn() }));
    const { mergeProductItems } = await import('@/lib/product-store');
    const legacy = { id: 'ic-ssss0000.tttt1111.ssss00', title: '予習DVD', itemUrl: aff(page('cocohouse', 'b014bs1fuu')), affiliateUrl: aff(page('cocohouse', 'b014bs1fuu')), price: 1, imageUrl: '', reviewCount: 0, reviewAverage: 0, relevanceScore: 0, category: 'グッズ' } as RakutenItem;
    const sameProduct = { ...legacy, id: 'ich-cocohouse:b014bs1fuu', itemCode: 'cocohouse:b014bs1fuu', price: 2 } as RakutenItem;
    const otherProduct = { ...legacy, id: 'ich-cocohouse:b01gg4vc32', itemCode: 'cocohouse:b01gg4vc32', title: '3rd LIVE', itemUrl: aff(page('cocohouse', 'b01gg4vc32')), affiliateUrl: aff(page('cocohouse', 'b01gg4vc32')) } as RakutenItem;
    const { items } = mergeProductItems([sameProduct, otherProduct], [legacy], new Set([legacy.id]));
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(items).toHaveLength(2);
    expect(byId.get(legacy.id)?.price).toBe(2); // 旧IDのまま内容は更新
    expect(byId.get(legacy.id)?.itemCode).toBe('cocohouse:b014bs1fuu'); // 移行用に itemCode が記録される
    expect(byId.get('ich-cocohouse:b01gg4vc32')?.title).toBe('3rd LIVE'); // 同じ店舗の別商品は新IDで別に追加
    vi.doUnmock('@/db/write');
    vi.doUnmock('@/db/client');
  });

  it('移行後の新ID（URL由来）と取得時の itemCode 由来の新IDが異なっても、同じ商品ページなら既存IDを維持する', async () => {
    vi.doMock('@/db/write', () => ({ upsertProduct: vi.fn() }));
    vi.doMock('@/db/client', () => ({ db: {}, neonSql: vi.fn() }));
    const { mergeProductItems } = await import('@/lib/product-store');
    const migrated = { id: 'ich-shop1:abc001', title: 'A', itemUrl: aff(page('shop1', 'abc001')), affiliateUrl: aff(page('shop1', 'abc001')), price: 1, imageUrl: '', reviewCount: 0, reviewAverage: 0, relevanceScore: 0, category: 'グッズ' } as RakutenItem;
    const fetched = { ...migrated, id: 'ich-shop1:abc-001', itemCode: 'shop1:abc-001' } as RakutenItem;
    const { items } = mergeProductItems([fetched], [migrated], new Set([migrated.id]));
    expect(items.map((i) => i.id)).toEqual(['ich-shop1:abc001']);
    vi.doUnmock('@/db/write');
    vi.doUnmock('@/db/client');
  });
});
