/**
 * src/lib/rakuten.ts のペーシング・429リトライ専用テスト（フェイクタイマー使用）
 *
 *  [11] リクエスト間隔が設けられる
 *  [12] 429で1回だけ待機・再試行する
 *  [13] 2回目も429なら停止する（無限リトライしない）
 *
 * lastRakutenRequestAt はモジュールスコープの可変状態のため、テスト間の干渉を防ぐ目的で
 * 各テストごとに vi.resetModules() してから importActual し直す。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Module = typeof import('@/lib/rakuten');

async function loadFreshModule(): Promise<Module> {
  vi.resetModules();
  return vi.importActual<Module>('@/lib/rakuten');
}

beforeEach(() => {
  vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
  vi.stubEnv('RAKUTEN_AFFILIATE_ID', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.example.com');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function okResponse() {
  return new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 });
}

function rateLimitedResponse() {
  return new Response(
    JSON.stringify({ statusCode: 429, message: 'Rate limit is exceeded. Try again in 1 seconds.' }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );
}

describe('rakuten.ts のペーシング・429リトライ', () => {
  // ── 11: リクエスト間隔が設けられる ───────────────────────────────────────────
  it('[11] 連続する楽天リクエストの間隔が300ms以上空く（同時実行数1）', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    const callTimestamps: number[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callTimestamps.push(Date.now());
      return okResponse();
    });

    // 写真集カテゴリは author検索・title検索・keyword補完検索で複数回楽天を呼ぶ
    const promise = getProductsByCategory('テスト', '', '写真集');
    await vi.runAllTimersAsync();
    await promise;

    expect(callTimestamps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < callTimestamps.length; i++) {
      expect(callTimestamps[i] - callTimestamps[i - 1]).toBeGreaterThanOrEqual(300);
    }
  });

  // ── 12: 429で1回だけ待機・再試行する ────────────────────────────────────────
  it('[12] 429を受けたら待機して1回だけ再試行し、2回目が成功すればokを返す', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return rateLimitedResponse();
      return new Response(
        JSON.stringify({ Items: [{ Item: { itemName: 'テスト商品', itemPrice: 1000, itemUrl: 'https://item.rakuten.co.jp/x/y/' } }], count: 1 }),
        { status: 200 },
      );
    });

    const promise = getProductsByCategory('テスト', '', 'グッズ');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(callCount).toBe(2); // 1回目(429) + 再試行1回
    expect(result.status).toBe('ok');
  });

  // ── 13: 2回目も429なら停止する（無限リトライしない） ─────────────────────────
  it('[13] 429が2回連続でも3回目は送信しない（無限リトライしない）', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      return rateLimitedResponse();
    });

    const promise = getProductsByCategory('テスト', '', 'グッズ');
    await vi.runAllTimersAsync();
    const result = await promise;

    // グッズカテゴリはキーワード1件・最大2ページだが、1ページ目が最終的に429確定した時点で
    // upstream_errorとしてthrowされ、2ページ目には進まない
    expect(callCount).toBe(2); // 1回目(429) + 再試行1回のみ。3回目は送信しない
    expect(result).toEqual({ status: 'upstream_error', httpStatus: 429 });
  });

  it('[13] 429時の待機は最低1秒（Retry-Afterも本文の秒数も無い場合）', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    const callTimestamps: number[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callTimestamps.push(Date.now());
      return rateLimitedResponse();
    });

    const promise = getProductsByCategory('テスト', '', 'グッズ');
    await vi.runAllTimersAsync();
    await promise;

    expect(callTimestamps.length).toBe(2);
    expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThanOrEqual(1000);
  });

  it('[12] Retry-Afterヘッダーがあればその秒数を優先する', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    const callTimestamps: number[] = [];
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callTimestamps.push(Date.now());
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ statusCode: 429 }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '3' },
        });
      }
      return okResponse();
    });

    const promise = getProductsByCategory('テスト', '', 'グッズ');
    await vi.runAllTimersAsync();
    await promise;

    expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThanOrEqual(3000);
  });

  it('秘密情報やレスポンス全文は待機ログに出さない（console.logは待機時間の数値のみ）', async () => {
    const { getProductsByCategory } = await loadFreshModule();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(global, 'fetch').mockImplementation(async () => rateLimitedResponse());

    const promise = getProductsByCategory('テスト', '', 'グッズ');
    await vi.runAllTimersAsync();
    await promise;

    const allLogs = logSpy.mock.calls.map((c) => String(c[0]));
    for (const line of allLogs) {
      expect(line).not.toContain('test-app-id');
      expect(line).not.toContain('test-access-key');
      expect(line).not.toContain('Rate limit is exceeded'); // レスポンス本文の文言をそのまま出さない
    }
  });
});
