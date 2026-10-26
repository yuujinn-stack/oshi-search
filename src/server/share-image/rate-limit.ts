// 共有画像の生成リクエストの IP ごとの上限（Upstash Redis・固定1分窓）。
// CDN で返る分は関数を起動しないため、関数まで届いた生成だけを数える。
// Redis が使えない・失敗した場合は制限しない（画像が出なくなることを避ける）。
// ※サブスク診断（src/server/oshi-vod/image-response.ts）は同じ方式の実装を個別に持つ。
import 'server-only';
import type { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';

export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

/** true＝上限超え。キーは `${prefix}:${ip}:${分}`（120秒で失効） */
export async function isOverRenderRateLimit(
  prefix: string,
  ip: string,
  limitPerMinute: number,
  store: RateLimitStore | null = getRedis(),
  now: number = Date.now(),
): Promise<boolean> {
  if (!store) return false;
  try {
    const key = `${prefix}:${ip}:${Math.floor(now / 60_000)}`;
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 120);
    return count > limitPerMinute;
  } catch {
    return false;
  }
}
