/**
 * Admin security integration tests.
 * Tests middleware auth gating, login rate limiting, logout route, and db-info info leakage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared constants ─────────────────────────────────────────────────────────

const VALID_SECRET = 'secure-admin-secret-32chars-here!';
const VALID_PASSWORD = 'correct-horse-battery-staple';
const BASE_URL = 'http://localhost:3000';

// ── Redis mock ───────────────────────────────────────────────────────────────

const redisMock = {
  get: vi.fn<() => Promise<number | null>>().mockResolvedValue(null),
  incr: vi.fn<() => Promise<number>>().mockResolvedValue(1),
  expire: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  del: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

vi.mock('@/lib/redis', () => ({
  getRedis: () => redisMock,
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

const mockExecute = vi.fn().mockResolvedValue([]);

vi.mock('@/db/client', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequest(path: string, options: Record<string, any> = {}): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(`${BASE_URL}${path}`, options as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequestWithCookie(path: string, cookieValue: string, options: Record<string, any> = {}): NextRequest {
  const existingHeaders = (options.headers ?? {}) as Record<string, string>;
  return new NextRequest(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...existingHeaders,
      Cookie: `admin-session=${cookieValue}`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

async function createValidToken(): Promise<string> {
  const { createSessionToken } = await import('@/lib/session');
  return createSessionToken(VALID_SECRET);
}

// ── Middleware tests ─────────────────────────────────────────────────────────

describe('middleware — 未認証リクエスト', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('未ログインで /admin にアクセス → /admin/login にリダイレクト', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/admin');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/login');
  });

  it('未ログインで /admin/people/import → /admin/login にリダイレクト', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/admin/people/import');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/login');
  });

  it('未ログインで /api/admin/db-info → 401 JSON', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/api/admin/db-info');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('未ログインで危険な POST → 401', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/api/admin/csv-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Host: 'localhost:3000' },
    });
    const res = await middleware(req);
    // CSRF check passes (origin matches host), but auth fails → 401
    expect(res.status).toBe(401);
  });
});

describe('middleware — 認証済みリクエスト', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('有効なCookieで /admin/people/import → 通過 (200系)', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = makeRequestWithCookie('/admin/people/import', token);
    const res = await middleware(req);
    // Middleware passes → NextResponse.next() — status will be 200 (no body)
    expect([200, 304]).toContain(res.status);
  });

  it('有効なCookieで /api/admin/db-info → 通過 (middleware は 401 を返さない)', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = makeRequestWithCookie('/api/admin/db-info', token);
    const res = await middleware(req);
    expect(res.status).not.toBe(401);
  });

  it('改ざんしたCookieは拒否される', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const tampered = token.slice(0, -4) + 'dead';
    const req = makeRequestWithCookie('/admin/dashboard', tampered);
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/login');
  });

  it('期限切れCookieは拒否される', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    // Advance time 9 hours past expiry
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9 * 60 * 60 * 1000);
    const req = makeRequestWithCookie('/admin/dashboard', token);
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/login');
  });
});

describe('middleware — CSRF チェック', () => {
  beforeEach(() => { vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('不正Originからの管理API書き込みは403', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const req = new NextRequest(`${BASE_URL}/api/admin/csv-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.com',
        Host: 'localhost:3000',
      },
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('正常Originからの書き込みは認証チェックに進む (403 ではない)', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = new NextRequest(`${BASE_URL}/api/admin/csv-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL,
        Host: 'localhost:3000',
        Cookie: `admin-session=${token}`,
      },
    });
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });
});

describe('middleware — ADMIN_SESSION_SECRET 未設定', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('SECRET未設定時は全 /admin ルートが /admin/login にリダイレクト', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/admin/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });
});

describe('middleware — Cron API バイパス', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('/api/cron/* はmiddlewareをバイパスする (認証不要)', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
    const { proxy: middleware } = await import('@/proxy');
    const req = makeRequest('/api/cron/fetch-works');
    const res = await middleware(req);
    // Cron route passes through — not a 401 or redirect
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
  });
});

// ── Login API route tests ────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_PASSWORD', VALID_PASSWORD);
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
    redisMock.get.mockResolvedValue(null);
    redisMock.incr.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function callLogin(password: string, ip = '1.2.3.4') {
    const { POST } = await import('@/app/api/admin/login/route');
    const req = new NextRequest(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      body: JSON.stringify({ password }),
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
    });
    return POST(req);
  }

  it('正しいパスワードでログインすると200とCookieが返る', async () => {
    const res = await callLogin(VALID_PASSWORD);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const cookie = res.cookies.get('admin-session');
    expect(cookie?.value).toBeTruthy();
  });

  it('GETリクエストは405を返す', async () => {
    const { GET } = await import('@/app/api/admin/login/route');
    const res = await GET();
    expect(res.status).toBe(405);
  });

  it('間違ったパスワードは401を返す', async () => {
    const res = await callLogin('wrong-password');
    expect(res.status).toBe(401);
  });

  it('ADMIN_SESSION_SECRET未設定時はログインできない (500)', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    const res = await callLogin(VALID_PASSWORD);
    expect(res.status).toBe(500);
  });

  it('ADMIN_SESSION_SECRETが短すぎる場合はログインできない (500)', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', 'short');
    const res = await callLogin(VALID_PASSWORD);
    expect(res.status).toBe(500);
  });

  it('パスワード失敗が5回を超えると429が返る', async () => {
    redisMock.get.mockResolvedValue(5);
    const res = await callLogin('wrong');
    expect(res.status).toBe(429);
  });

  it('正常ログイン後に失敗回数がリセットされる (redis.del が呼ばれる)', async () => {
    await callLogin(VALID_PASSWORD);
    expect(redisMock.del).toHaveBeenCalledOnce();
  });

  it('間違いパスワードでは redis.incr が呼ばれる', async () => {
    await callLogin('wrong');
    expect(redisMock.incr).toHaveBeenCalledOnce();
  });
});

// ── Logout API route tests ───────────────────────────────────────────────────

describe('GET/POST /api/admin/logout — ルートハンドラー単体', () => {
  beforeEach(() => { vi.resetModules(); });

  it('GETリクエストは405を返す', async () => {
    const { GET } = await import('@/app/api/admin/logout/route');
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('logoutレスポンスのSet-Cookieでadmin-sessionが期限切れになる', async () => {
    const { POST } = await import('@/app/api/admin/logout/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Node.js Headers combines multiple Set-Cookie with ', ' — still verifiable
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('admin-session=');
    // path=/ must be present (matches login's path)
    expect(setCookie.toLowerCase()).toContain('path=/');
    // Must use raw Max-Age=0 (not relying on cookie library's maxAge handling)
    expect(/max-age=0/i.test(setCookie)).toBe(true);
    // Must also set Expires to epoch as belt-and-suspenders
    expect(/expires=Thu,?\s*0?1 Jan 1970/i.test(setCookie)).toBe(true);
  });

  it('logoutレスポンスに X-Logout-Debug ヘッダーが含まれる', async () => {
    const { POST } = await import('@/app/api/admin/logout/route');
    const res = await POST();
    const debug = res.headers.get('x-logout-debug') ?? '';
    expect(debug).toContain('admin-session');
    expect(debug).toContain('path=/');
    // No token values in the debug header
    expect(debug).not.toMatch(/[0-9a-f]{32,}/);
  });

  it('path=/ と path=/api/admin の2つの Set-Cookie が含まれる', async () => {
    const { POST } = await import('@/app/api/admin/logout/route');
    const res = await POST();
    // Headers.getSetCookie() returns array of individual Set-Cookie headers
    // Fallback: count occurrences in combined header string
    const raw = res.headers.get('set-cookie') ?? '';
    // Both paths should appear
    expect(raw.toLowerCase()).toContain('path=/');
    expect(raw.toLowerCase()).toContain('path=/api/admin');
  });
});

describe('logout — proxyを通したCSRF・認証テスト', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('不正Originのlogoutは403', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = new NextRequest(`${BASE_URL}/api/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: `admin-session=${token}`,
        Origin: 'https://evil.com',
        Host: 'localhost:3000',
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('正常Preview Originのlogoutはproxyを通過する (403ではない)', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = new NextRequest(`https://oshi-search-abc.vercel.app/api/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: `admin-session=${token}`,
        Origin: 'https://oshi-search-abc.vercel.app',
        Host: 'oshi-search-abc.vercel.app',
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });

  it('正常Production Originのlogoutはproxyを通過する (403ではない)', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = new NextRequest(`https://www.mysite.com/api/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: `admin-session=${token}`,
        Origin: 'https://www.mysite.com',
        Host: 'www.mysite.com',
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });
});

describe('logout — ログアウト後は管理APIに入れない', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_SESSION_SECRET', VALID_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('ログイン後に有効Cookieで管理APIへアクセスできる', async () => {
    const { proxy: middleware } = await import('@/proxy');
    const token = await createValidToken();
    const req = makeRequestWithCookie('/api/admin/db-info', token);
    const res = await middleware(req);
    expect(res.status).not.toBe(401);
  });

  it('POST logout後にCookieなしで管理APIへアクセスすると401', async () => {
    const { proxy: middleware } = await import('@/proxy');
    // ブラウザはlogout後にCookieを削除する → 次のリクエストはCookieなし
    const req = makeRequest('/api/admin/db-info');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});

// ── db-info API route tests ──────────────────────────────────────────────────

describe('GET /api/admin/db-info — 情報漏洩チェック', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@host.neon.tech/mydb');
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('接続成功時は connected と vercelEnv のみ返す', async () => {
    mockExecute.mockResolvedValueOnce([{ '?column?': 1 }]);
    const { GET } = await import('@/app/api/admin/db-info/route');
    const res = await GET();
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.vercelEnv).toBe('production');
    // Must not contain DB internals
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('host.neon.tech');
    expect(raw).not.toContain('mydb');
    expect(raw).not.toContain('user');
    expect(raw).not.toContain('pass');
  });

  it('接続失敗時のエラーにホスト名・ユーザー名・DB名が含まれない', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection refused: host.neon.tech user=user db=mydb'));
    const { GET } = await import('@/app/api/admin/db-info/route');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(500);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('host.neon.tech');
    expect(raw).not.toContain('mydb');
    expect(raw).not.toContain('user=');
    // Should be a generic message
    expect(raw).toContain('データベース接続に失敗しました');
  });
});

// ── /api/debug-logout — 公開デバッグエンドポイント ──────────────────────────

describe('GET /api/debug-logout', () => {
  beforeEach(() => { vi.resetModules(); });

  it('admin-session Cookieがない場合 cookiePresent=false', async () => {
    const { GET } = await import('@/app/api/debug-logout/route');
    const req = new NextRequest(`${BASE_URL}/api/debug-logout`);
    const res = await GET(req);
    const body = await res.json();
    expect(body.cookiePresent).toBe(false);
    expect(body.cookieCount).toBe(0);
  });

  it('admin-session Cookieがある場合 cookiePresent=true', async () => {
    const { GET } = await import('@/app/api/debug-logout/route');
    const req = new NextRequest(`${BASE_URL}/api/debug-logout`, {
      headers: { Cookie: 'admin-session=sometoken' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(req);
    const body = await res.json();
    expect(body.cookiePresent).toBe(true);
    expect(body.cookieCount).toBe(1);
  });

  it('同名Cookieが複数ある場合 cookieCount=2 (path違いの残存Cookie検出)', async () => {
    const { GET } = await import('@/app/api/debug-logout/route');
    // Browsers send multiple cookies with same name (different paths) as one Cookie header
    const req = new NextRequest(`${BASE_URL}/api/debug-logout`, {
      headers: { Cookie: 'admin-session=token1; admin-session=token2' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(req);
    const body = await res.json();
    expect(body.cookieCount).toBe(2);
    expect(body.cookiePresent).toBe(true);
  });

  it('vercelEnv と nodeEnv を返す', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    const { GET } = await import('@/app/api/debug-logout/route');
    const req = new NextRequest(`${BASE_URL}/api/debug-logout`);
    const res = await GET(req);
    const body = await res.json();
    expect(body.vercelEnv).toBe('preview');
    expect(body.nodeEnv).toBe('production');
    vi.unstubAllEnvs();
  });

  it('cookiePresent は Cookie値を露出しない', async () => {
    const { GET } = await import('@/app/api/debug-logout/route');
    const req = new NextRequest(`${BASE_URL}/api/debug-logout`, {
      headers: { Cookie: 'admin-session=secret_token_value' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await GET(req);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('secret_token_value');
  });
});
