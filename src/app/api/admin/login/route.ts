import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, validateSecretStrength, SESSION_COOKIE } from '@/lib/session';
import { getRedis } from '@/lib/redis';

// Rate limit: 5 failures per 15 minutes per IP
const MAX_FAILURES = 5;
const WINDOW_SEC = 15 * 60;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  );
}

function rateLimitKey(ip: string): string {
  return `admin:login:fails:${ip}`;
}

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  // Reject immediately if secret is missing or too weak
  if (!validateSecretStrength(sessionSecret)) {
    console.error('[login] ADMIN_SESSION_SECRET is not set or too short (must be 32+ chars)');
    return NextResponse.json(
      { error: 'サーバー設定エラー。管理者に連絡してください。' },
      { status: 500 },
    );
  }

  if (!adminPassword) {
    console.error('[login] ADMIN_PASSWORD is not set');
    return NextResponse.json(
      { error: 'サーバー設定エラー。管理者に連絡してください。' },
      { status: 500 },
    );
  }

  const ip = getClientIp(req);
  const redis = getRedis();
  const key = rateLimitKey(ip);

  // Check rate limit
  if (redis) {
    try {
      const fails = await redis.get<number>(key);
      if (typeof fails === 'number' && fails >= MAX_FAILURES) {
        return NextResponse.json(
          { error: 'ログイン試行回数の上限に達しました。しばらく待ってから再試行してください。' },
          { status: 429 },
        );
      }
    } catch {
      // Redis failure: fail open (allow attempt) rather than locking out admin
    }
  }

  // Parse body
  let password: string | undefined;
  try {
    const body = await req.json();
    password = typeof body?.password === 'string' ? body.password : undefined;
  } catch {
    return NextResponse.json({ error: '不正なリクエスト形式です' }, { status: 400 });
  }

  // Validate password
  if (!password || password !== adminPassword) {
    if (redis) {
      try {
        const fails = await redis.incr(key);
        if (fails === 1) await redis.expire(key, WINDOW_SEC);
      } catch {
        // Redis failure: non-fatal
      }
    }
    return NextResponse.json({ error: 'パスワードが正しくありません' }, { status: 401 });
  }

  // Success: clear rate limit and issue token
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // Non-fatal
    }
  }

  const token = await createSessionToken(sessionSecret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60, // 8 hours
    path: '/',
  });
  return res;
}

// All other methods are not allowed
export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
