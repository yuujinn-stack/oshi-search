// 配信サービス（VOD）プロバイダーデータの永続ストレージ（Upstash Redis）
// 管理画面からのみ書き込み、ProviderLogo コンポーネントから読み取る

import { getRedis } from './redis';

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

export async function getAllProviders(): Promise<ProviderRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return Object.values(raw)
      .map((v) => {
        try {
          return (typeof v === 'string' ? JSON.parse(v) : v) as ProviderRecord;
        } catch {
          return null;
        }
      })
      .filter((p): p is ProviderRecord => p !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  } catch {
    return [];
  }
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
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(HASH_KEY, { [record.slug]: JSON.stringify(record) });
}

export async function deleteProvider(slug: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, slug);
}
