import { describe, it, expect, vi, beforeEach } from 'vitest';

// 価格の確認待ちの受け取り箱（Redis）と、管理画面の表示が読み取りのみであること。本番の DB・Redis には接続しない（偽物）。
const h = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock('@/lib/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/db/client', () => ({ neonSql: Object.assign(vi.fn().mockResolvedValue([]), { query: vi.fn().mockResolvedValue([]) }), db: {} }));
vi.mock('@/lib/price-refresh', () => ({ refreshPersonPrices: vi.fn(), lookupPricesByCode: vi.fn(), selectLookupCandidates: vi.fn(), lookupCodeOf: () => null }));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'], listPersonsWithProducts: vi.fn(), productIdentityKey: () => '' }));
vi.mock('@/db/write', () => ({}));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: vi.fn() }));
vi.mock('@/lib/rakuten-api-gate', () => ({ rakutenApiCallCount: () => 0 }));

import { createRedisStateStore, MAX_REVIEW_INBOX, REVIEW_INBOX_DROPPED_KEY, REVIEW_INBOX_KEY, reviewInboxField } from '../price-refresh-runner';

/** ハッシュとカウンタだけの Redis の偽物 */
function fakeRedis(initial: Record<string, string> = {}) {
  const hash: Record<string, string> = { ...initial };
  const counters: Record<string, number> = {};
  return {
    hash, counters,
    hlen: async () => Object.keys(hash).length,
    hmget: async (_k: string, ...fields: string[]) => Object.fromEntries(fields.map((f) => [f, hash[f] ?? null])),
    hset: async (_k: string, v: Record<string, string>) => { Object.assign(hash, v); return Object.keys(v).length; },
    incrby: async (k: string, n: number) => (counters[k] = (counters[k] ?? 0) + n),
  };
}
const review = (id: string, fetchedPrice = 2000) => ({ category: 'CD', id, previousPrice: 1000, fetchedPrice, changeRate: 1, reason: 'price_change_30pct' as const, fetchedAt: 1 });

describe('受け取り箱（価格更新が書く）', () => {
  beforeEach(() => { h.redis = null; });

  it('確認待ちを組ごとの項目として追加する（同じ組は上書き＝数は増えない）', async () => {
    const r = fakeRedis();
    h.redis = r;
    const store = createRedisStateStore()!;
    await store.addReviews!('推しA', [review('x'), review('y')]);
    await store.addReviews!('推しA', [review('x')]);
    expect(Object.keys(r.hash)).toEqual([reviewInboxField('推しA', review('x')), reviewInboxField('推しA', review('y'))]);
    expect(r.counters[REVIEW_INBOX_DROPPED_KEY]).toBeUndefined();
  });

  it(`上限（${MAX_REVIEW_INBOX}件）に達したら新しい組は追加せず、追加できなかった数を数える。既にある組の更新は続ける`, async () => {
    const full: Record<string, string> = {};
    for (let i = 0; i < MAX_REVIEW_INBOX - 1; i++) full[`f${i}`] = '{}';
    const existing = reviewInboxField('推しA', review('old'));
    full[existing] = JSON.stringify({ person: '推しA', ...review('old'), fetchedAt: 0 });
    const r = fakeRedis(full);
    h.redis = r;
    await createRedisStateStore()!.addReviews!('推しA', [review('old'), review('n1'), review('n2')]);
    expect(Object.keys(r.hash)).toHaveLength(MAX_REVIEW_INBOX);
    expect(JSON.parse(r.hash[existing]).fetchedAt).toBe(1); // 既にある組は新しい値に
    expect(r.counters[REVIEW_INBOX_DROPPED_KEY]).toBe(2);
    expect(REVIEW_INBOX_KEY).toBe('price-refresh:review-inbox');
  });

  it('空きがあれば一部だけ追加し、残りを数える', async () => {
    const full: Record<string, string> = {};
    for (let i = 0; i < MAX_REVIEW_INBOX - 1; i++) full[`f${i}`] = '{}';
    const r = fakeRedis(full);
    h.redis = r;
    await createRedisStateStore()!.addReviews!('推しA', [review('n1'), review('n2'), review('n3')]);
    expect(r.hash[reviewInboxField('推しA', review('n1'))]).toBeTruthy();
    expect(r.counters[REVIEW_INBOX_DROPPED_KEY]).toBe(2);
  });
});
