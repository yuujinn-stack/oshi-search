import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';

type TrackEvent =
  | { type: 'view'; entity: 'person' | 'group'; slug: string }
  | { type: 'product'; productId: string; slug: string; title?: string; category?: string; imageUrl?: string; affiliateUrl?: string }
  | { type: 'work'; workId: string; title?: string; personName?: string; workType?: string; posterUrl?: string }
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
        const pipe = redis.pipeline();
        pipe.incr(`product:click:${body.productId}`);
        if (body.slug) pipe.incr(`person:productClicks:${body.slug}`);
        // メタデータ保存（アナリティクス用・初回のみ上書き）
        if (body.title) {
          pipe.hset(`product:meta:${body.productId}`, {
            title: body.title,
            personSlug: body.slug ?? '',
            category: body.category ?? '',
            imageUrl: body.imageUrl ?? '',
            affiliateUrl: body.affiliateUrl ?? '',
          });
        }
        await pipe.exec();
        break;
      }
      case 'work': {
        const pipe = redis.pipeline();
        pipe.incr(`work:click:${body.workId}`);
        // メタデータ保存（アナリティクス用）
        if (body.title) {
          pipe.hset(`work:meta:${body.workId}`, {
            title: body.title,
            personName: body.personName ?? '',
            workType: body.workType ?? '',
            posterUrl: body.posterUrl ?? '',
          });
        }
        await pipe.exec();
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
