// DB person_meta / group_meta 補完 API
// Redis admin:person-meta と admin:groups を正本として、DBに不足している行を追加する。
// GET = ドライラン（差分確認のみ）, POST = 実際に挿入
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { personMeta, groupMeta } from '@/db/schema';
import { upsertPersonMeta, upsertGroupMeta } from '@/db/write';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { GroupMeta } from '@/types/group';

export const dynamic = 'force-dynamic';

function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

async function loadRedisPersonMeta(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<Map<string, PersonMeta>> {
  const raw = await redis.hgetall('admin:person-meta');
  if (!raw) return new Map();
  const map = new Map<string, PersonMeta>();
  for (const [k, v] of Object.entries(raw)) {
    try { map.set(k, parse<PersonMeta>(v)); } catch { /* skip */ }
  }
  return map;
}

async function loadRedisGroupMeta(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<Map<string, GroupMeta>> {
  const raw = await redis.hgetall('admin:groups');
  if (!raw) return new Map();
  const map = new Map<string, GroupMeta>();
  for (const [k, v] of Object.entries(raw)) {
    try { map.set(k, parse<GroupMeta>(v)); } catch { /* skip */ }
  }
  return map;
}

async function loadDBPersonNames(): Promise<Set<string>> {
  const rows = await db.select({ personName: personMeta.personName }).from(personMeta);
  return new Set(rows.map((r) => r.personName));
}

async function loadDBGroupNames(): Promise<Set<string>> {
  const rows = await db.select({ groupName: groupMeta.groupName }).from(groupMeta);
  return new Set(rows.map((r) => r.groupName));
}

// GET: ドライラン
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const [redisPersons, redisGroups, dbPersonNames, dbGroupNames] = await Promise.all([
    loadRedisPersonMeta(redis),
    loadRedisGroupMeta(redis),
    loadDBPersonNames(),
    loadDBGroupNames(),
  ]);

  const missingPersons = [...redisPersons.keys()].filter((k) => !dbPersonNames.has(k)).sort();
  const missingGroups  = [...redisGroups.keys()].filter((k) => !dbGroupNames.has(k)).sort();

  return NextResponse.json({
    personMeta: {
      redisCount: redisPersons.size,
      dbCount:    dbPersonNames.size,
      missing:    missingPersons,
    },
    groupMeta: {
      redisCount: redisGroups.size,
      dbCount:    dbGroupNames.size,
      missing:    missingGroups,
    },
  });
}

// POST: 不足レコードを DB に追加
export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  const [redisPersons, redisGroups, dbPersonNames, dbGroupNames] = await Promise.all([
    loadRedisPersonMeta(redis),
    loadRedisGroupMeta(redis),
    loadDBPersonNames(),
    loadDBGroupNames(),
  ]);

  const missingPersonNames = [...redisPersons.keys()].filter((k) => !dbPersonNames.has(k));
  const missingGroupNames  = [...redisGroups.keys()].filter((k) => !dbGroupNames.has(k));

  let insertedPersons = 0;
  const personErrors: string[] = [];
  for (const name of missingPersonNames) {
    const meta = redisPersons.get(name)!;
    try {
      await upsertPersonMeta(name, meta);
      insertedPersons++;
    } catch (err) {
      personErrors.push(`${name}: ${String(err)}`);
    }
  }

  let insertedGroups = 0;
  const groupErrors: string[] = [];
  for (const groupName of missingGroupNames) {
    const meta = redisGroups.get(groupName)!;
    try {
      await upsertGroupMeta(meta);
      insertedGroups++;
    } catch (err) {
      groupErrors.push(`${groupName}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    personMeta: { inserted: insertedPersons, errors: personErrors },
    groupMeta:  { inserted: insertedGroups,  errors: groupErrors  },
  });
}
