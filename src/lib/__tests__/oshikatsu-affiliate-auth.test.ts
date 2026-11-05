// 推し活サービスのアフィリエイト管理画面・APIが管理者認証（src/proxy.ts）で守られていることを、
// proxy() を実際に呼んで確認する（DB・ネットワークは使わない）。
import { describe, test, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '@/proxy';
import { createSessionToken, SESSION_COOKIE } from '@/lib/session';

const SECRET = 'test-secret-for-oshikatsu-affiliate-auth-0123456789';
let validCookie = '';

beforeAll(async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET;
  validCookie = await createSessionToken(SECRET);
});

const API_PATHS = [
  ['GET', '/api/admin/oshikatsu-affiliates'],
  ['POST', '/api/admin/oshikatsu-affiliates'],
  ['PUT', '/api/admin/oshikatsu-affiliates/1'],
  ['POST', '/api/admin/oshikatsu-affiliates/1/creatives'],
  ['PUT', '/api/admin/oshikatsu-affiliates/creatives/1'],
  ['DELETE', '/api/admin/oshikatsu-affiliates/creatives/1'],
  ['POST', '/api/admin/db-init'],
] as const;

function req(method: string, path: string, opts: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: 'oshi-search.jp' };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(`https://oshi-search.jp${path}`, { method, headers });
}

describe('管理者認証', () => {
  test('proxy の対象に /admin と /api/admin の全パスが含まれる', () => {
    expect(config.matcher).toEqual(expect.arrayContaining(['/admin/:path*', '/api/admin/:path*']));
  });

  test.each(API_PATHS)('未ログインの %s %s は 401', async (method, path) => {
    const res = await proxy(req(method, path));
    expect(res.status).toBe(401);
  });

  test.each(API_PATHS)('偽のセッションでの %s %s は 401', async (method, path) => {
    const res = await proxy(req(method, path, { cookie: `${validCookie.slice(0, -4)}0000` }));
    expect(res.status).toBe(401);
  });

  test.each(API_PATHS.filter(([m]) => m !== 'GET'))('ログイン済みでも別サイトからの %s %s は 403（CSRF）', async (method, path) => {
    const res = await proxy(req(method, path, { cookie: validCookie, origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
  });

  test.each(API_PATHS)('ログイン済み・同じサイトからの %s %s は通す', async (method, path) => {
    const res = await proxy(req(method, path, { cookie: validCookie, origin: 'https://oshi-search.jp' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  test('未ログインで管理画面（推し活サービスタブ）を開くとログイン画面へ', async () => {
    const res = await proxy(req('GET', '/admin/affiliates?tab=oshikatsu'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/login');
    const ok = await proxy(req('GET', '/admin/affiliates?tab=oshikatsu', { cookie: validCookie }));
    expect(ok.headers.get('x-middleware-next')).toBe('1');
  });
});
