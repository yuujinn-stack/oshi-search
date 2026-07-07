import { getRedis } from './redis';

export interface RedisHealth {
  ok: boolean;
  error?: string;
}

export async function pingRedis(): Promise<RedisHealth> {
  const redis = getRedis();
  if (!redis) {
    return { ok: false, error: 'Redis未接続 — 環境変数を確認してください' };
  }
  try {
    await redis.hlen('persons:published');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
