import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

// Auth is enforced by proxy — this handler only expires the session cookie.
// Must use the same name + path as login to guarantee the browser deletes the cookie.
// cookies.delete() omits path, so we use cookies.set() explicitly.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
