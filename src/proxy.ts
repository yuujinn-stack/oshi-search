import { NextRequest, NextResponse } from 'next/server';

// セッショントークンの計算（login/route.ts と同じロジック）
function computeSessionToken(password: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? 'oshi-admin-secret';
  return btoa(`${password}:${secret}`).replace(/=/g, '');
}

// /admin 以下の認証保護
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /admin/** への全リクエストを認証チェック
  if (pathname.startsWith('/admin')) {
    // ログインページ自体は認証不要
    if (pathname === '/admin/login') return NextResponse.next();

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return new NextResponse('ADMIN_PASSWORD が設定されていません', { status: 503 });
    }

    const cookie = req.cookies.get('admin-session');
    const expected = computeSessionToken(adminPassword);

    if (!cookie || cookie.value !== expected) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/admin/login';
      return NextResponse.redirect(loginUrl);
    }
  }

  // /api/admin/** への認証チェック（login と logout を除く）
  if (
    pathname.startsWith('/api/admin') &&
    !pathname.startsWith('/api/admin/login') &&
    !pathname.startsWith('/api/admin/logout')
  ) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ error: 'ADMIN_PASSWORD が未設定です' }, { status: 503 });
    }

    const cookie = req.cookies.get('admin-session');
    const expected = computeSessionToken(adminPassword);

    if (!cookie || cookie.value !== expected) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
