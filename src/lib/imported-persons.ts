// CSVインポートで登録した人物データの永続ストレージ（Neon DB）
// 管理画面 /admin/people/import からのみ書き込む
// getImportedPersonNames() を将来のバッチ処理（TMDb/VOD/楽天取得）で使う

import { db } from '@/db/client';
import { persons as personsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { Genre } from '@/types/person';
import { upsertPersonFromImport, updatePersonFetchStatusInDB, deleteImportedPersonInDB } from '@/db/write';

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

export async function getAllImportedPersons(): Promise<ImportedPerson[]> {
  try {
    const rows = await db.select().from(personsTable).where(eq(personsTable.source, 'imported'));
    return rows.map((r): ImportedPerson => ({
      name:                  r.name,
      group:                 r.groupName,
      genre:                 r.genre as Genre,
      aliases:               (r.aliases ?? []) as string[],
      tmdbPersonId:          r.tmdbPersonId ?? undefined,
      description:           r.description ?? undefined,
      status:                'imported',
      importedAt:            r.importedAt?.getTime() ?? r.createdAt.getTime(),
      dataFetchStatus:       r.dataFetchStatus as DataFetchStatus,
      lastDataFetchedAt:     r.lastDataFetchedAt ? r.lastDataFetchedAt.getTime() : undefined,
      dataFetchErrorMessage: r.dataFetchError ?? undefined,
    })).sort((a, b) => b.importedAt - a.importedAt);
  } catch (err) {
    console.error('[db] getAllImportedPersons failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（管理画面ページで error/empty を区別するために使う）
export async function getAllImportedPersonsOrThrow(): Promise<ImportedPerson[]> {
  const rows = await db.select().from(personsTable).where(eq(personsTable.source, 'imported'));
  return rows.map((r): ImportedPerson => ({
    name:                  r.name,
    group:                 r.groupName,
    genre:                 r.genre as Genre,
    aliases:               (r.aliases ?? []) as string[],
    tmdbPersonId:          r.tmdbPersonId ?? undefined,
    description:           r.description ?? undefined,
    status:                'imported',
    importedAt:            r.importedAt?.getTime() ?? r.createdAt.getTime(),
    dataFetchStatus:       r.dataFetchStatus as DataFetchStatus,
    lastDataFetchedAt:     r.lastDataFetchedAt ? r.lastDataFetchedAt.getTime() : undefined,
    dataFetchErrorMessage: r.dataFetchError ?? undefined,
  })).sort((a, b) => b.importedAt - a.importedAt);
}

// バッチ処理から呼ぶ: インポート済み人物の名前一覧
export async function getImportedPersonNames(): Promise<string[]> {
  const persons = await getAllImportedPersons();
  return persons.map((p) => p.name);
}

export async function saveImportedPersonsBatch(persons: ImportedPerson[]): Promise<void> {
  if (persons.length === 0) return;
  for (const p of persons) {
    await upsertPersonFromImport(p);
  }
}

export async function updateImportedPersonStatus(
  name: string,
  dataFetchStatus: DataFetchStatus,
  errorMessage?: string,
): Promise<void> {
  const lastDataFetchedAt = dataFetchStatus !== 'not_started' && dataFetchStatus !== 'queued' && dataFetchStatus !== 'processing'
    ? new Date()
    : undefined;
  await updatePersonFetchStatusInDB(name, dataFetchStatus, errorMessage, lastDataFetchedAt);
}

export async function deleteImportedPerson(name: string): Promise<void> {
  await deleteImportedPersonInDB(name);
}
