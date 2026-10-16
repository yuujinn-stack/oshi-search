import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackRakutenClick, type RakutenClickInfo } from '../rakuten-click-track';

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
});
