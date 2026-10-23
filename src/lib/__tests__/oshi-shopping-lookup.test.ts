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

describe('一般商品のキャッシュ（本番は Redis に保存し、保存の完了を待つ）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const env = { ...process.env };
  const quiet = { log: () => {} };
  const memCache = () => {
    const m = new Map<string, unknown>();
    const sets: string[] = [];
    return {
      m, sets,
      cache: {
        getMany: async (codes: readonly string[]) => new Map(codes.filter((c) => m.has(c)).map((c) => [c, m.get(c) as never])),
        set: async (code: string, item: unknown) => { await new Promise((r) => setTimeout(r, 5)); m.set(code, item); sets.push(code); },
      },
    };
  };
  beforeEach(() => {
    __resetRakutenApiGateForTests();
    process.env.RAKUTEN_APP_ID = 'test-app-id-value';
    process.env.RAKUTEN_ACCESS_KEY = 'test-access-key-value';
    delete process.env.VERCEL;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('キャッシュにある商品（null＝販売終了等も含む）は API を呼ばない', async () => {
    const { m, cache } = memCache();
    m.set('a:1', { itemCode: 'a:1', itemName: 'x', price: 1, imageUrl: 'i', affiliateUrl: 'u', shopName: '', reviewCount: 0, fetchedAt: 1 });
    m.set('b:2', null);
    const r = await lookupGeneralItems(['a:1', 'b:2'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.items.get('a:1')?.itemName).toBe('x');
    expect(r.items.get('b:2')).toBeNull();
    expect(r.failed).toBe(0);
  });

  test('キャッシュに無い商品だけを取得し、結果（null を含む）を保存し終えてから返す。失敗した商品は保存しない', async () => {
    const { m, sets, cache } = memCache();
    m.set('a:1', null);
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('b:2') })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => null } });
    const r = await lookupGeneralItems(['a:1', 'b:2', 'c:3', 'd:4'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sets.sort()).toEqual(['b:2', 'c:3']); // 返る前に保存済み
    expect(m.get('c:3')).toBeNull();
    expect(m.has('d:4')).toBe(false);
    expect(r.failed).toBe(1);
  }, 15000);

  test('取得の途中で別の表示が保存した商品は API を呼ばない（キャッシュが空のときの同時アクセスでも呼び出しが重ならない）', async () => {
    const { m, cache } = memCache();
    fetchMock.mockImplementationOnce(async () => {
      // 1件目を取得している間に、別の表示が 2件目を取得・保存した
      m.set('b:2', { itemCode: 'b:2', itemName: '別の表示が保存', price: 900, imageUrl: 'i', affiliateUrl: 'u', shopName: '', reviewCount: 0, fetchedAt: 1 });
      return { ok: true, status: 200, json: async () => okItem('a:1') };
    });
    const r = await lookupGeneralItems(['a:1', 'b:2'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.items.get('b:2')?.itemName).toBe('別の表示が保存');
    expect(m.get('a:1')).toMatchObject({ itemCode: 'a:1', price: 1000 }); // 取得できた商品はすぐ保存
  });

  test('保存に失敗しても表示は続ける（診断全体はエラーにならない）', async () => {
    const cache = { getMany: async () => new Map(), set: async () => { throw new Error('redis write failed'); } };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('a:1') });
    const r = await lookupGeneralItems(['a:1'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(r.items.get('a:1')?.itemName).toBe('商品 a:1');
    expect(r.failed).toBe(0);
  });

  test('価格・商品コード・アフィリエイトURLは楽天の応答のまま（itemCode が違う応答は採用せず null）', async () => {
    const { m, cache } = memCache();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('a:1') })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('other:9') });
    const r = await lookupGeneralItems(['a:1', 'b:2'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(r.items.get('a:1')).toMatchObject({ itemCode: 'a:1', price: 1000, affiliateUrl: okItem('a:1').Items[0].Item.affiliateUrl });
    expect(r.items.get('b:2')).toBeNull();
    expect(m.get('b:2')).toBeNull();
  }, 15000);

  test('キャッシュを読めなくても API で取得して表示する', async () => {
    const cache = { getMany: async () => { throw new Error('redis down'); }, set: async () => {} };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => okItem('a:1') });
    const r = await lookupGeneralItems(['a:1'], { redis: createFakeGateRedis(), ...quiet }, cache);
    expect(r.items.get('a:1')?.itemName).toBe('商品 a:1');
  });

  test('打ち切った理由（429 等）をログに出す（認証情報は出さない）', async () => {
    const { cache } = memCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
    await lookupGeneralItems(['a:1', 'b:2'], { redis: createFakeGateRedis(), ...quiet }, cache);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('一般商品の取得を打ち切りました（理由: 429');
    expect(logged).not.toContain('test-access-key-value');
    expect(logged).not.toContain('test-app-id-value');
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
