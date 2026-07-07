// DB 読み取り関数（現フェーズはRedis/DB比較用のカウントのみ）
// 公開ページ・管理画面の読み取り元はまだ Redis のまま

import { db } from './client';
import { persons, personMeta, groupMeta, vodProviders, works, products, verdicts } from './schema';
import { sql } from 'drizzle-orm';

const first = (rows: { n: number }[]) => rows[0]?.n ?? 0;

export const countPersonsImported = () =>
  db.select({ n: sql<number>`count(*)::int` })
    .from(persons).where(sql`source = 'imported'`).then(first);

export const countPersonsPublished = () =>
  db.select({ n: sql<number>`count(*)::int` })
    .from(persons).where(sql`published_at IS NOT NULL`).then(first);

export const countPersonMeta = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(personMeta).then(first);

export const countGroupMeta = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(groupMeta).then(first);

export const countVodProviders = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(vodProviders).then(first);

export const countWorks = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(works).then(first);

export const countProducts = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(products).then(first);

export const countVerdicts = () =>
  db.select({ n: sql<number>`count(*)::int` }).from(verdicts).then(first);

export async function getWorksCountByPerson(): Promise<Map<string, number>> {
  const rows = await db
    .select({ personName: works.personName, n: sql<number>`count(*)::int` })
    .from(works)
    .groupBy(works.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}

export async function getProductsCountByPerson(): Promise<Map<string, number>> {
  const rows = await db
    .select({ personName: products.personName, n: sql<number>`count(*)::int` })
    .from(products)
    .groupBy(products.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}

export async function getVerdictsCountByPerson(): Promise<Map<string, number>> {
  const rows = await db
    .select({ personName: verdicts.personName, n: sql<number>`count(*)::int` })
    .from(verdicts)
    .groupBy(verdicts.personName);
  return new Map(rows.map((r) => [r.personName, r.n]));
}
