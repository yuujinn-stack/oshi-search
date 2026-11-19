// 作品画像表示設定の管理画面・APIが管理者認証（src/proxy.ts）で守られていることを、
// proxy() を実際に呼んで確認する（DB・ネットワークは使わない）。一般ユーザーは設定を変更できない。
import { describe, test, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { createSessionToken, SESSION_COOKIE } from '@/lib/session';

const SECRET = 'test-secret-for-work-image-display-auth-0123456789';
let validCookie = '';

beforeAll(async () => {
  process.env.ADMIN_SESSION_SECRET = SECRET;
  validCookie = await createSessionToken(SECRET);
});

function req(method: string, path: string, opts: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: 'oshi-search.jp' };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(`https://oshi-search.jp${path}`, { method, headers });
}

const API = '/api/admin/work-image-display';

describe('作品画像表示設定の管理者認証', () => {
  test.each(['GET', 'PUT'])('未ログインの %s は 401', async (method) => {
    expect((await proxy(req(method, API, { origin: 'https://oshi-search.jp' }))).status).toBe(401);
  });
  test('偽のセッションの PUT は 401', async () => {
    const res = await proxy(req('PUT', API, { cookie: `${validCookie.slice(0, -4)}0000`, origin: 'https://oshi-search.jp' }));
    expect(res.status).toBe(401);
  });
  test('ログイン済みでも別サイトからの PUT は 403（CSRF）', async () => {
    expect((await proxy(req('PUT', API, { cookie: validCookie, origin: 'https://evil.example.com' }))).status).toBe(403);
  });
  test('ログイン済み・同じサイトからの PUT は通す', async () => {
    const res = await proxy(req('PUT', API, { cookie: validCookie, origin: 'https://oshi-search.jp' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
  test('未ログインで設定画面を開くとログイン画面へ', async () => {
    const res = await proxy(req('GET', '/admin/work-image-display'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/login');
  });
});
