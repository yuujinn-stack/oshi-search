// DBシャドーリード検証ユーティリティ
// Redis が正本のまま、DBのデータが一致しているかをサーバーログで検証する。
// ユーザー画面には一切影響しない。DB 失敗は console.warn に閉じ込めて無視する。

import {
  countProductsForPerson,
  countVerdictsForPerson,
  countPublishedWorksForPerson,
  hasPersonMetaInDB,
  countPersonMeta,
  countGroupMeta,
  countPersonsPublished,
} from '@/db/read';

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────

async function logDiff(label: string, redisN: number, dbPromise: Promise<number>): Promise<void> {
  try {
    const dbN = await dbPromise;
    if (redisN !== dbN) {
      console.warn(`[shadow-read] DIFF ${label}: redis=${redisN} db=${dbN} diff=${dbN - redisN}`);
    }
  } catch (err) {
    console.warn(`[shadow-read] DB_ERR ${label}: ${String(err)}`);
  }
}

// ── 人物ページ シャドーリード ─────────────────────────────────────────────────
// 対象: products(カテゴリ数) / verdicts / published_works / person_meta
// redis 値はページが Redis から読み取ったデータから算出して渡す。

export interface PersonPageRedisSnapshot {
  productCategories: number;  // Object.keys(storedData).length
  verdicts: number;           // Object.keys(verdicts).length
  publishedWorks: number;     // publishedWorks.length
  hasPersonMeta: boolean;     // personMeta !== null
}

export async function shadowReadPersonPage(
  personName: string,
  redis: PersonPageRedisSnapshot,
): Promise<void> {
  await Promise.allSettled([
    logDiff(`person/${personName}/products`, redis.productCategories, countProductsForPerson(personName)),
    logDiff(`person/${personName}/verdicts`, redis.verdicts, countVerdictsForPerson(personName)),
    logDiff(`person/${personName}/published_works`, redis.publishedWorks, countPublishedWorksForPerson(personName)),
    logDiff(`person/${personName}/person_meta`, redis.hasPersonMeta ? 1 : 0,
      hasPersonMetaInDB(personName).then((v) => v ? 1 : 0)),
  ]);
}

// ── グループページ シャドーリード ────────────────────────────────────────────
// 対象: group_meta / person_meta / published_persons

export interface GroupPageRedisSnapshot {
  groupMetaCount: number;       // allGroupMetas.length
  personMetaCount: number;      // Object.keys(personMetaMap).length
  publishedPersonCount: number; // getCachedPublishedPersons().length
}

export async function shadowReadGroupPage(redis: GroupPageRedisSnapshot): Promise<void> {
  await Promise.allSettled([
    logDiff('group/group_meta', redis.groupMetaCount, countGroupMeta()),
    logDiff('group/person_meta', redis.personMetaCount, countPersonMeta()),
    logDiff('group/published_persons', redis.publishedPersonCount, countPersonsPublished()),
  ]);
}

// ── 検索ページ シャドーリード ────────────────────────────────────────────────
// 対象: person_meta / group_meta

export interface SearchPageRedisSnapshot {
  personMetaCount: number;  // Object.keys(personMetaMap).length
  groupMetaCount: number;   // allGroupMetas.length
}

export async function shadowReadSearchPage(redis: SearchPageRedisSnapshot): Promise<void> {
  await Promise.allSettled([
    logDiff('search/person_meta', redis.personMetaCount, countPersonMeta()),
    logDiff('search/group_meta', redis.groupMetaCount, countGroupMeta()),
  ]);
}
