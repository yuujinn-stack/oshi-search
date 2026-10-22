import { describe, it, expect, vi } from 'vitest';

// 管理画面 /admin/price-refresh を開く（GET の表示）だけでは DB・Redis に書き込まないこと。
// DB と Redis は偽物で、送られた SQL・コマンドを記録して確かめる（本番には接続しない）。
const rec = vi.hoisted(() => ({ sql: [] as string[], tx: 0, redis: [] as string[] }));
vi.mock('@/db/client', () => ({ neonSql: {}, db: {} }));
vi.mock('@/lib/redis', () => ({
  getRedis: () => new Proxy({}, {
    get: (_t, cmd: string) => async (...args: unknown[]) => {
      rec.redis.push(cmd);
      if (cmd === 'hlen') return 4;
      if (cmd === 'get') return null;
      void args;
      return null;
    },
  }),
}));
vi.mock('@/lib/price-refresh-runner', () => ({ REVIEW_INBOX_KEY: 'i', STATE_KEY: 's', REVIEW_INBOX_DROPPED_KEY: 'd', MAX_REVIEW_INBOX: 20000 }));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集'] }));
vi.mock('@/lib/price-refresh-status', () => ({
  NOT_UPDATED_REASON_LABEL: {},
  getNotUpdatedItems: vi.fn().mockResolvedValue([]),
  getPriceFreshnessByPerson: vi.fn().mockResolvedValue([]),
  getPriceRefreshRunStatus: vi.fn().mockResolvedValue({ redisAvailable: true, halt: null, running: false, lastRun: null, states: {} }),
}));
vi.mock('@/lib/price-freshness', () => ({ PRICE_FRESH_DAYS: 30 }));
vi.mock('@/components/admin/LogoutButton', () => ({ LogoutButton: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/price-review-store', async () => {
  const actual = await vi.importActual<typeof import('../price-review-store')>('../price-review-store');
  return {
    ...actual,
    neonReviewDb: () => ({
      query: async (text: string) => {
        rec.sql.push(text);
        if (/count\(\*\)/.test(text) && !/LATERAL/.test(text)) return [{ n: 1 }];
        if (/FROM price_review_logs/.test(text)) return [];
        return [{
          id: 1, person_name: '推しA', category: '写真集', item_id: 'ic-1', item_title: '写真集 A', previous_price: 10000, fetched_price: 14000,
          change_rate: 0.4, reason: 'price_change_30pct', fetched_at_ms: Date.now(), item_count: 1, current_price: 10000, price_json: true, same_identity: true, related: true,
        }];
      },
      transaction: async () => { rec.tx++; return []; },
    }),
  };
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PriceRefreshAdminPage from '../../app/admin/price-refresh/page';

describe('管理画面の表示（GET）は読み取りのみ', () => {
  it.each([[{}], [{ view: 'history' }], [{ rp: '2' }]])('%o：DB には SELECT だけ、Redis には読み取りのコマンドだけ', async (params) => {
    rec.sql.length = 0; rec.redis.length = 0; rec.tx = 0;
    const el = await PriceRefreshAdminPage({ searchParams: Promise.resolve(params) });
    const html = renderToStaticMarkup(el as ReturnType<typeof createElement>);
    expect(rec.tx).toBe(0);
    expect(rec.sql.length).toBeGreaterThan(0);
    for (const s of rec.sql) {
      expect(s.trim()).toMatch(/^SELECT/i);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    }
    expect(rec.redis.every((c) => ['hlen', 'get'].includes(c))).toBe(true);
    expect(html).toContain('取り込む');
    if (!('view' in params)) expect(html).toContain('写真集 A');
  });
});
