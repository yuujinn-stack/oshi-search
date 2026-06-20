// 人物単位の「重点配信確認」フラグを Redis で管理
// Redis hash key: vod:intensive:persons → field: personName, value: set timestamp

import { getRedis } from './redis';

const HASH_KEY = 'vod:intensive:persons';

export async function setPersonIntensive(personName: string, enabled: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (enabled) {
    await redis.hset(HASH_KEY, { [personName]: Date.now().toString() });
  } else {
    await redis.hdel(HASH_KEY, personName);
  }
}

export async function getIntensivePersonNames(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return Object.keys(raw);
  } catch {
    return [];
  }
}

export async function isPersonIntensive(personName: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const val = await redis.hget(HASH_KEY, personName);
    return val !== null;
  } catch {
    return false;
  }
}
