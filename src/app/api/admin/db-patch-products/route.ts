// DB products テーブル補完 API
// live Redis の products:* を読み、DB に不足している行だけ追加する。
// onConflictDoNothing なので既存行は変更されない。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { products } from '@/db/schema';
import { sql, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface StoredCategoryData {
  products: unknown[];
  fetchedAt: number;
}

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function scanProductKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: 'products:*', count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys.sort();
}

async function getDBCountsForPersons(personNames: string[]): Promise<Map<string, number>> {
  if (personNames.length === 0) return new Map();
  const rows = await db
    .select({ personName: products.personName, n: sql<number>`count(*)::int` })
    .from(products)
    .groupBy(products.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}

// GET: ドライラン — 差分だけ返す
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const keys = await scanProductKeys(redis);
  const personNames = keys.map((k) => k.replace(/^products:/, ''));
  const dbCounts = await getDBCountsForPersons(personNames);

  const pipe = redis.pipeline();
  for (const k of keys) pipe.hlen(k);
  const lens = (await pipe.exec()) as number[];

  const diffs: { personName: string; redis: number; db: number }[] = [];
  let totalMissing = 0;

  for (let i = 0; i < keys.length; i++) {
    const personName = personNames[i];
    const redisN = lens[i] ?? 0;
    const dbN = dbCounts.get(personName) ?? 0;
    if (redisN !== dbN) {
      diffs.push({ personName, redis: redisN, db: dbN });
      totalMissing += redisN - dbN;
    }
  }

  return NextResponse.json({
    totalRedisPersons: keys.length,
    totalDBPersons: dbCounts.size,
    diffs,
    totalMissingRows: totalMissing,
  });
}

// POST: 実際に挿入
export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const keys = await scanProductKeys(redis);
  const personNames = keys.map((k) => k.replace(/^products:/, ''));
  const dbCounts = await getDBCountsForPersons(personNames);

  const pipe = redis.pipeline();
  for (const k of keys) pipe.hlen(k);
  const lens = (await pipe.exec()) as number[];

  // 差分がある人物だけ処理
  const diffPersons: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const personName = personNames[i];
    const redisN = lens[i] ?? 0;
    const dbN = dbCounts.get(personName) ?? 0;
    if (redisN !== dbN) diffPersons.push(keys[i]);
  }

  let totalInserted = 0;
  const insertLog: { personName: string; inserted: number }[] = [];

  for (const key of diffPersons) {
    const personName = key.replace(/^products:/, '');
    const raw = await redis.hgetall(key);
    if (!raw) continue;

    const rows: (typeof products.$inferInsert)[] = [];
    for (const [category, value] of Object.entries(raw)) {
      const cat = parse<StoredCategoryData>(value);
      rows.push({
        personName,
        category,
        fetchedAt: cat.fetchedAt ? new Date(cat.fetchedAt) : new Date(),
        items: cat.products ?? [],
      });
    }
    if (rows.length === 0) continue;

    await db.insert(products).values(rows).onConflictDoNothing();

    // 挿入後の件数を確認
    const after = await db.select({ n: sql<number>`count(*)::int` })
      .from(products).where(eq(products.personName, personName));
    const inserted = (after[0]?.n ?? 0) - (dbCounts.get(personName) ?? 0);
    totalInserted += Math.max(0, inserted);
    insertLog.push({ personName, inserted: Math.max(0, inserted) });

    console.log(`[db-patch-products] ${personName}: +${Math.max(0, inserted)}件`);
  }

  return NextResponse.json({
    processed: diffPersons.length,
    totalInserted,
    insertLog,
  });
}
