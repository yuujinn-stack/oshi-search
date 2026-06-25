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
