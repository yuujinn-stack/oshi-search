// CSVインポートで登録した人物データの永続ストレージ（Upstash Redis）
// 管理画面 /admin/people/import からのみ書き込む
// 将来のバッチ処理（TMDb/VOD/楽天取得）で getImportedPersonNames() を使う

import { getRedis } from './redis';
import type { Genre } from '@/types/person';

const HASH_KEY = 'imported:persons';

export interface ImportedPerson {
  name: string;
  group: string;
  genre: Genre;
  aliases: string[];
  tmdbPersonId?: number;
  description?: string;
  status: 'imported';
  importedAt: number;
}

export async function getAllImportedPersons(): Promise<ImportedPerson[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return [];
    return Object.values(raw)
      .map((v) => {
        try {
          return (typeof v === 'string' ? JSON.parse(v) : v) as ImportedPerson;
        } catch {
          return null;
        }
      })
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

export async function deleteImportedPerson(name: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(HASH_KEY, name);
}
