import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rakutenShopOf, trackRakutenAuxClick, trackRakutenClick, type RakutenClickInfo } from '../rakuten-click-track';

const base: RakutenClickInfo = {
  productId: 'cd-15830647',
  personSlug: '梅澤美波',
  title: '今が思い出になるまで (通常盤)',
  category: 'CD',
  imageUrl: 'https://example.com/a.jpg',
  affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=y',
  pageType: 'person',
  placement: 'person_product_list',
  position: 3,
  linkElement: 'cta',
};

describe('trackRakutenClick', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let gtagMock: ReturnType<typeof vi.fn>;
  let now = 1_000_000;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    gtagMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { hostname: 'oshi-search.jp' }, gtag: gtagMock });
    now += 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('既存の /api/track（type:product）と GA4 affiliate_click にそれぞれ1回送る', () => {
    trackRakutenClick(base);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/track');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({
      type: 'product',
      productId: base.productId,
      slug: base.personSlug,
      title: base.title,
      category: 'CD',
      imageUrl: base.imageUrl,
      affiliateUrl: base.affiliateUrl,
    });
    expect(gtagMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).toHaveBeenCalledWith('event', 'affiliate_click', expect.objectContaining({
      affiliate_name: 'rakuten',
      page_type: 'person',
      placement: 'person_product_list',
      position: 3,
      link_element: 'cta',
      person_name: '梅澤美波',
      product_id: base.productId,
      product_category: 'CD',
    }));
  });

  test('同じ商品・同じ位置の連続クリック（1秒以内）は1回だけ計測する', () => {
    trackRakutenClick(base);
    now += 300;
    trackRakutenClick({ ...base, linkElement: 'title' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).toHaveBeenCalledTimes(1);
    now += 2000;
    trackRakutenClick(base);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('saveMeta=false ではメタデータを送らない（人物ページ由来のメタを上書きしない）', () => {
    trackRakutenClick({ ...base, personSlug: '', pageType: 'group', placement: 'group_products', saveMeta: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: 'product', productId: base.productId, slug: '' });
  });

  test('本番ホスト以外では GA4 に送らない（/api/track は従来どおり）', () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' }, gtag: gtagMock });
    trackRakutenClick({ ...base, placement: 'local_check' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).not.toHaveBeenCalled();
  });

  test('GA4 の item_name は100文字までに切り詰める', () => {
    trackRakutenClick({ ...base, placement: 'long', title: 'あ'.repeat(150) });
    expect(gtagMock.mock.calls[0][2].item_name).toHaveLength(100);
  });

  test('countInRanking=false（一般商品）は /api/track に送らず GA4 だけに送る', () => {
    trackRakutenClick({
      ...base, productId: 'general:sample-shop:10000001', personSlug: '', pageType: 'oshi_shopping',
      placement: 'oshi_shopping_general', countInRanking: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gtagMock).toHaveBeenCalledTimes(1);
    expect(gtagMock.mock.calls[0][2]).toMatchObject({ affiliate_name: 'rakuten', page_type: 'oshi_shopping', placement: 'oshi_shopping_general' });
  });

  test('既存の項目は名前・値とも従来どおりで、追加項目（group_name・work_id・rakuten_shop）は該当時だけ付く', () => {
    trackRakutenClick(base);
    const params = gtagMock.mock.calls[0][2];
    expect(Object.keys(params).filter((k) => params[k] !== undefined).sort()).toEqual([
      'affiliate_name', 'item_name', 'link_element', 'page_type', 'person_name', 'placement', 'position',
      'product_category', 'product_id',
    ]);
    expect(params.group_name).toBeUndefined();
    expect(params.work_id).toBeUndefined();
    // affiliateUrl の遷移先が商品ページでない（テスト用の pc=y）ためショップは判定しない
    expect(params.rakuten_shop).toBeUndefined();
  });

  test('グループページ: group_name を送る（person_name は空のまま送らない）', () => {
    trackRakutenClick({ ...base, personSlug: '', groupName: '乃木坂46', pageType: 'group', placement: 'group_products', saveMeta: false });
    expect(gtagMock.mock.calls[0][2]).toMatchObject({ page_type: 'group', group_name: '乃木坂46', person_name: undefined });
  });

  test('作品ページ: work_id を送る', () => {
    trackRakutenClick({ ...base, personSlug: '', workId: 'tmdb-tv-295597', pageType: 'work', placement: 'work_related_products', saveMeta: false });
    expect(gtagMock.mock.calls[0][2]).toMatchObject({ page_type: 'work', work_id: 'tmdb-tv-295597' });
  });

  test('ライブ映像コーナー: page_type は live_archive（group と混ざらない）', () => {
    trackRakutenClick({ ...base, personSlug: '', groupName: 'Snow Man', pageType: 'live_archive', placement: 'live_archive_group_page', saveMeta: false });
    expect(gtagMock.mock.calls[0][2]).toMatchObject({ page_type: 'live_archive', group_name: 'Snow Man', placement: 'live_archive_group_page' });
  });

  test('rakuten_shop: リンク先の楽天ブックス／楽天市場の店舗をURLから読み取って送る', () => {
    const books = 'https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F18221363%2F';
    trackRakutenClick({ ...base, placement: 'shop_books', affiliateUrl: books });
    expect(gtagMock.mock.calls[0][2].rakuten_shop).toBe('books');
    const ichiba = 'https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fsample-shop%2Fitem-001%2F';
    trackRakutenClick({ ...base, placement: 'shop_ichiba', affiliateUrl: ichiba });
    expect(gtagMock.mock.calls[1][2].rakuten_shop).toBe('sample-shop');
    // 計測では URL を読むだけで、/api/track に送る affiliateUrl は受け取った値そのまま
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).affiliateUrl).toBe(books);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).affiliateUrl).toBe(ichiba);
  });

  test('中クリック（auxclick の button=1）は1回計測する', () => {
    trackRakutenAuxClick({ button: 1 }, { ...base, placement: 'aux_middle' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).toHaveBeenCalledTimes(1);
    expect(gtagMock.mock.calls[0][1]).toBe('affiliate_click');
  });

  test('右クリック（button=2 のメニュー表示）・その他のボタンは計測しない', () => {
    trackRakutenAuxClick({ button: 2 }, { ...base, placement: 'aux_right' });
    trackRakutenAuxClick({ button: 3 }, { ...base, placement: 'aux_back' });
    trackRakutenAuxClick({ button: 0 }, { ...base, placement: 'aux_primary' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gtagMock).not.toHaveBeenCalled();
  });

  test('同じリンクで click と auxclick が続けて発火しても1回だけ計測する', () => {
    const info = { ...base, placement: 'aux_dedupe' };
    trackRakutenClick(info);
    now += 50;
    trackRakutenAuxClick({ button: 1 }, info);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).toHaveBeenCalledTimes(1);
  });

  test('戻り値: 計測したら true、重複・右クリックは false（ライブ映像の別イベントの重複防止に使う）', () => {
    const info = { ...base, placement: 'ret_value' };
    expect(trackRakutenClick(info)).toBe(true);
    now += 100;
    expect(trackRakutenClick(info)).toBe(false);
    expect(trackRakutenAuxClick({ button: 1 }, info)).toBe(false);
    now += 2000;
    expect(trackRakutenAuxClick({ button: 2 }, info)).toBe(false);
    expect(trackRakutenAuxClick({ button: 1 }, info)).toBe(true);
  });
});

describe('rakutenShopOf', () => {
  test('楽天ブックス・楽天市場・楽天市場上の楽天ブックス店', () => {
    expect(rakutenShopOf('https://books.rakuten.co.jp/rb/17687609/')).toBe('books');
    expect(rakutenShopOf('https://item.rakuten.co.jp/book/17687609/')).toBe('books');
    expect(rakutenShopOf('https://item.rakuten.co.jp/Sample-Shop/abc-1/')).toBe('sample-shop');
  });
  test('判定できない URL は undefined（短縮URL・空・他サイト）', () => {
    expect(rakutenShopOf('https://a.r10.to/hXXXXX')).toBeUndefined();
    expect(rakutenShopOf('')).toBeUndefined();
    expect(rakutenShopOf(undefined)).toBeUndefined();
    expect(rakutenShopOf('https://example.com/rb/1/')).toBeUndefined();
  });
});
