import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { isSafeHttpUrl, isStorableRakutenLinkUrl } from '@/lib/track-product-url';
import { shouldRecordTracking } from '@/lib/tracking-env';

type TrackEvent =
  | { type: 'view'; entity: 'person' | 'group'; slug: string }
  | { type: 'product'; productId: string; slug: string; title?: string; category?: string; imageUrl?: string; affiliateUrl?: string }
  | { type: 'work'; workId: string; title?: string; personName?: string; workType?: string; posterUrl?: string }
  | { type: 'vod'; service: string };

export async function POST(req: NextRequest) {
  try {
    // Preview は本番と同じ Redis を使うため記録しない（本番・ローカルは従来どおり）
    if (!shouldRecordTracking()) return NextResponse.json({ ok: true, skipped: true });
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
        // affiliateUrl はトップ「人気商品」のリンク先になるため、楽天のドメインの http/https URL だけ保存する。
        // それ以外（楽天以外のホスト・javascript: 等）は保存せず、既存の値も上書きしない（クリック数は加算する）。
        // imageUrl も http/https 以外は保存しない。空・未指定は従来どおり空文字で保存する。
        if (body.title) {
          const meta: Record<string, string> = {
            title: body.title,
            personSlug: body.slug ?? '',
            category: body.category ?? '',
          };
          if (!body.imageUrl) meta.imageUrl = '';
          else if (isSafeHttpUrl(body.imageUrl)) meta.imageUrl = body.imageUrl;
          if (!body.affiliateUrl) meta.affiliateUrl = '';
          else if (isStorableRakutenLinkUrl(body.affiliateUrl)) meta.affiliateUrl = body.affiliateUrl;
          pipe.hset(`product:meta:${body.productId}`, meta);
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
