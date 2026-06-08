import { NextRequest, NextResponse } from 'next/server';

// Unicode 対応の base64 エンコード（日本語パスワードでも btoa() が throw しない）
// TextEncoder で UTF-8 バイト列に変換してから base64 化する
function computeSessionToken(password: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? 'oshi-admin-secret';
  const combined = `${password}:${secret}`;
  const bytes = new TextEncoder().encode(combined);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, '');
}

// /admin 以下の認証保護
export function proxy(req: NextRequest) {
  try {
    const { pathname } = req.nextUrl;

    // /admin/** への全リクエストを認証チェック
    if (pathname.startsWith('/admin')) {
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
  } catch (err) {
    // プロキシ例外をキャッチしてログに残し、ログインページへリダイレクト
    console.error('[proxy] unexpected error:', err);
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', '1');
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
