import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';

function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .replace(/[　\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { keyword?: string };
    if (!body.keyword) return NextResponse.json({ ok: false, reason: 'empty' });

    const normalized = normalizeKeyword(body.keyword);
    if (!normalized) return NextResponse.json({ ok: false, reason: 'empty_after_normalize' });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ ok: true, skipped: true });

    await redis.hincrby('search:ranking', normalized, 1);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
