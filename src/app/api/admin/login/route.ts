import { NextRequest, NextResponse } from 'next/server';

// セッショントークンを生成（パスワード + シークレットからの決定論的な値）
// Edge ランタイム対応（Buffer 不使用）
export function computeSessionToken(password: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? 'oshi-admin-secret';
  return btoa(`${password}:${secret}`).replace(/=/g, '');
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD が設定されていません' }, { status: 500 });
  }

  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: 'パスワードが正しくありません' }, { status: 401 });
  }

  const token = computeSessionToken(adminPassword);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin-session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7日間
    path: '/',
  });
  return res;
}
