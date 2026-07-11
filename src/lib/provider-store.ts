// 配信サービス（VOD）プロバイダーデータの永続ストレージ（Upstash Redis）
// 管理画面からのみ書き込み、ProviderLogo コンポーネントから読み取る

import { getRedis } from './redis';
import { isDbReadEnabled, isDbOnlyReadEnabled, isDbOnlyWriteEnabled } from './db-flag';
import { db } from '@/db/client';
import { vodProviders as vodProvidersTable } from '@/db/schema';
import { dbWrite, upsertVodProvider, deleteVodProviderInDB } from '@/db/write';

const HASH_KEY = 'vod:providers';

export interface ProviderRecord {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// DB行 → ProviderRecord マッピング（id は DB に存在しないため slug で代替）
function dbRowToProviderRecord(r: typeof vodProvidersTable.$inferSelect): ProviderRecord {
  return {
    id:        r.slug,
    name:      r.name,
    slug:      r.slug,
    logoUrl:   r.logoUrl,
    isActive:  r.isActive,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function redisParseProviders(raw: Record<string, unknown>): ProviderRecord[] {
  return Object.values(raw)
    .map((v) => {
      try { return (typeof v === 'string' ? JSON.parse(v) : v) as ProviderRecord; }
      catch { return null; }
    })
    .filter((p): p is ProviderRecord => p !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function getAllProviders(): Promise<ProviderRecord[]> {
  if (isDbOnlyReadEnabled()) {
    try {
      const rows = await db.select().from(vodProvidersTable);
      return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (err) {
      console.error('[db-only] getAllProviders DB error:', String(err));
      return [];
    }
  }
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(vodProvidersTable);
      return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllProviders:', String(err));
    }
  }
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return redisParseProviders(raw);
  } catch { return []; }
}

// Redis エラー時に throw する版（管理画面で error/empty を区別するために使う）
export async function getAllProvidersOrThrow(): Promise<ProviderRecord[]> {
  if (isDbOnlyReadEnabled()) {
    // DB-only: エラー時は throw（Redis フォールバックなし）
    const rows = await db.select().from(vodProvidersTable);
    return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
  }
  if (isDbReadEnabled()) {
    try {
      const rows = await db.select().from(vodProvidersTable);
      return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (err) {
      console.warn('[db-read] FALLBACK getAllProvidersOrThrow:', String(err));
    }
  }
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.hgetall(HASH_KEY); // エラー時は throw
  if (!raw) return [];
  return redisParseProviders(raw);
}

// アクティブなプロバイダーの slug → logoUrl マップを返す（/api/providers 用）
export async function getActiveProviderLogoMap(): Promise<Record<string, string>> {
  const providers = await getAllProviders();
  const map: Record<string, string> = {};
  for (const p of providers) {
    if (p.isActive && p.logoUrl) {
      map[p.slug] = p.logoUrl;
    }
  }
  return map;
}

export async function saveProvider(record: ProviderRecord): Promise<void> {
  if (isDbOnlyWriteEnabled()) {
    await upsertVodProvider(record);
    return;
  }
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(HASH_KEY, { [record.slug]: JSON.stringify(record) });
  dbWrite(`vod-providers/${record.slug}`, () => upsertVodProvider(record));
}

export async function deleteProvider(slug: string): Promise<void> {
  if (isDbOnlyWriteEnabled()) {
    await deleteVodProviderInDB(slug);
    return;
  }
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, slug);
}
