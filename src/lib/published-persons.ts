// 公開反映済み人物のストレージ（Neon DB）
// getAllPersonsMerged() から参照される。公開ページで使う唯一の追加データソース。
// 管理画面 /admin/people/import の「公開反映」ボタンからのみ書き込む。

import { cache } from 'react';
import { db } from '@/db/client';
import { persons as personsTable } from '@/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import type { PersonWithConfig, Genre, PersonConfig } from '@/types/person';
import { publishPersonInDB, unpublishPersonInDB } from '@/db/write';

// persons テーブルに保存するレコード（PersonWithConfig + publishedAt）
export interface PublishedRecord extends PersonWithConfig {
  publishedAt: number;
}

// ── Raw fetch（キャッシュなし）────────────────────────────────────────────────
export async function getAllPublishedPersonsRaw(): Promise<PublishedRecord[]> {
  try {
    const rows = await db.select().from(personsTable)
      .where(and(eq(personsTable.source, 'imported'), isNotNull(personsTable.publishedAt)));
    return rows.map((r) => ({
      name:        r.name,
      group:       r.groupName,
      genre:       r.genre as Genre,
      config:      (r.config ?? {}) as PersonConfig,
      publishedAt: r.publishedAt!.getTime(),
    }));
  } catch (err) {
    console.error('[db] getAllPublishedPersonsRaw failed:', String(err));
    return [];
  }
}

// ── リクエスト内メモ化版（公開ページから呼ぶ）─────────────────────────────
// react の cache() でリクエスト内の重複 DB 呼び出しを防ぐ。
// cross-request キャッシュは使わないため、常に最新データを返す。
export const getCachedPublishedPersons = cache(getAllPublishedPersonsRaw);

// ── 公開済み人物名の一覧（PersonList の表示判定用）─────────────────────────
export async function getPublishedPersonNames(): Promise<string[]> {
  try {
    const rows = await db.select({ name: personsTable.name })
      .from(personsTable)
      .where(and(eq(personsTable.source, 'imported'), isNotNull(personsTable.publishedAt)));
    return rows.map((r) => r.name);
  } catch (err) {
    console.error('[db] getPublishedPersonNames failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（管理画面 people/import で error/empty を区別するために使う）
export async function getPublishedPersonNamesOrThrow(): Promise<string[]> {
  const rows = await db.select({ name: personsTable.name })
    .from(personsTable)
    .where(and(eq(personsTable.source, 'imported'), isNotNull(personsTable.publishedAt)));
  return rows.map((r) => r.name);
}

// ── 書き込み ────────────────────────────────────────────────────────────────
export async function publishPersonsBatch(records: PublishedRecord[]): Promise<void> {
  if (records.length === 0) return;
  for (const r of records) {
    await publishPersonInDB(r.name, r.publishedAt);
  }
}

export async function unpublishPerson(name: string): Promise<void> {
  await unpublishPersonInDB(name);
}
