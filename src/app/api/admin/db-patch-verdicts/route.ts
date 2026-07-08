// DB verdicts テーブル補完 API
// live Redis の verdicts:* を読み、DB に不足している行だけ追加する。
// onConflictDoNothing なので既存行は変更されない。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { verdicts } from '@/db/schema';
import { sql, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface JudgmentRecord {
  verdict: string;
  score: number;
  source: string;
  reason?: string;
  timestamp: number;
  promptVersion?: string;
}

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function scanVerdictKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: 'verdicts:*', count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys.sort();
}

async function getDBCountsByPerson(): Promise<Map<string, number>> {
  const rows = await db
    .select({ personName: verdicts.personName, n: sql<number>`count(*)::int` })
    .from(verdicts)
    .groupBy(verdicts.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}

// GET: ドライラン
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const keys = await scanVerdictKeys(redis);
  const personNames = keys.map((k) => k.replace(/^verdicts:/, ''));
  const dbCounts = await getDBCountsByPerson();

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
      if (redisN > dbN) totalMissing += redisN - dbN;
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

  const keys = await scanVerdictKeys(redis);
  const personNames = keys.map((k) => k.replace(/^verdicts:/, ''));
  const dbCounts = await getDBCountsByPerson();

  const pipe = redis.pipeline();
  for (const k of keys) pipe.hlen(k);
  const lens = (await pipe.exec()) as number[];

  // Redis > DB の人物だけ処理
  const diffKeys: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    if ((lens[i] ?? 0) > (dbCounts.get(personNames[i]) ?? 0)) {
      diffKeys.push(keys[i]);
    }
  }

  let totalInserted = 0;
  const insertLog: { personName: string; inserted: number }[] = [];

  for (const key of diffKeys) {
    const personName = key.replace(/^verdicts:/, '');
    const raw = await redis.hgetall(key);
    if (!raw) continue;

    const rows: (typeof verdicts.$inferInsert)[] = [];
    for (const [productId, v] of Object.entries(raw)) {
      try {
        const rec = parse<JudgmentRecord>(v);
        if (rec.verdict && rec.source) {
          rows.push({
            personName,
            productId,
            verdict:       rec.verdict,
            score:         String(rec.score ?? 0),
            source:        rec.source,
            reason:        rec.reason ?? null,
            promptVersion: rec.promptVersion ?? null,
            judgedAt:      rec.timestamp ? new Date(rec.timestamp) : new Date(),
            updatedAt:     new Date(),
          });
        }
      } catch { /* skip broken */ }
    }
    if (rows.length === 0) continue;

    const beforeN = dbCounts.get(personName) ?? 0;
    const CHUNK = 300;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(verdicts).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
    }

    const afterRows = await db.select({ n: sql<number>`count(*)::int` })
      .from(verdicts).where(eq(verdicts.personName, personName));
    const inserted = Math.max(0, (afterRows[0]?.n ?? 0) - beforeN);
    totalInserted += inserted;
    insertLog.push({ personName, inserted });
    console.log(`[db-patch-verdicts] ${personName}: +${inserted}件`);
  }

  return NextResponse.json({ processed: diffKeys.length, totalInserted, insertLog });
}
