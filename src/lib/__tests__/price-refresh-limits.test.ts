import { describe, it, expect, vi } from 'vitest';
import { resolveRunLimits } from '../../../scripts/price-refresh/limits';

// 価格更新の1回の上限・最短更新間隔（scripts/price-refresh/limits.ts）と、処理する人物の順番（selectRunOrder）
vi.mock('@/db/client', () => ({ neonSql: Object.assign(vi.fn(), { query: vi.fn() }), db: {} }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/price-refresh', () => ({ refreshPersonPrices: vi.fn(), lookupPricesByCode: vi.fn(), selectLookupCandidates: vi.fn(), lookupCodeOf: () => null }));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'], listPersonsWithProducts: vi.fn(), productIdentityKey: () => '' }));
vi.mock('@/db/write', () => ({}));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: vi.fn() }));
vi.mock('@/lib/rakuten-api-gate', () => ({ rakutenApiCallCount: () => 0 }));

import { selectRunOrder } from '../price-refresh-runner';

const DAY = 24 * 60 * 60 * 1000;

describe('1回の上限と最短更新間隔', () => {
  it('既定：人物30人・楽天API 400回・カテゴリ200・最短更新間隔3日', () => {
    expect(resolveRunLimits({})).toEqual({ maxPersons: 30, maxApiCalls: 400, maxCategories: 200, minIntervalDays: 3, minIntervalMs: 3 * DAY, limited: false });
  });
  it('楽天APIの上限は 800 を超えない（それ以上はコードの変更が必要）', () => {
    expect(resolveRunLimits({ PRICE_REFRESH_MAX_API_CALLS: '3000' }).maxApiCalls).toBe(800);
    expect(resolveRunLimits({ PRICE_REFRESH_MAX_API_CALLS: '5' }).maxApiCalls).toBe(20);
    expect(resolveRunLimits({ PRICE_REFRESH_MAX_API_CALLS: 'abc' }).maxApiCalls).toBe(400);
  });
  it('少人数の通常実行（limited-full）：既定3人、最大10人・楽天API 400回', () => {
    expect(resolveRunLimits({ PRICE_REFRESH_LIMITED: '1' })).toMatchObject({ maxPersons: 3, maxApiCalls: 400, limited: true });
    expect(resolveRunLimits({ PRICE_REFRESH_LIMITED: '1', PRICE_REFRESH_MAX_PERSONS: '50', PRICE_REFRESH_MAX_API_CALLS: '800' })).toMatchObject({ maxPersons: 10, maxApiCalls: 400 });
    expect(resolveRunLimits({ PRICE_REFRESH_LIMITED: '1', PRICE_REFRESH_MAX_PERSONS: '10', PRICE_REFRESH_MAX_API_CALLS: '150' })).toMatchObject({ maxPersons: 10, maxApiCalls: 150 });
  });
  it('最短更新間隔は1〜14日', () => {
    expect(resolveRunLimits({ PRICE_REFRESH_MIN_INTERVAL_DAYS: '0' }).minIntervalDays).toBe(1);
    expect(resolveRunLimits({ PRICE_REFRESH_MIN_INTERVAL_DAYS: '30' }).minIntervalDays).toBe(14);
    expect(resolveRunLimits({ PRICE_REFRESH_MIN_INTERVAL_DAYS: '' }).minIntervalDays).toBe(3);
  });
});

describe('処理する人物と順番（実行と dry-run で同じ）', () => {
  const NOW = Date.UTC(2026, 9, 23);
  const states = {
    途中: { startedAt: NOW - 2 * DAY, nextCategory: 3 },
    完了4日前: { completedAt: NOW - 4 * DAY, startedAt: NOW - 4 * DAY - 1000 },
    完了2日前: { completedAt: NOW - 2 * DAY, startedAt: NOW - 2 * DAY - 1000 },
    完了10日前: { completedAt: NOW - 10 * DAY, startedAt: NOW - 10 * DAY - 1000 },
  };
  const names = ['未実行B', '完了4日前', '途中', '完了2日前', '未実行A', '完了10日前'];

  it('途中で止まった人物 → 未実行 → 完了が古い順。最短更新間隔（3日）より前に完了した人物は除く', () => {
    expect(selectRunOrder(names, states, NOW, 3 * DAY)).toEqual(['途中', '未実行A', '未実行B', '完了10日前', '完了4日前']);
  });
  it('最短更新間隔を1日にすると2日前に完了した人物も対象', () => {
    expect(selectRunOrder(names, states, NOW, DAY)).toContain('完了2日前');
  });
  it('人物を指定したら（manual-test）間隔に関係なく対象', () => {
    expect(selectRunOrder(names, states, NOW, 3 * DAY, new Set(['完了2日前']))).toEqual(['完了2日前']);
  });
});
