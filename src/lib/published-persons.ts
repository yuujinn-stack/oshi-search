// 公開反映済み人物のストレージ（Redis: persons:published ハッシュ）
// getAllPersonsMerged() から参照される。公開ページで使う唯一の追加データソース。
// 管理画面 /admin/people/import の「公開反映」ボタンからのみ書き込む。

import { cache } from 'react';
import { getRedis } from './redis';
import type { PersonWithConfig } from '@/types/person';

const HASH_KEY = 'persons:published';

// persons:published に保存するレコード（PersonWithConfig + publishedAt）
export interface PublishedRecord extends PersonWithConfig {
  publishedAt: number;
}

// ── Raw fetch（キャッシュなし）────────────────────────────────────────────────
export async function getAllPublishedPersonsRaw(): Promise<PublishedRecord[]> {
  const redis = getRedis();
  if (!redis) {
    console.error('[published-persons] getRedis() returned null — check UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
    return [];
  }
  try {
    const raw = await redis.hgetall(HASH_KEY);
    console.log(`[published-persons] hgetall(${HASH_KEY}) keys=${raw ? Object.keys(raw).length : 'null'}`);
    if (!raw) return [];
    const records = Object.values(raw)
      .map((v) => {
        // Upstash SDK auto-deserializes JSON values from hgetall → v is already an object
        if (v && typeof v === 'object') return v as PublishedRecord;
        // Fallback: if somehow still a string, parse manually
        if (typeof v === 'string') {
          try { return JSON.parse(v) as PublishedRecord; } catch { return null; }
        }
        return null;
      })
      .filter((p): p is PublishedRecord => p !== null);
    console.log(`[published-persons] parsed ${records.length} records: ${records.map((r) => r.name).join(', ')}`);
    return records;
  } catch (err) {
    console.error('[published-persons] hgetall failed:', err);
    return [];
  }
}

// ── リクエスト内メモ化版（公開ページから呼ぶ）─────────────────────────────
// react の cache() でリクエスト内の重複 Redis 呼び出しを防ぐ。
// cross-request キャッシュは使わないため、常に最新データを返す。
export const getCachedPublishedPersons = cache(getAllPublishedPersonsRaw);

// ── 公開済み人物名の一覧（PersonList の表示判定用）─────────────────────────
export async function getPublishedPersonNames(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return await redis.hkeys(HASH_KEY);
  } catch {
    return [];
  }
}

// ── 書き込み ────────────────────────────────────────────────────────────────
export async function publishPersonsBatch(records: PublishedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const redis = getRedis();
  if (!redis) {
    throw new Error('[published-persons] Redis not available — cannot publishPersonsBatch');
  }
  const entries: Record<string, string> = {};
  for (const r of records) {
    entries[r.name] = JSON.stringify(r);
  }
  const result = await redis.hset(HASH_KEY, entries);
  console.log(`[published-persons] hset(${HASH_KEY}) wrote ${records.length} records, result=${result}`);
}

export async function unpublishPerson(name: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, name);
}
