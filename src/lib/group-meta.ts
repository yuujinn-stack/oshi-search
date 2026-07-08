import { getRedis } from '@/lib/redis';
import { isDbReadEnabled } from '@/lib/db-flag';
import { db } from '@/db/client';
import { groupMeta as groupMetaTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { GroupMeta } from '@/types/group';
import type { GroupActivityStatus } from '@/types/group';
import { dbWrite, upsertGroupMeta } from '@/db/write';

const REDIS_KEY = 'admin:groups';

// DB行 → GroupMeta マッピング
function dbRowToGroupMeta(r: typeof groupMetaTable.$inferSelect): GroupMeta {
  return {
    groupName:      r.groupName,
    slug:           r.slug,
    activityStatus: r.activityStatus as GroupActivityStatus,
    formedAt:       r.formedAt ?? undefined,
    endedAt:        r.endedAt ?? undefined,
    renamedFrom:    r.renamedFrom ?? undefined,
    renamedTo:      r.renamedTo ?? undefined,
    formerNames:    r.formerNames?.length ? r.formerNames : undefined,
    officialSite:   r.officialSite ?? undefined,
    note:           r.note ?? undefined,
    createdAt:      r.createdAt.getTime(),
    updatedAt:      r.updatedAt.getTime(),
  };
}

export async function getAllGroupMetas(): Promise<GroupMeta[]> {
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(groupMetaTable);
      return rows.map(dbRowToGroupMeta).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllGroupMetas:', String(err));
    }
  }
  try {
    const redis = getRedis();
    if (!redis) return [];
    const raw = await redis.hgetall(REDIS_KEY);
    if (!raw) return [];
    const result: GroupMeta[] = [];
    for (const v of Object.values(raw)) {
      try {
        result.push((typeof v === 'string' ? JSON.parse(v) : v) as GroupMeta);
      } catch { /* skip */ }
    }
    return result.sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
  } catch { return []; }
}

// Redis エラー時に throw する版（グループページのリダイレクト判定で error/empty を区別するために使う）
// getAllGroupMetas が [] を返すと改名グループが 404 になるため OrThrow で区別する
export async function getAllGroupMetasOrThrow(): Promise<GroupMeta[]> {
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(groupMetaTable);
      return rows.map(dbRowToGroupMeta).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllGroupMetasOrThrow:', String(err));
    }
  }
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.hgetall(REDIS_KEY); // エラー時は throw
  if (!raw) return [];
  const result: GroupMeta[] = [];
  for (const v of Object.values(raw)) {
    try {
      result.push((typeof v === 'string' ? JSON.parse(v) : v) as GroupMeta);
    } catch { /* skip */ }
  }
  return result.sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
}

export async function getGroupMeta(groupName: string): Promise<GroupMeta | null> {
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(groupMetaTable).where(eq(groupMetaTable.groupName, groupName));
      if (rows.length > 0) return dbRowToGroupMeta(rows[0]);
    } catch (err) {
      console.warn('[db-read] FALLBACK getGroupMeta:', String(err));
    }
  }
  try {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.hget<string>(REDIS_KEY, groupName);
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as GroupMeta;
  } catch { return null; }
}

export async function saveGroupMeta(meta: GroupMeta): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis unavailable');
  meta.updatedAt = Date.now();
  await redis.hset(REDIS_KEY, { [meta.groupName]: JSON.stringify(meta) });
  dbWrite(`group-meta/${meta.groupName}`, () => upsertGroupMeta(meta));
}

export async function deleteGroupMeta(groupName: string): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis unavailable');
  await redis.hdel(REDIS_KEY, groupName);
}

export async function ensureGroupMeta(groupName: string): Promise<boolean> {
  if (!groupName.trim()) return false;
  try {
    const existing = await getGroupMeta(groupName.trim());
    if (existing) {
      // Redis に既存でも DB に未同期の可能性があるため upsert する
      dbWrite(`group-meta/${groupName}`, () => upsertGroupMeta(existing));
      return false;
    }
    await saveGroupMeta({
      groupName: groupName.trim(),
      slug: encodeURIComponent(groupName.trim()),
      activityStatus: 'active',
      note: '人物登録時に自動作成',
      createdAt: Date.now(),
    });
    return true;
  } catch { return false; }
}
