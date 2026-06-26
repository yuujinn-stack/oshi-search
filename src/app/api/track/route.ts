import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';

type TrackEvent =
  | { type: 'view'; entity: 'person' | 'group'; slug: string }
  | { type: 'product'; productId: string; slug: string }
  | { type: 'work'; workId: string }
  | { type: 'vod'; service: string };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TrackEvent;
    const redis = getRedis();
    if (!redis) return NextResponse.json({ ok: true, skipped: true });

    switch (body.type) {
      case 'view': {
        const key = `${body.entity}:view:${body.slug}`;
        await Promise.all([
          redis.hincrby(key, 'count', 1),
          redis.hset(key, { lastViewedAt: Date.now() }),
        ]);
        break;
      }
      case 'product': {
        await Promise.all([
          redis.incr(`product:click:${body.productId}`),
          ...(body.slug ? [redis.incr(`person:productClicks:${body.slug}`)] : []),
        ]);
        break;
      }
      case 'work': {
        await redis.incr(`work:click:${body.workId}`);
        break;
      }
      case 'vod': {
        await redis.incr(`vod:click:${body.service}`);
        break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
