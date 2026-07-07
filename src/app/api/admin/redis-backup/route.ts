// Redis バックアップ API — 読み取り専用。書き込み・削除は一切行わない。
// 対象: imported:persons, persons:published, admin:person-meta,
//       vod:providers, vod:intensive:persons, products:*, works:*, verdicts:*
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys;
}

// 単一ハッシュキーを読んでエントリにする
async function readHash(redis: Redis, key: string): Promise<{
  key: string; type: 'hash'; count: number; data: Record<string, unknown>;
}> {
  const raw = await redis.hgetall(key);
  const data = (raw ?? {}) as Record<string, unknown>;
  return { key, type: 'hash', count: Object.keys(data).length, data };
}

// パターンでSCAN → 各キーをhgetall → まとめてエントリにする
async function readHashPattern(redis: Redis, pattern: string): Promise<{
  key: string; type: 'hash-collection'; keyCount: number; count: number;
  data: Record<string, Record<string, unknown>>;
}> {
  const matchedKeys = await scanKeys(redis, pattern);
  const data: Record<string, Record<string, unknown>> = {};
  for (const k of matchedKeys) {
    const raw = await redis.hgetall(k);
    data[k] = (raw ?? {}) as Record<string, unknown>;
  }
  const count = Object.values(data).reduce((s, v) => s + Object.keys(v).length, 0);
  return { key: pattern, type: 'hash-collection', keyCount: matchedKeys.length, count, data };
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: 'Redis未接続 — UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を確認してください' },
      { status: 503 },
    );
  }

  const exportedAt = new Date().toISOString();
  const entries: unknown[] = [];

  // ── 固定ハッシュキー ──────────────────────────────────────────────────────────
  const fixedKeys = [
    'imported:persons',
    'persons:published',
    'admin:person-meta',
    'vod:providers',
    'vod:intensive:persons',
  ];

  for (const key of fixedKeys) {
    try {
      entries.push(await readHash(redis, key));
    } catch (err) {
      return NextResponse.json(
        { error: `「${key}」の読み取りに失敗しました: ${String(err)}` },
        { status: 503 },
      );
    }
  }

  // ── パターンハッシュキー（人物別データ）────────────────────────────────────
  const patternKeys = ['products:*', 'works:*', 'verdicts:*'];

  for (const pattern of patternKeys) {
    try {
      entries.push(await readHashPattern(redis, pattern));
    } catch (err) {
      return NextResponse.json(
        { error: `「${pattern}」のスキャン/読み取りに失敗しました: ${String(err)}` },
        { status: 503 },
      );
    }
  }

  const totalRecords = entries.reduce((s: number, e) => s + ((e as { count: number }).count ?? 0), 0);

  return NextResponse.json(
    { exportedAt, totalRecords, entries },
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
