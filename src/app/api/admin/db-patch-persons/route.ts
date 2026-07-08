// DB persons テーブル補完 API
// Redis の imported:persons と persons:published を正本として DB に同期する。
// onConflictDoUpdate なので既存行を上書きする（published_at も含む）。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { persons } from '@/db/schema';
import { upsertPersonFromImport, publishPersonInDB } from '@/db/write';
import type { ImportedPerson } from '@/lib/imported-persons';
import type { PublishedRecord } from '@/lib/published-persons';

export const dynamic = 'force-dynamic';

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function loadRedisImportedPersons(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<ImportedPerson[]> {
  const raw = await redis.hgetall('imported:persons');
  if (!raw) return [];
  return Object.values(raw)
    .map((v) => {
      try {
        const p = parse<ImportedPerson>(v);
        if (!p.dataFetchStatus) p.dataFetchStatus = 'not_started';
        return p;
      } catch { return null; }
    })
    .filter((p): p is ImportedPerson => p !== null);
}

async function loadRedisPublishedPersons(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<Map<string, number>> {
  const raw = await redis.hgetall('persons:published');
  if (!raw) return new Map();
  const map = new Map<string, number>();
  for (const [name, v] of Object.entries(raw)) {
    try {
      const record = parse<PublishedRecord>(v);
      if (record.publishedAt) map.set(name, record.publishedAt);
    } catch { /* skip */ }
  }
  return map;
}

async function loadDBPersonNames(): Promise<Set<string>> {
  const rows = await db.select({ name: persons.name }).from(persons);
  return new Set(rows.map((r) => r.name));
}

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const [redisPersons, publishedMap, dbNames] = await Promise.all([
    loadRedisImportedPersons(redis),
    loadRedisPublishedPersons(redis),
    loadDBPersonNames(),
  ]);

  const missing = redisPersons.filter((p) => !dbNames.has(p.name)).map((p) => p.name).sort();

  return NextResponse.json({
    persons: {
      redisCount:      redisPersons.length,
      dbCount:         dbNames.size,
      publishedCount:  publishedMap.size,
      missingCount:    missing.length,
      missingNames:    missing.slice(0, 20),
    },
  });
}

// Production と Preview が同じ DB を共有している場合の誤実行を防ぐ
const SEED_BLOCKED_ENVS = ['production', 'preview'];

export async function POST() {
  if (SEED_BLOCKED_ENVS.includes(process.env.VERCEL_ENV ?? '')) {
    return NextResponse.json(
      { error: `VERCEL_ENV=${process.env.VERCEL_ENV} ではシードを実行できません。本番DBへの再投入を避けるためブロックしています。` },
      { status: 403 },
    );
  }
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const [redisPersons, publishedMap] = await Promise.all([
    loadRedisImportedPersons(redis),
    loadRedisPublishedPersons(redis),
  ]);

  let upserted = 0;
  const errors: string[] = [];

  for (const p of redisPersons) {
    try {
      await upsertPersonFromImport({
        name:            p.name,
        group:           p.group ?? '',
        genre:           p.genre ?? '坂道',
        aliases:         p.aliases ?? [],
        tmdbPersonId:    p.tmdbPersonId,
        description:     p.description,
        importedAt:      p.importedAt,
        dataFetchStatus: p.dataFetchStatus ?? 'not_started',
      });
      upserted++;
    } catch (err) {
      errors.push(`${p.name}: ${String(err).slice(0, 80)}`);
    }
  }

  // published_at を反映
  let published = 0;
  for (const [name, publishedAt] of publishedMap.entries()) {
    try {
      await publishPersonInDB(name, publishedAt);
      published++;
    } catch (err) {
      errors.push(`published/${name}: ${String(err).slice(0, 80)}`);
    }
  }

  return NextResponse.json({
    ok:        errors.length === 0,
    upserted,
    published,
    errors,
  });
}
