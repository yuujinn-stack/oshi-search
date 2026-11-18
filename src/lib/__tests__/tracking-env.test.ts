import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldRecordTracking } from '../tracking-env';

describe('shouldRecordTracking', () => {
  test('Preview だけ記録しない（本番・ローカル・その他は従来どおり記録）', () => {
    expect(shouldRecordTracking('preview')).toBe(false);
    expect(shouldRecordTracking('production')).toBe(true);
    expect(shouldRecordTracking('development')).toBe(true);
    expect(shouldRecordTracking(undefined)).toBe(true);
  });
});

// ── /api/track・/api/search-track が Preview で Redis に書き込まないこと ─────────
const calls: string[] = [];
vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    const pipe = {
      incr: (k: string) => { calls.push(`incr ${k}`); return pipe; },
      hset: (k: string) => { calls.push(`hset ${k}`); return pipe; },
      exec: async () => [],
    };
    return {
      pipeline: () => pipe,
      incr: async (k: string) => { calls.push(`incr ${k}`); },
      hincrby: async (k: string) => { calls.push(`hincrby ${k}`); },
      hset: async (k: string) => { calls.push(`hset ${k}`); },
    };
  },
}));

async function postTo(path: 'track' | 'search-track', body: unknown) {
  const { POST } = path === 'track' ? await import('@/app/api/track/route') : await import('@/app/api/search-track/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest(`http://localhost/api/${path}`, { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

const EVENTS = [
  { type: 'product', productId: 'bk-1', slug: '梅澤美波', title: 't', category: '写真集', imageUrl: '', affiliateUrl: 'https://books.rakuten.co.jp/rb/1/' },
  { type: 'view', entity: 'person', slug: '梅澤美波' },
  { type: 'work', workId: 'tmdb-movie-1', title: 't' },
  { type: 'vod', service: 'netflix' },
];

describe('Preview では計測を記録しない', () => {
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { vi.unstubAllEnvs(); });

  test.each(EVENTS)('VERCEL_ENV=preview: /api/track は Redis に書き込まず 200 を返す（%o）', async (ev) => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const r = await postTo('track', ev);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, skipped: true });
    expect(calls).toEqual([]);
  });

  test('VERCEL_ENV=preview: /api/search-track も書き込まない', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const r = await postTo('search-track', { keyword: 'Snow Man' });
    expect(r.status).toBe(200);
    expect(calls).toEqual([]);
  });

  test('VERCEL_ENV=production: 従来どおり記録する（商品クリック・メタデータ）', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const r = await postTo('track', EVENTS[0]);
    expect(r.json).toEqual({ ok: true });
    expect(calls).toEqual(['incr product:click:bk-1', 'incr person:productClicks:梅澤美波', 'hset product:meta:bk-1']);
  });

  test('VERCEL_ENV=production: 閲覧数・作品・VOD・検索も従来どおり記録する', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    for (const ev of EVENTS.slice(1)) await postTo('track', ev);
    await postTo('search-track', { keyword: 'Snow Man' });
    expect(calls).toEqual([
      'hincrby person:view:梅澤美波', 'hset person:view:梅澤美波',
      'incr work:click:tmdb-movie-1', 'hset work:meta:tmdb-movie-1',
      'incr vod:click:netflix',
      'hincrby search:ranking',
    ]);
  });

  test('VERCEL_ENV 未設定（ローカル）: 従来どおり記録する', async () => {
    vi.stubEnv('VERCEL_ENV', undefined as unknown as string);
    delete process.env.VERCEL_ENV;
    await postTo('track', EVENTS[0]);
    expect(calls[0]).toBe('incr product:click:bk-1');
  });
});
