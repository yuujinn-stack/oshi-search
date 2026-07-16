/**
 * src/lib/rakuten.ts の getProductsByCategory 直接テスト
 *
 * 検証項目:
 *  - API設定不足（config_missing）: APP_ID/ACCESS_KEY が空 or スペースのみ
 *  - 上流APIエラー（upstream_error）: 403/401/429/500
 *  - 正常取得（ok / empty）
 *  - ネットワーク障害（error）
 *  - エンドポイントバージョン（20260701）
 *  - リクエスト構造（accessKey をヘッダーとクエリパラメータの両方に含む）
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

describe('getProductsByCategory', () => {
  type Module = typeof import('@/lib/rakuten');
  let getProductsByCategory: Module['getProductsByCategory'];

  beforeAll(async () => {
    // module-level 定数（APP_ID, ACCESS_KEY, AUTH_HEADERS）に反映させるため
    // env 設定後にモジュールをリロードして importActual する
    vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
    vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
    vi.stubEnv('RAKUTEN_AFFILIATE_ID', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.example.com');
    vi.resetModules();
    const mod = await vi.importActual<Module>('@/lib/rakuten');
    getProductsByCategory = mod.getProductsByCategory;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // config_missing テストで一時的に変更したenvを元に戻す
    vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
    vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
  });

  // ── 1〜4: API設定不足 ──────────────────────────────────────────────────────

  it('[1] RAKUTEN_APP_ID が未設定のとき config_missing を返す', async () => {
    vi.stubEnv('RAKUTEN_APP_ID', '');
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'config_missing' });
  });

  it('[2] RAKUTEN_ACCESS_KEY が未設定のとき config_missing を返す', async () => {
    vi.stubEnv('RAKUTEN_ACCESS_KEY', '');
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'config_missing' });
  });

  it('[3] RAKUTEN_APP_ID がスペースのみのとき config_missing を返す（trim対応）', async () => {
    vi.stubEnv('RAKUTEN_APP_ID', '   ');
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'config_missing' });
  });

  it('[4] RAKUTEN_ACCESS_KEY がスペースのみのとき config_missing を返す（trim対応）', async () => {
    vi.stubEnv('RAKUTEN_ACCESS_KEY', '   ');
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'config_missing' });
  });

  // ── 5〜8: 上流APIエラー ────────────────────────────────────────────────────

  it.each([
    [403],
    [401],
    [429],
    [500],
  ] as const)('[%#5] HTTP %i が upstream_error に変換される', async (httpStatus) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: httpStatus }),
    );
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'upstream_error', httpStatus });
  });

  // ── 9: 正常取得（ok） ──────────────────────────────────────────────────────

  it('[9] APIが商品を返したとき ok を返す', async () => {
    const mockItem = {
      itemName: 'テスト商品グッズ',
      itemPrice: 1500,
      reviewCount: 10,
      reviewAverage: 4.5,
      itemUrl: 'https://item.rakuten.co.jp/shop/test-item/',
      affiliateUrl: '',
      mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/t.jpg?_ex=128x128' }],
      shopName: 'テストショップ',
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Items: [{ Item: mockItem }], count: 1 }), { status: 200 }),
    );
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.products[0].title).toBe('テスト商品グッズ');
    }
  });

  // ── 10: 0件（empty） ────────────────────────────────────────────────────────

  it('[10] APIが0件を返したとき empty を返す', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 }),
    );
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'empty' });
  });

  // ── 11: ネットワーク障害（error） ────────────────────────────────────────────

  it('[11] ネットワーク障害（fetchがthrow）のとき error を返す', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));
    const result = await getProductsByCategory('テスト', '', 'グッズ');
    expect(result).toEqual({ status: 'error' });
  });

  // ── 12: エンドポイントバージョン ───────────────────────────────────────────

  it('[12] Ichiba検索のエンドポイントに IchibaItem/Search/20260701 が使われている', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 }),
    );
    await getProductsByCategory('テスト', '', 'グッズ');
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('IchibaItem/Search/20260701');
    expect(calledUrl).not.toContain('IchibaItem/Search/20260401');
  });

  // ── 13: accessKey をヘッダーに正確な名前 "accessKey" で送信 ─────────────────

  it('[13] リクエストヘッダーに名前が正確に "accessKey" のヘッダーが含まれる', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 }),
    );
    await getProductsByCategory('テスト', '', 'グッズ');
    const calledHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(calledHeaders).toBeDefined();
    // ヘッダー名が正確に "accessKey"（大文字小文字区別あり）であること
    expect(calledHeaders?.['accessKey']).toBeDefined();
    expect(calledHeaders?.['accessKey']).toBe('test-access-key');
  });

  // ── 補足: クエリパラメータ構造 ─────────────────────────────────────────────

  it('[補足] リクエストURLに applicationId と accessKey が含まれる', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 }),
    );
    await getProductsByCategory('テスト', '', 'グッズ');
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('applicationId=');
    expect(calledUrl).toContain('accessKey=');
  });
});
