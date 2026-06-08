import { NextRequest, NextResponse } from 'next/server';

// Unicode 対応の base64 エンコード（proxy.ts と必ず同じロジックにすること）
export function computeSessionToken(password: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? 'oshi-admin-secret';
  const combined = `${password}:${secret}`;
  const bytes = new TextEncoder().encode(combined);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, '');
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
