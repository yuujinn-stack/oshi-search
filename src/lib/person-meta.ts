import { getRedis } from '@/lib/redis';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';

export type { PersonMeta };

const META_KEY = 'admin:person-meta';

export async function getAllPersonMetas(): Promise<Record<string, PersonMeta>> {
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
  try {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.hget<string>(META_KEY, name);
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as PersonMeta;
  } catch { return null; }
}
