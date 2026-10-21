import { describe, it, expect, vi, beforeEach } from 'vitest';

// 管理画面 /admin/price-refresh の読み取り（src/lib/price-refresh-status.ts）。DB・Redis へ書き込まないこと、表示用の集計と理由の目安。
const holder = vi.hoisted(() => ({ redis: null as unknown, sql: vi.fn(), stored: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: () => holder.redis }));
vi.mock('@/db/client', () => ({ neonSql: holder.sql, db: {} }));
vi.mock('@/lib/product-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/product-store')>('@/lib/product-store');
  return { ...actual, getAllStoredProducts: holder.stored };
});
vi.mock('@/lib/rakuten', () => ({ getProductsByCategory: vi.fn() }));

import { getNotUpdatedItems, getPriceRefreshRunStatus, notUpdatedReasonOf } from '@/lib/price-refresh-status';
import { HALT_KEY, LAST_RUN_KEY, LOCK_KEY, STATE_KEY } from '@/lib/price-refresh-runner';

const NOW = Date.UTC(2026, 9, 21);
const DAY = 86_400_000;

beforeEach(() => { holder.sql.mockReset(); holder.stored.mockReset(); });

describe('価格更新の状況（読み取りのみ）', () => {
  it('Redis からは読み取りのコマンドだけを使い、壊れた値は無視する', async () => {
    const calls: string[] = [];
    holder.redis = {
      get: vi.fn(async (k: string) => { calls.push(`get ${k}`); return k === HALT_KEY ? null : JSON.stringify({ startedAt: 1, finishedAt: 2, manualTest: true, status: 'ok', stoppedBy: 'all_done', persons: 1, completed: 1, updated: 10, lookedUp: 0, lookupApplied: 0, failedCategories: 0 }); }),
      exists: vi.fn(async (k: string) => { calls.push(`exists ${k}`); return 0; }),
      hgetall: vi.fn(async (k: string) => { calls.push(`hgetall ${k}`); return { 成田凌: JSON.stringify({ completedAt: 5, last: { at: 5, updated: 10, categories: 6, failedCategories: [], completed: true } }), 壊れた: '{' }; }),
      set: vi.fn(), hset: vi.fn(), del: vi.fn(), eval: vi.fn(),
    };
    const s = await getPriceRefreshRunStatus();
    expect(calls.sort()).toEqual([`exists ${LOCK_KEY}`, `get ${HALT_KEY}`, `get ${LAST_RUN_KEY}`, `hgetall ${STATE_KEY}`].sort());
    const r = holder.redis as Record<string, ReturnType<typeof vi.fn>>;
    for (const w of ['set', 'hset', 'del', 'eval']) expect(r[w]).not.toHaveBeenCalled();
    expect(s.halt).toBeNull();
    expect(s.running).toBe(false);
    expect(s.lastRun?.updated).toBe(10);
    expect(Object.keys(s.states)).toEqual(['成田凌']);
  });

  it('Redis が無ければ「利用できない」とだけ返す', async () => {
    holder.redis = null;
    expect(await getPriceRefreshRunStatus()).toMatchObject({ redisAvailable: false, states: {} });
  });

  it('理由の目安：楽天ブックス・商品コードあり＝コード指定可、商品ページURLだけ＝検索に出たときだけ、特定できない＝対象外', () => {
    expect(notUpdatedReasonOf({ itemUrl: 'https://books.rakuten.co.jp/rb/12345678/', affiliateUrl: '' })).toBe('lookup_possible');
    expect(notUpdatedReasonOf({ itemUrl: 'https://item.rakuten.co.jp/shop-a/item-x/', affiliateUrl: '' })).toBe('search_only');
    expect(notUpdatedReasonOf({ itemUrl: 'https://item.rakuten.co.jp/shop-a/item-x/', affiliateUrl: '', itemCode: 'shop-a:10001' })).toBe('search_only');
    expect(notUpdatedReasonOf({ itemUrl: 'https://a.r10.to/xyz', affiliateUrl: 'https://a.r10.to/xyz' })).toBe('unidentifiable');
  });

  it('更新できていない商品：公開中（related）で、取得日時が古い・無い商品だけ（新しい商品・公開中でない商品は除く）', async () => {
    holder.stored.mockResolvedValue({
      '本・雑誌': { fetchedAt: 0, products: [
        { id: 'bk-1', title: '新しい', price: 1000, itemUrl: 'https://books.rakuten.co.jp/rb/1/', affiliateUrl: '', priceFetchedAt: NOW - DAY },
        { id: 'bk-2', title: '古い', price: 1200, itemUrl: 'https://books.rakuten.co.jp/rb/2/', affiliateUrl: '', priceFetchedAt: NOW - 60 * DAY },
        { id: 'bk-3', title: '不明', price: 1300, itemUrl: 'https://books.rakuten.co.jp/rb/3/', affiliateUrl: '' },
        { id: 'bk-4', title: '非公開', price: 1400, itemUrl: 'https://books.rakuten.co.jp/rb/4/', affiliateUrl: '' },
      ] },
    });
    holder.sql.mockResolvedValue([{ product_id: 'bk-1' }, { product_id: 'bk-2' }, { product_id: 'bk-3' }]);
    const items = await getNotUpdatedItems('成田凌', NOW);
    expect(items.map((i) => i.id)).toEqual(['bk-2', 'bk-3']);
    expect(items[0]).toMatchObject({ category: '本・雑誌', reason: 'lookup_possible', priceFetchedAt: NOW - 60 * DAY });
  });
});
