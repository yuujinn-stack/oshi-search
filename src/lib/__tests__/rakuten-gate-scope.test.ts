/**
 * 楽天APIの共通の使用権（src/lib/rakuten-api-gate.ts）を使う範囲。
 *  - 価格更新（withRakutenApiSession の中）から呼んだときだけ使用権を通して送り、2回目も 429 なら全経路共通の停止を記録する
 *  - それ以外（既存の商品の自動更新・管理画面）は従来どおり（使用権を使わない＝Redis のコマンドも増えない）
 *  - 停止中は楽天へ送らずに 429 と同じ扱い
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createFakeGateRedis, type FakeGateRedis } from './helpers/fake-gate-redis';

const holder = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock('@/lib/redis', () => ({ getRedis: () => holder.redis }));

type Rakuten = typeof import('@/lib/rakuten');
type Gate = typeof import('@/lib/rakuten-api-gate');
let rakuten: Rakuten;
let gate: Gate;
let redis: FakeGateRedis;

const okEmpty = () => new Response(JSON.stringify({ Items: [], count: 0, page: 1, pageCount: 0 }), { status: 200 });
const tooMany = () => new Response('{"error":"too_many_requests"}', { status: 429, headers: { 'retry-after': '0' } });

beforeAll(async () => {
  vi.stubEnv('RAKUTEN_APP_ID', 'test-app-id');
  vi.stubEnv('RAKUTEN_ACCESS_KEY', 'test-access-key');
  vi.stubEnv('RAKUTEN_AFFILIATE_ID', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://test.example.com');
  vi.resetModules();
  rakuten = await import('@/lib/rakuten');
  gate = await import('@/lib/rakuten-api-gate');
});

beforeEach(() => {
  redis = createFakeGateRedis();
  holder.redis = redis;
  gate.__resetRakutenApiGateForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

const session = <T>(fn: () => Promise<T>) =>
  gate.withRakutenApiSession({ label: 'price-search:test', maxWaitMs: 5_000, onUnavailable: 'local' }, fn);

describe('楽天APIの共通の使用権を使う範囲', () => {
  it('既存の経路（使用権の外）は従来どおり：使用権を取らず、Redis のコマンドも増えない', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => okEmpty());
    const res = await rakuten.getProductsByCategory('テスト', '', 'グッズ', {}, 'no-store');
    expect(['empty', 'ok']).toContain(res.status);
    expect(fetchSpy).toHaveBeenCalled();
    expect(redis.commands).toEqual([]);
  });

  it('価格更新（使用権の中）では使用権を通して送る（取得・返却）', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => okEmpty());
    const res = await session(() => rakuten.getProductsByCategory('テスト', '', 'グッズ', {}, 'no-store'));
    expect(['empty', 'ok']).toContain(res.status);
    expect(fetchSpy).toHaveBeenCalled();
    expect(redis.commands).toContain('acquire');
    expect(redis.commands).toContain('release');
  });

  it('使用権の中で2回目も 429 なら全経路共通の停止を記録し、以後は楽天へ送らずに 429 扱い', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => tooMany());
    const first = await session(() => rakuten.getProductsByCategory('テスト', '', 'グッズ', {}, 'no-store'));
    expect(first).toEqual({ status: 'upstream_error', httpStatus: 429 });
    expect([...redis.store.keys()]).toContain(gate.COOLDOWN_KEY);
    const sent = fetchSpy.mock.calls.length;
    expect(sent).toBe(2); // 1回目＋待ってから1回だけ再試行（無制限に再試行しない）

    const second = await session(() => rakuten.getProductsByCategory('テスト', '', 'CD', {}, 'no-store'));
    expect(second).toEqual({ status: 'upstream_error', httpStatus: 429 });
    expect(fetchSpy.mock.calls.length).toBe(sent); // 停止中は送らない
  });
});
