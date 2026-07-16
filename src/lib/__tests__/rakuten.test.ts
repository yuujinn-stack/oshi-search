/**
 * src/lib/rakuten.ts の直接テスト
 *
 * getProductsByCategory 検証項目:
 *  - API設定不足（config_missing）: APP_ID/ACCESS_KEY が空 or スペースのみ
 *  - 上流APIエラー（upstream_error）: 403/401/429/500
 *  - 正常取得（ok / empty）
 *  - ネットワーク障害（error）
 *  - エンドポイントバージョン（20260701）
 *  - リクエスト構造（accessKey をヘッダーとクエリパラメータの両方に含む）
 *
 * logRakutenUpstreamError 検証項目:
 *  - 構造化ログの全フィールドが正しく出力される
 *  - pathname のみ記録しクエリ文字列は含まない
 *  - 非JSONボディ対応
 *  - responseExcerpt 300文字切り捨て
 *  - apiVersion 抽出（Ichiba / Books）
 */
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';

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

// ─────────────────────────────────────────────────────────────────────────────
// logRakutenUpstreamError テスト
// ─────────────────────────────────────────────────────────────────────────────
describe('logRakutenUpstreamError', () => {
  type Module = typeof import('@/lib/rakuten');
  let logRakutenUpstreamError: Module['logRakutenUpstreamError'];

  beforeAll(async () => {
    vi.resetModules();
    const mod = await vi.importActual<Module>('@/lib/rakuten');
    logRakutenUpstreamError = mod.logRakutenUpstreamError;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DIAG = {
    hasApplicationId: true,
    applicationIdLength: 10,
    hasAccessKey: true,
    accessKeyLength: 32,
    applicationIdQuerySent: true,
    accessKeyHeaderSent: true,
    accessKeyQuerySent: true,
  };

  function makeRes(body: string, status: number, contentType = 'application/json') {
    return new Response(body, { status, headers: { 'content-type': contentType } });
  }

  it('[L1] 403 + JSONエラーボディ → 全フィールドを含む構造化ログを出力する', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{"error":"wrong_parameter","error_description":"applicationId is wrong"}', 403),
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=test&accessKey=key',
      DIAG,
    );
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe('rakuten_api_upstream_error');
    expect(logged.hostname).toBe('openapi.rakuten.co.jp');
    expect(logged.pathname).toBe('/ichibams/api/IchibaItem/Search/20260701');
    expect(logged.apiVersion).toBe('20260701');
    expect(logged.method).toBe('GET');
    expect(logged.upstreamStatus).toBe(403);
    expect(logged.upstreamErrorCode).toBe('wrong_parameter');
    expect(logged.upstreamErrorMessage).toBe('applicationId is wrong');
    expect(logged.responseContentType).toBe('application/json');
  });

  it('[L2] pathname にクエリ文字列（秘密値）が含まれない', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{}', 403),
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=SECRET_APP&accessKey=SECRET_KEY',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.pathname).not.toContain('SECRET_APP');
    expect(logged.pathname).not.toContain('SECRET_KEY');
    expect(logged.pathname).not.toContain('applicationId');
    expect(logged.pathname).not.toContain('accessKey');
    expect(logged.pathname).toBe('/ichibams/api/IchibaItem/Search/20260701');
  });

  it('[L3] 非JSONボディのとき upstreamErrorCode・upstreamErrorMessage は null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('<html>Forbidden</html>', 403, 'text/html'),
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBeNull();
    expect(logged.upstreamErrorMessage).toBeNull();
    expect(logged.responseContentType).toBe('text/html');
  });

  it('[L4] responseExcerpt は 300 文字で切り捨てる', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('A'.repeat(500), 429),
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.responseExcerpt.length).toBe(300);
    expect(logged.upstreamStatus).toBe(429);
  });

  it('[L5] BooksBook API の apiVersion を正しく抽出する（20170404）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{}', 403),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404?keyword=test',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.apiVersion).toBe('20170404');
    expect(logged.pathname).toBe('/services/api/BooksBook/Search/20170404');
  });

  it('[L6] authDiag の全フィールドがログに展開される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{}', 500),
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.hasApplicationId).toBe(true);
    expect(logged.applicationIdLength).toBe(10);
    expect(logged.hasAccessKey).toBe(true);
    expect(logged.accessKeyLength).toBe(32);
    expect(logged.applicationIdQuerySent).toBe(true);
    expect(logged.accessKeyHeaderSent).toBe(true);
    expect(logged.accessKeyQuerySent).toBe(true);
  });

  it('[L7] フラット形式 errorCode(数値)/errorMessage → upstreamErrorCode・upstreamErrorMessage に変換される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{"errorCode":403,"errorMessage":"Invalid application ID"}', 403),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBe('403');
    expect(logged.upstreamErrorMessage).toBe('Invalid application ID');
  });

  it('[L8] フラット形式 errorCode(文字列) → upstreamErrorCode に変換される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{"errorCode":"forbidden","errorMessage":"Access denied"}', 403),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBe('forbidden');
    expect(logged.upstreamErrorMessage).toBe('Access denied');
  });

  it('[L9] 入れ子形式 errors.errorCode(数値)/errors.errorMessage → 正しく解析される（Books 403 実形式）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{"errors":{"errorCode":403,"errorMessage":"Unauthorized access"}}', 403),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBe('403');
    expect(logged.upstreamErrorMessage).toBe('Unauthorized access');
  });

  it('[L10] フラット形式が存在するとき入れ子形式より優先される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logRakutenUpstreamError(
      makeRes('{"errorCode":401,"errorMessage":"flat message","errors":{"errorCode":403,"errorMessage":"nested message"}}', 401),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
      DIAG,
    );
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBe('401');
    expect(logged.upstreamErrorMessage).toBe('flat message');
  });

  it('[L11] errors が配列のとき例外にならず upstreamErrorCode・upstreamErrorMessage は null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logRakutenUpstreamError(
        makeRes('{"errors":[{"errorCode":403}]}', 403),
        'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
        DIAG,
      ),
    ).resolves.toBeUndefined();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBeNull();
    expect(logged.upstreamErrorMessage).toBeNull();
  });

  it('[L12] errors が文字列のとき例外にならず upstreamErrorCode・upstreamErrorMessage は null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logRakutenUpstreamError(
        makeRes('{"errors":"Forbidden"}', 403),
        'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
        DIAG,
      ),
    ).resolves.toBeUndefined();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.upstreamErrorCode).toBeNull();
    expect(logged.upstreamErrorMessage).toBeNull();
  });

  it('[L13] authDiag のログ出力に applicationId・accessKey の実値が含まれない', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sensitiveAppId = 'MY_SECRET_APP_ID_12345';
    const sensitiveKey = 'MY_SECRET_ACCESS_KEY_67890';
    const diagWithLengths = {
      hasApplicationId: true,
      applicationIdLength: sensitiveAppId.length,
      hasAccessKey: true,
      accessKeyLength: sensitiveKey.length,
      applicationIdQuerySent: true,
      accessKeyHeaderSent: true,
      accessKeyQuerySent: true,
    };
    await logRakutenUpstreamError(
      makeRes('{}', 403),
      'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
      diagWithLengths,
    );
    const logStr = spy.mock.calls[0][0] as string;
    expect(logStr).not.toContain(sensitiveAppId);
    expect(logStr).not.toContain(sensitiveKey);
    const logged = JSON.parse(logStr);
    expect(logged.applicationIdLength).toBe(sensitiveAppId.length);
    expect(logged.accessKeyLength).toBe(sensitiveKey.length);
  });

  it('[L14] status 200 が渡されても例外にならず event フィールドが出力される', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logRakutenUpstreamError(
        makeRes('{"Items":[]}', 200),
        'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701',
        DIAG,
      ),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe('rakuten_api_upstream_error');
    expect(logged.upstreamStatus).toBe(200);
  });
});
