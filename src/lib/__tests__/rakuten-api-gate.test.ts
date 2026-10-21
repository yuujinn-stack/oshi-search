import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeGateRedis } from './helpers/fake-gate-redis';

vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import {
  COOLDOWN_KEY,
  LEASE_KEY,
  LEASE_TTL_MS,
  MIN_INTERVAL_MS,
  RakutenApiBusyError,
  RakutenApiCooldownError,
  RakutenApiLeaseLostError,
  RakutenApiUnavailableError,
  __resetRakutenApiGateForTests,
  createRakutenApiSession,
  type GateDeps,
} from '../rakuten-api-gate';

const okRes = () => new Response('{}', { status: 200 });
const tooMany = (retryAfter?: string) => new Response('{}', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
const quiet = { log: () => {} };

beforeEach(() => __resetRakutenApiGateForTests());

describe('楽天APIの共通の呼び出し制御（rakuten-api-gate）', () => {
  test('既定の間隔は1.1秒、使用権の期限は60秒', () => {
    expect(MIN_INTERVAL_MS).toBe(1100);
    expect(LEASE_TTL_MS).toBe(60_000);
  });

  test('並列実行：5つのインスタンスが同時に4回ずつ呼んでも、送信は全体で間隔以上空く（重ならない）', async () => {
    const redis = createFakeGateRedis();
    const interval = 80; // テスト時間短縮のため間隔だけ縮める（仕組みは同じ）
    const sentAt: { t: number; who: number }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const instance = async (who: number) => {
      const s = createRakutenApiSession({ label: `i${who}`, maxWaitMs: 30_000, onUnavailable: 'skip' }, { redis, intervalMs: interval, ...quiet });
      try {
        for (let i = 0; i < 4; i++) {
          await s.call(async () => {
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            sentAt.push({ t: Date.now(), who });
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return okRes();
          });
        }
      } finally {
        await s.close();
      }
    };
    await Promise.all([0, 1, 2, 3, 4].map(instance));
    expect(sentAt).toHaveLength(20);
    expect(maxInFlight).toBe(1);
    const ts = sentAt.map((x) => x.t).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(interval - 5);
    // 1回の使用権で連続して呼ぶ（インスタンスごとに4回が連続する）
    const order = sentAt.sort((a, b) => a.t - b.t).map((x) => x.who);
    for (let i = 0; i < 20; i += 4) expect(new Set(order.slice(i, i + 4)).size).toBe(1);
  }, 20_000);

  test('実際の間隔（1.1秒）：2つのセッションが交互に取り合っても送信間隔は1.1秒以上', async () => {
    const redis = createFakeGateRedis();
    const sentAt: number[] = [];
    const one = async (label: string) => {
      const s = createRakutenApiSession({ label, maxWaitMs: 10_000, onUnavailable: 'skip' }, { redis, ...quiet });
      try { await s.call(async () => { sentAt.push(Date.now()); return okRes(); }); } finally { await s.close(); }
    };
    await Promise.all([one('a'), one('b'), one('c')]);
    sentAt.sort((a, b) => a - b);
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 10);
  }, 20_000);

  test('Redis のコマンド数：1回の使用権で30回呼んでも、取得1＋延長数回＋返却1', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const s = createRakutenApiSession({ label: 'cron', maxWaitMs: 1000, onUnavailable: 'local' }, deps);
    for (let i = 0; i < 30; i++) await s.call(async () => okRes()); // 1.1秒×30＝約33秒
    await s.close();
    expect(redis.commands.filter((c) => c === 'acquire')).toHaveLength(1);
    expect(redis.commands.filter((c) => c === 'release')).toHaveLength(1);
    expect(redis.commands.filter((c) => c === 'renew').length).toBeLessThanOrEqual(2);
  });

  test('返却直後は1.1秒間だれも取得できない（前の処理の最後の送信と間隔を空ける）', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const a = createRakutenApiSession({ label: 'a', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await a.call(async () => okRes());
    await a.close();
    expect(redis.store.get(LEASE_KEY)?.v).toBe('released');
    const b = createRakutenApiSession({ label: 'b', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await expect(b.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiBusyError);
    t += MIN_INTERVAL_MS;
    const c = createRakutenApiSession({ label: 'c', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await expect(c.call(async () => okRes())).resolves.toBeInstanceOf(Response);
  });

  test('処理失敗（返却せずに落ちた）：使用権は最長60秒で期限切れになり、次の処理が取得できる', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const crashed = createRakutenApiSession({ label: 'crashed', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await crashed.call(async () => okRes()); // close しない
    const next = createRakutenApiSession({ label: 'next', maxWaitMs: 5_000, onUnavailable: 'skip' }, deps);
    await expect(next.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiBusyError);
    t += LEASE_TTL_MS;
    const later = createRakutenApiSession({ label: 'later', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await expect(later.call(async () => okRes())).resolves.toBeInstanceOf(Response);
  });

  test('ロックの期限切れ：止まっていた処理は、期限切れ後に別の処理が取得していたら呼ばずに中止する', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const slow = createRakutenApiSession({ label: 'slow', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    const fetchSpy = vi.fn(async () => okRes());
    await slow.call(fetchSpy);
    t += LEASE_TTL_MS + 1; // 長時間止まった
    const other = createRakutenApiSession({ label: 'other', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await other.call(async () => okRes());
    await expect(slow.call(fetchSpy)).rejects.toBeInstanceOf(RakutenApiLeaseLostError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('延長の Redis エラー：見積もり上の期限まで余裕があれば続行、余裕が無ければ中止', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const s = createRakutenApiSession({ label: 's', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await s.call(async () => okRes());
    t += 40_000; // 残り20秒（延長が必要）
    redis.failNext = 1;
    await expect(s.call(async () => okRes())).resolves.toBeInstanceOf(Response); // 延長失敗だが余裕あり
    t += 18_000; // 残り約2秒
    redis.failNext = 1;
    await expect(s.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiLeaseLostError);
  });

  test('429：報告すると全経路共通で停止（Retry-After と60秒の大きい方）。報告したセッションも以後呼ばない', async () => {
    let t = 1_000_000;
    const redis = createFakeGateRedis(() => t);
    const deps: Partial<GateDeps> = { redis, now: () => t, sleep: async (ms) => { t += ms; }, ...quiet };
    const a = createRakutenApiSession({ label: 'a', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    const res = await a.call(async () => tooMany('120'));
    await a.reportRateLimited(res);
    await expect(a.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiCooldownError);
    await a.close();
    expect(redis.store.get(COOLDOWN_KEY)!.exp - t).toBe(120_000);
    t += MIN_INTERVAL_MS;
    const b = createRakutenApiSession({ label: 'b', maxWaitMs: 10_000, onUnavailable: 'skip' }, deps);
    await expect(b.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiCooldownError);
    t += 120_000;
    const c = createRakutenApiSession({ label: 'c', maxWaitMs: 0, onUnavailable: 'skip' }, deps);
    await expect(c.call(async () => okRes())).resolves.toBeInstanceOf(Response);
  });

  test('Redis 接続失敗：自動更新・管理画面（local）はプロセス内の間隔制御で続行、診断（skip）は呼ばない', async () => {
    const redis = createFakeGateRedis();
    redis.down = true;
    const fetchSpy = vi.fn(async () => okRes());
    const local = createRakutenApiSession({ label: 'cron', maxWaitMs: 1000, onUnavailable: 'local' }, { redis, intervalMs: 50, ...quiet });
    const t0 = Date.now();
    await local.call(fetchSpy);
    await local.call(fetchSpy);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    const skip = createRakutenApiSession({ label: 'diag', maxWaitMs: 1000, onUnavailable: 'skip' }, { redis, ...quiet });
    await expect(skip.call(fetchSpy)).rejects.toBeInstanceOf(RakutenApiUnavailableError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('Redis 未設定：local は同じプロセス内の全セッションを1本の列で間隔を空けて送る', async () => {
    const sentAt: number[] = [];
    const mk = (l: string) => createRakutenApiSession({ label: l, maxWaitMs: 0, onUnavailable: 'local' }, { redis: null, intervalMs: 60, ...quiet });
    const a = mk('a'); const b = mk('b');
    await Promise.all([
      a.call(async () => { sentAt.push(Date.now()); return okRes(); }),
      b.call(async () => { sentAt.push(Date.now()); return okRes(); }),
      a.call(async () => { sentAt.push(Date.now()); return okRes(); }),
    ]);
    sentAt.sort((x, y) => x - y);
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(55);
    const skip = createRakutenApiSession({ label: 'diag', maxWaitMs: 0, onUnavailable: 'skip' }, { redis: null, ...quiet });
    await expect(skip.call(async () => okRes())).rejects.toBeInstanceOf(RakutenApiUnavailableError);
  });

  test('使用中で待ちきれない場合は送らずに RakutenApiBusyError', async () => {
    const redis = createFakeGateRedis();
    const holder = createRakutenApiSession({ label: 'holder', maxWaitMs: 0, onUnavailable: 'skip' }, { redis, ...quiet });
    await holder.call(async () => okRes());
    const fetchSpy = vi.fn(async () => okRes());
    const waiter = createRakutenApiSession({ label: 'waiter', maxWaitMs: 600, onUnavailable: 'skip' }, { redis, ...quiet });
    await expect(waiter.call(fetchSpy)).rejects.toBeInstanceOf(RakutenApiBusyError);
    expect(fetchSpy).not.toHaveBeenCalled();
    await holder.close();
  });
});

describe('rakuten.ts とのつなぎ込み（価格更新の使用権の中）', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.doUnmock('@/lib/redis'); });

  test('別インスタンスの価格更新が同時に getProductsByCategory を実行しても、楽天APIへの送信は全体で1.1秒以上空く', async () => {
    vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
    vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
    const shared = createFakeGateRedis();
    const sentAt: number[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      sentAt.push(Date.now());
      return new Response(JSON.stringify({ Items: [], count: 0 }), { status: 200 });
    });
    const load = async () => {
      vi.resetModules();
      vi.doMock('@/lib/redis', () => ({ getRedis: () => shared }));
      const get = (await import('@/lib/rakuten')).getProductsByCategory;
      const { withRakutenApiSession } = await import('@/lib/rakuten-api-gate');
      return (name: string, group: string, category: Parameters<typeof get>[2]) =>
        withRakutenApiSession({ label: `price-search:${category}`, maxWaitMs: 10_000, onUnavailable: 'local' }, () => get(name, group, category));
    };
    const instanceA = await load();
    const instanceB = await load();
    expect(instanceA).not.toBe(instanceB);
    const [ra, rb] = await Promise.all([instanceA('テストA', '', 'グッズ'), instanceB('テストB', '', 'CD')]);
    expect(ra.status).toBe('empty');
    expect(rb.status).toBe('empty');
    expect(sentAt.length).toBeGreaterThanOrEqual(2); // 検索結果0件ならグッズ・CDとも1回ずつ
    sentAt.sort((a, b) => a - b);
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 10);
    expect(shared.store.get(LEASE_KEY)?.v).toBe('released');
  }, 30_000);
});
