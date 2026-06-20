// CSVインポートで登録した人物データの永続ストレージ（Upstash Redis）
// 管理画面 /admin/people/import からのみ書き込む
// getImportedPersonNames() を将来のバッチ処理（TMDb/VOD/楽天取得）で使う

import { getRedis } from './redis';
import type { Genre } from '@/types/person';

const HASH_KEY = 'imported:persons';

export type DataFetchStatus =
  | 'not_started'   // 未取得
  | 'queued'        // キュー待機中
  | 'processing'    // 取得中
  | 'completed'     // 取得完了
  | 'partial_error' // 一部失敗
  | 'failed';       // 全体失敗

export interface ImportedPerson {
  name: string;
  group: string;
  genre: Genre;
  aliases: string[];
  tmdbPersonId?: number;
  description?: string;
  status: 'imported';
  importedAt: number;
  // データ取得状態
  dataFetchStatus: DataFetchStatus;
  lastDataFetchedAt?: number;
  dataFetchErrorMessage?: string;
}

function deserialize(v: unknown): ImportedPerson | null {
  try {
    const record = (typeof v === 'string' ? JSON.parse(v) : v) as ImportedPerson;
    // 旧データの移行: dataFetchStatus がない場合はデフォルト設定
    if (!record.dataFetchStatus) record.dataFetchStatus = 'not_started';
    return record;
  } catch {
    return null;
  }
}

export async function getAllImportedPersons(): Promise<ImportedPerson[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return Object.values(raw)
      .map(deserialize)
      .filter((p): p is ImportedPerson => p !== null)
      .sort((a, b) => b.importedAt - a.importedAt);
  } catch {
    return [];
  }
}

// バッチ処理から呼ぶ: インポート済み人物の名前一覧
export async function getImportedPersonNames(): Promise<string[]> {
  const persons = await getAllImportedPersons();
  return persons.map((p) => p.name);
}

export async function saveImportedPersonsBatch(persons: ImportedPerson[]): Promise<void> {
  const redis = getRedis();
  if (!redis || persons.length === 0) return;
  const entries: Record<string, string> = {};
  for (const p of persons) {
    entries[p.name] = JSON.stringify(p);
  }
  await redis.hset(HASH_KEY, entries);
}

export async function updateImportedPersonStatus(
  name: string,
  dataFetchStatus: DataFetchStatus,
  errorMessage?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.hget(HASH_KEY, name);
  if (!raw) return;
  const person = deserialize(raw);
  if (!person) return;
  const updated: ImportedPerson = {
    ...person,
    dataFetchStatus,
    lastDataFetchedAt: dataFetchStatus !== 'not_started' && dataFetchStatus !== 'queued' && dataFetchStatus !== 'processing'
      ? Date.now()
      : person.lastDataFetchedAt,
    dataFetchErrorMessage: errorMessage ?? undefined,
  };
  await redis.hset(HASH_KEY, { [name]: JSON.stringify(updated) });
}

export async function deleteImportedPerson(name: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, name);
}
