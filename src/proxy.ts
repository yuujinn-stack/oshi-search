import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, validateSecretStrength, checkCsrfOrigin, SESSION_COOKIE } from '@/lib/session';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPublicAdminPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname.startsWith('/api/admin/login');
}

async function validateAdminSession(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!validateSecretStrength(secret)) return false;

  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return false;

  const result = await verifySessionToken(cookie.value, secret);
  return result.valid;
}

export async function proxy(req: NextRequest) {
  try {
    const { pathname } = req.nextUrl;

    // Cron routes bypass this proxy entirely (CRON_SECRET auth in each handler)
    if (pathname.startsWith('/api/cron')) {
      return NextResponse.next();
    }

    // Login page/API: always accessible without session
    if (isPublicAdminPath(pathname)) {
      return NextResponse.next();
    }

    // ── Admin pages (/admin/*) ─────────────────────────────────────────────
    if (pathname.startsWith('/admin')) {
      const authed = await validateAdminSession(req);
      if (!authed) {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = '/admin/login';
        loginUrl.search = '';
        return NextResponse.redirect(loginUrl);
      }
      return NextResponse.next();
    }

    // ── Admin API (/api/admin/*) ───────────────────────────────────────────
    if (pathname.startsWith('/api/admin')) {
      // CSRF origin check on write methods
      if (WRITE_METHODS.has(req.method)) {
        const originOk = checkCsrfOrigin(
          req.headers.get('origin'),
          req.headers.get('host'),
        );
        if (!originOk) {
          return NextResponse.json({ error: '不正なOriginです' }, { status: 403 });
        }
      }

      const authed = await validateAdminSession(req);
      if (!authed) {
        return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
      }

      return NextResponse.next();
    }

    return NextResponse.next();
  } catch (err) {
    console.error('[proxy] error:', err instanceof Error ? err.message : 'unknown');
    const { pathname } = req.nextUrl;
    if (pathname.startsWith('/admin')) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/admin/login';
      return NextResponse.redirect(loginUrl);
    }
    if (pathname.startsWith('/api/admin')) {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
