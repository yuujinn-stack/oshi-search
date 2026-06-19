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
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return Object.values(raw)
      .map((v) => {
        try { return JSON.parse(v as string) as PublishedRecord; } catch { return null; }
      })
      .filter((p): p is PublishedRecord => p !== null);
  } catch {
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
  const redis = getRedis();
  if (!redis || records.length === 0) return;
  const entries: Record<string, string> = {};
  for (const r of records) {
    entries[r.name] = JSON.stringify(r);
  }
  await redis.hset(HASH_KEY, entries);
}

export async function unpublishPerson(name: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, name);
}
