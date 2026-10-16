import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 楽天APIは呼ばない（fetch をモック）。管理画面の楽天検索が API の affiliateUrl を落とさずに返すことを確認する。
vi.mock('@/lib/rakuten', () => ({ logRakutenUpstreamError: vi.fn() }));

const page = 'https://books.rakuten.co.jp/rb/18507785/';
const aff = (p: string) => `https://hb.afl.rakuten.co.jp/hgc/aaaa1111.bbbb2222.aaaa1111.cccc3333/?pc=${encodeURIComponent(p)}`;

async function search(type: string, apiItem: Record<string, unknown>) {
  vi.stubEnv('RAKUTEN_APP_ID', 'app');
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'key');
  vi.stubEnv('RAKUTEN_AFFILIATE_ID', 'aff');
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Items: [{ Item: apiItem }], count: 1 }) });
  vi.stubGlobal('fetch', fetchMock);
  const { GET } = await import('@/app/api/admin/rakuten-search/route');
  const res = await GET({ nextUrl: new URL(`http://localhost/api/admin/rakuten-search?type=${type}&q=x`) } as never);
  return { json: await res.json(), fetchMock };
}

describe('管理画面の楽天検索は楽天APIの正規 affiliateUrl を返す', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  for (const type of ['books_kw', 'cd', 'dvd']) {
    it(`楽天ブックス系（${type}）：itemUrl は通常URL、affiliateUrl は API の正規URL`, async () => {
      const { json, fetchMock } = await search(type, { title: 'T', itemUrl: page, affiliateUrl: aff(page), itemPrice: 1 });
      expect(json.items[0]).toMatchObject({ itemUrl: page, affiliateUrl: aff(page) });
      expect(fetchMock).toHaveBeenCalledTimes(1); // 追加の API 呼び出しなし
    });
  }

  it('楽天市場：itemUrl 自体がアフィリエイトURL（affiliateUrl も保持）', async () => {
    const ichiba = aff('https://item.rakuten.co.jp/shop1/item1/');
    const { json } = await search('ichiba', { itemName: 'G', itemUrl: ichiba, affiliateUrl: ichiba, itemPrice: 1, mediumImageUrls: [] });
    expect(json.items[0]).toMatchObject({ itemUrl: ichiba, affiliateUrl: ichiba });
  });

  it('API が affiliateUrl を返さない場合は空（通常URLで代用しない）', async () => {
    const { json } = await search('books_kw', { title: 'T', itemUrl: page, itemPrice: 1 });
    expect(json.items[0].affiliateUrl).toBe('');
  });
});
