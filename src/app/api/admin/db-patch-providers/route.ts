// DB vod_providers テーブル補完 API
// Redis の vod:providers を正本として DB に同期する。
// onConflictDoUpdate なので既存行も更新する。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { vodProviders } from '@/db/schema';
import { upsertVodProvider } from '@/db/write';
import type { ProviderRecord } from '@/lib/provider-store';

export const dynamic = 'force-dynamic';

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function loadRedisProviders(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<ProviderRecord[]> {
  const raw = await redis.hgetall('vod:providers');
  if (!raw) return [];
  return Object.values(raw)
    .map((v) => { try { return parse<ProviderRecord>(v); } catch { return null; } })
    .filter((p): p is ProviderRecord => p !== null);
}

async function loadDBProviderSlugs(): Promise<Set<string>> {
  const rows = await db.select({ slug: vodProviders.slug }).from(vodProviders);
  return new Set(rows.map((r) => r.slug));
}

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const [redisProviders, dbSlugs] = await Promise.all([
    loadRedisProviders(redis),
    loadDBProviderSlugs(),
  ]);

  const missing = redisProviders.filter((p) => !dbSlugs.has(p.slug)).map((p) => p.slug).sort();

  return NextResponse.json({
    providers: {
      redisCount:   redisProviders.length,
      dbCount:      dbSlugs.size,
      missingCount: missing.length,
      missingSlugs: missing,
    },
  });
}

export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const redisProviders = await loadRedisProviders(redis);

  let upserted = 0;
  const errors: string[] = [];

  for (const p of redisProviders) {
    try {
      await upsertVodProvider({
        slug:      p.slug,
        name:      p.name,
        logoUrl:   p.logoUrl ?? '',
        isActive:  p.isActive ?? true,
        updatedAt: p.updatedAt,
      });
      upserted++;
    } catch (err) {
      errors.push(`${p.slug}: ${String(err).slice(0, 80)}`);
    }
  }

  return NextResponse.json({ ok: errors.length === 0, upserted, errors });
}
