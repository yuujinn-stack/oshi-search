// DB works テーブル補完 API
// live Redis の works:* を読み、DB に不足している行だけ追加する。
// onConflictDoNothing なので既存行は変更されない。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { works } from '@/db/schema';
import { sql, eq } from 'drizzle-orm';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function scanWorkKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: 'works:*', count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys.sort();
}

async function getDBCountsByPerson(): Promise<Map<string, number>> {
  const rows = await db
    .select({ personName: works.personName, n: sql<number>`count(*)::int` })
    .from(works)
    .groupBy(works.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}

function workToRow(work: WorkRecord, fallbackPersonName: string): typeof works.$inferInsert {
  const aiData: Record<string, unknown> = {};
  if (work.aiDecision !== undefined)             aiData.aiDecision = work.aiDecision;
  if (work.aiSamePerson !== undefined)           aiData.aiSamePerson = work.aiSamePerson;
  if (work.aiReason !== undefined)               aiData.aiReason = work.aiReason;
  if (work.aiRelation !== undefined)             aiData.aiRelation = work.aiRelation;
  if (work.aiStatusRecommendation !== undefined) aiData.aiStatusRecommendation = work.aiStatusRecommendation;
  if (work.aiNeedsHumanReview !== undefined)     aiData.aiNeedsHumanReview = work.aiNeedsHumanReview;
  if (work.usedAi !== undefined)                 aiData.usedAi = work.usedAi;
  if (work.tmdbMatchedPersonId !== undefined)    aiData.tmdbMatchedPersonId = work.tmdbMatchedPersonId;
  if (work.tmdbMatchedPersonName !== undefined)  aiData.tmdbMatchedPersonName = work.tmdbMatchedPersonName;

  const vodData: Record<string, unknown> = {};
  if (work.vodProviders !== undefined)    vodData.vodProviders = work.vodProviders;
  if (work.vodUpdatedAt !== undefined)    vodData.vodUpdatedAt = work.vodUpdatedAt;
  if (work.vodAiCheckedAt !== undefined)  vodData.vodAiCheckedAt = work.vodAiCheckedAt;
  if (work.vodStatus !== undefined)       vodData.vodStatus = work.vodStatus;
  if (work.nextVodCheckAt !== undefined)  vodData.nextVodCheckAt = work.nextVodCheckAt;
  if (work.lastVodCheckAt !== undefined)  vodData.lastVodCheckAt = work.lastVodCheckAt;
  if (work.vodCheckSource !== undefined)  vodData.vodCheckSource = work.vodCheckSource;
  if (work.vodCheckStatus !== undefined)  vodData.vodCheckStatus = work.vodCheckStatus;
  if (work.vodCheckError !== undefined)   vodData.vodCheckError = work.vodCheckError;
  if (work.priorityRecheck !== undefined) vodData.priorityRecheck = work.priorityRecheck;

  return {
    id:              work.id,
    personName:      work.personName || fallbackPersonName,
    title:           work.title,
    originalTitle:   work.originalTitle ?? null,
    normalizedTitle: work.normalizedTitle ?? '',
    type:            work.type,
    tmdbId:          work.tmdbId ?? null,
    source:          work.source,
    releaseYear:     work.releaseYear ?? null,
    roleName:        work.roleName ?? null,
    overview:        work.overview ?? null,
    posterUrl:       work.posterUrl ?? null,
    confidenceScore: String(work.confidenceScore ?? 0),
    status:          work.status ?? 'needs_review',
    deleted:         work.deleted ?? false,
    deletedAt:       work.deletedAt ? new Date(work.deletedAt) : null,
    deletedBy:       work.deletedBy ?? null,
    checkedAt:       work.checkedAt ? new Date(work.checkedAt) : null,
    aiData,
    vodData,
    createdAt:       work.createdAt ? new Date(work.createdAt) : new Date(),
    updatedAt:       work.updatedAt ? new Date(work.updatedAt) : new Date(),
  };
}

// GET: ドライラン
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const keys = await scanWorkKeys(redis);
  const personNames = keys.map((k) => k.replace(/^works:/, ''));
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

  const keys = await scanWorkKeys(redis);
  const personNames = keys.map((k) => k.replace(/^works:/, ''));
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
    const personName = key.replace(/^works:/, '');
    const raw = await redis.hgetall(key);
    if (!raw) continue;

    const rows: (typeof works.$inferInsert)[] = [];
    for (const v of Object.values(raw)) {
      try {
        const work = parse<WorkRecord>(v);
        if (work.id && work.title && work.type && work.source) {
          rows.push(workToRow(work, personName));
        }
      } catch { /* skip broken */ }
    }
    if (rows.length === 0) continue;

    const beforeN = dbCounts.get(personName) ?? 0;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(works).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
    }

    const afterRows = await db.select({ n: sql<number>`count(*)::int` })
      .from(works).where(eq(works.personName, personName));
    const inserted = Math.max(0, (afterRows[0]?.n ?? 0) - beforeN);
    totalInserted += inserted;
    insertLog.push({ personName, inserted });
    console.log(`[db-patch-works] ${personName}: +${inserted}件`);
  }

  return NextResponse.json({ processed: diffKeys.length, totalInserted, insertLog });
}
