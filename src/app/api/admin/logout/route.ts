import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

// Auth is enforced by middleware — this handler only clears the cookie.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
