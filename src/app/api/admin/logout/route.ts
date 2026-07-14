import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

// Build a raw Set-Cookie string that expires the session cookie.
// We use raw string construction (not res.cookies.set) to avoid any potential
// issues with cookie-library falsy-check on maxAge=0 in the Vercel runtime.
function buildDeleteCookieHeader(path: string): string {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=`,
    `Path=${path}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Delete admin-session for both the current canonical path (/) and the legacy
// default path (/api/admin — RFC6265 default for cookies set at /api/admin/login).
// This handles any old cookies that may have been set without an explicit Path.
export async function POST() {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildDeleteCookieHeader('/'));
  headers.append('Set-Cookie', buildDeleteCookieHeader('/api/admin'));

  return new NextResponse(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
