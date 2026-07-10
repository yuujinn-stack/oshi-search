import { getRedis } from '@/lib/redis';
import { isDbReadEnabled, isDbOnlyReadEnabled } from '@/lib/db-flag';
import { db } from '@/db/client';
import { personMeta as personMetaTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';
import type { ActivityStatus, CareerStatus } from '@/types/person';

export type { PersonMeta };

const META_KEY = 'admin:person-meta';

// DB行 → PersonMeta マッピング
function dbRowToPersonMeta(r: typeof personMetaTable.$inferSelect): PersonMeta {
  const meta: PersonMeta = {};
  if (r.activityStatus)   meta.activityStatus   = r.activityStatus as ActivityStatus;
  if (r.generation)       meta.generation       = r.generation;
  if (r.titles?.length)   meta.titles           = r.titles;
  if (r.currentGroupName) meta.currentGroupName = r.currentGroupName;
  if (r.joinedAt)         meta.joinedAt         = r.joinedAt;
  if (r.leftAt)           meta.leftAt           = r.leftAt;
  if (r.formerGroupNames?.length) meta.formerGroupNames = r.formerGroupNames;
  if (r.membershipNote)   meta.membershipNote   = r.membershipNote;
  if (r.primaryGenre)     meta.primaryGenre     = r.primaryGenre;
  if (r.genres?.length)   meta.genres           = r.genres;
  if (r.publicRoles?.length) meta.publicRoles   = r.publicRoles;
  if (r.awards?.length)   meta.awards           = r.awards;
  if (r.careerStatus)     meta.careerStatus     = r.careerStatus as CareerStatus;
  if (r.roleNote)         meta.roleNote         = r.roleNote;
  if (r.memo)             meta.memo             = r.memo;
  if (r.priority)         meta.priority         = r.priority as PersonPriority;
  meta.updatedAt = r.updatedAt.getTime();
  return meta;
}

export async function getAllPersonMetas(): Promise<Record<string, PersonMeta>> {
  if (isDbOnlyReadEnabled()) {
    try {
      const rows = await db.select().from(personMetaTable);
      const map: Record<string, PersonMeta> = {};
      for (const r of rows) map[r.personName] = dbRowToPersonMeta(r);
      return map;
    } catch (err) {
      console.error('[db-only] getAllPersonMetas DB error:', String(err));
      return {};
    }
  }
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(personMetaTable);
      const map: Record<string, PersonMeta> = {};
      for (const r of rows) map[r.personName] = dbRowToPersonMeta(r);
      return map;
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllPersonMetas:', String(err));
    }
  }
  try {
    const redis = getRedis();
    if (!redis) return {};
    const raw = await redis.hgetall(META_KEY);
    if (!raw) return {};
    const map: Record<string, PersonMeta> = {};
    for (const [k, v] of Object.entries(raw)) {
      try { map[k] = (typeof v === 'string' ? JSON.parse(v) : v) as PersonMeta; } catch { /* skip */ }
    }
    return map;
  } catch { return {}; }
}

// Redis エラー時に throw する版（検索・ジャンルページ等で error/empty を区別するために使う）
export async function getAllPersonMetasOrThrow(): Promise<Record<string, PersonMeta>> {
  if (isDbOnlyReadEnabled()) {
    // DB-only: エラー時は throw（Redis フォールバックなし）
    const rows = await db.select().from(personMetaTable);
    const map: Record<string, PersonMeta> = {};
    for (const r of rows) map[r.personName] = dbRowToPersonMeta(r);
    return map;
  }
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(personMetaTable);
      const map: Record<string, PersonMeta> = {};
      for (const r of rows) map[r.personName] = dbRowToPersonMeta(r);
      return map;
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllPersonMetasOrThrow:', String(err));
    }
  }
  const redis = getRedis();
  if (!redis) return {};
  const raw = await redis.hgetall(META_KEY); // エラー時は throw
  if (!raw) return {};
  const map: Record<string, PersonMeta> = {};
  for (const [k, v] of Object.entries(raw)) {
    try { map[k] = (typeof v === 'string' ? JSON.parse(v) : v) as PersonMeta; } catch { /* skip */ }
  }
  return map;
}

export async function getPersonMeta(name: string): Promise<PersonMeta | null> {
  if (isDbOnlyReadEnabled()) {
    try {
      const rows = await db.select().from(personMetaTable).where(eq(personMetaTable.personName, name));
      return rows.length > 0 ? dbRowToPersonMeta(rows[0]) : null;
    } catch (err) {
      console.error('[db-only] getPersonMeta DB error:', String(err));
      return null;
    }
  }
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(personMetaTable).where(eq(personMetaTable.personName, name));
      if (rows.length > 0) return dbRowToPersonMeta(rows[0]);
    } catch (err) {
      console.warn('[db-read] FALLBACK getPersonMeta:', String(err));
    }
  }
  try {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.hget<string>(META_KEY, name);
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as PersonMeta;
  } catch { return null; }
}
