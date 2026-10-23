import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeGateRedis } from './helpers/fake-gate-redis';

vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import { COOLDOWN_KEY, LEASE_KEY, MIN_INTERVAL_MS, __resetRakutenApiGateForTests, type GateDeps, type GateRedis } from '../rakuten-api-gate';
import { lookupGeneralItems } from '../oshi-shopping/rakuten-lookup';
import { RAKUTEN_CREDIT_HTML } from '../rakuten-credit';

const okItem = (itemCode: string) => ({
  Items: [{ Item: {
    itemCode, itemName: `商品 ${itemCode}`, itemPrice: 1000, availability: 1, shopName: 's', reviewCount: 1,
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fs%2F1%2F',
    mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128' }],
  } }],
});

describe('lookupGeneralItems（推し活お買い物診断の一般商品）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const env = { ...process.env };
  const quiet = { log: () => {} };
  const deps = (redis: GateRedis | null, over: Partial<GateDeps> = {}): Partial<GateDeps> => ({ redis, ...quiet, ...over });

  beforeEach(() => {
    __resetRakutenApiGateForTests();
    process.env.RAKUTEN_APP_ID = 'test-app-id-value';
    process.env.RAKUTEN_ACCESS_KEY = 'test-access-key-value';
    process.env.RAKUTEN_AFFILIATE_ID = 'test-affiliate-id';
    delete process.env.VERCEL;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('取得できた商品は表示用データに、該当なしは null。終わったら使用権を返す', async () => {
    const redis = createFakeGateRedis();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('a:1') })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) });
    const r = await lookupGeneralItems(['a:1', 'b:2'], deps(redis));
    expect(r.items.get('a:1')?.itemName).toBe('商品 a:1');
    expect(r.items.get('b:2')).toBeNull();
    expect(r.failed).toBe(0);
    expect(redis.store.get(LEASE_KEY)?.v).toBe('released');
  }, 10000);

  test('同時に2つの表示（別インスタンス相当）が呼んでも、送信は全体で1.1秒以上空く', async () => {
    const redis = createFakeGateRedis();
    const sentAt: number[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      sentAt.push(Date.now());
      return { ok: true, status: 200, json: async () => okItem(new URL(url).searchParams.get('itemCode')!) };
    });
    // 診断は使用権を最大3秒しか待たないため、待ちきれない側は今回は表示しない（キャッシュもしない）
    const [a, b] = await Promise.all([lookupGeneralItems(['a:1'], deps(redis)), lookupGeneralItems(['b:1'], deps(redis))]);
    expect(a.failed + b.failed).toBe(0);
    sentAt.sort((x, y) => x - y);
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 10);
  }, 15000);

  test('自動更新などが使用権を持っている間は、3秒待って取れなければAPIを呼ばない', async () => {
    const redis = createFakeGateRedis();
    redis.store.set(LEASE_KEY, { v: 'cron:held', exp: Date.now() + 60_000 });
    const r = await lookupGeneralItems(['a:1', 'b:2'], deps(redis));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.failed).toBe(2);
  }, 10000);

  test('429 は再試行せず、全経路共通の停止を記録し、残りは呼ばない', async () => {
    const redis = createFakeGateRedis();
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
    const r = await lookupGeneralItems(['a:1', 'b:2', 'c:3'], deps(redis));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.failed).toBe(3);
    expect(redis.store.has(COOLDOWN_KEY)).toBe(true);
  });

  test('停止中（他の経路で429）は呼ばない', async () => {
    const redis = createFakeGateRedis();
    redis.store.set(COOLDOWN_KEY, { v: 'x', exp: Date.now() + 60_000 });
    const r = await lookupGeneralItems(['a:1'], deps(redis));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
  });

  test('認証エラー（403）を受けたら、この表示ではそれ以上呼ばない', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const r = await lookupGeneralItems(['a:1', 'b:2'], deps(createFakeGateRedis()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.failed).toBe(2);
  });

  test('Vercel 上で Redis が無い・つながらない場合は API を呼ばない', async () => {
    process.env.VERCEL = '1';
    expect((await lookupGeneralItems(['a:1'], deps(null))).failed).toBe(1);
    const down = createFakeGateRedis();
    down.down = true;
    expect((await lookupGeneralItems(['a:1'], deps(down))).failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('認証情報が無ければAPIを呼ばない（null をキャッシュしないよう失敗扱い）', async () => {
    delete process.env.RAKUTEN_ACCESS_KEY;
    const r = await lookupGeneralItems(['a:1', 'b:2'], deps(createFakeGateRedis()));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.failed).toBe(2);
  });

  test('ログに認証情報を出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await lookupGeneralItems(['a:1'], deps(createFakeGateRedis()));
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('test-app-id-value');
    expect(logged).not.toContain('test-access-key-value');
  });
});

describe('楽天ウェブサービスのクレジット', () => {
  test('規定のHTMLソース（テキスト形式）と完全に一致する（改変禁止）', () => {
    expect(RAKUTEN_CREDIT_HTML).toBe(
      '<!-- Rakuten Web Services Attribution Snippet FROM HERE -->\n' +
      '<a href="https://developers.rakuten.com/" target="_blank">Supported by Rakuten Developers</a>\n' +
      '<!-- Rakuten Web Services Attribution Snippet TO HERE -->',
    );
  });
});
