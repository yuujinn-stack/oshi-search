// Redis ↔ DB 整合性比較ユーティリティ
// API と管理画面ページから共有で使う

import { getRedis } from './redis';
import type { Redis } from '@upstash/redis';
import {
  countPersonsImported, countPersonsPublished,
  countPersonMeta, countGroupMeta, countVodProviders,
  countWorks, countProducts, countVerdicts,
  getWorksCountByPerson, getProductsCountByPerson, getVerdictsCountByPerson,
} from '@/db/read';

// ── 型定義 ──────────────────────────────────────────────────────────────────

export interface EntitySummary {
  label: string;
  redisKey: string;
  redisCount: number;
  dbCount: number;
  match: boolean;
  note?: string;
  /** パターンキーのみ: Redis 側のユニーク人物数 */
  personCount?: number;
  /** パターンキーのみ: DB 側のユニーク人物数 */
  dbPersonCount?: number;
}

export interface PersonDiscrepancy {
  personName: string;
  entity: 'works' | 'products' | 'verdicts';
  redisCount: number;
  dbCount: number;
  diff: number;
}

export interface CompareResult {
  generatedAt: string;
  durationMs: number;
  summary: EntitySummary[];
  personDiscrepancies: PersonDiscrepancy[];
  allMatch: boolean;
  redisOk: boolean;
  dbOk: boolean;
  error?: string;
}

// ── Redis ヘルパー ────────────────────────────────────────────────────────────

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    // count: 200 で db-patch-products と同じ hint に統一
    const [cur, batch] = await redis.scan(cursor, { match: pattern, count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys;
}

async function getCountsByPattern(
  redis: Redis,
  pattern: string,
  prefix: string,
): Promise<{ total: number; byPerson: Map<string, number> }> {
  const keys = await scanKeys(redis, pattern);
  if (keys.length === 0) return { total: 0, byPerson: new Map() };

  const pipe = redis.pipeline();
  for (const k of keys) pipe.hlen(k);
  const results = (await pipe.exec()) as number[];

  let total = 0;
  const byPerson = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    const n = results[i] ?? 0;
    total += n;
    byPerson.set(keys[i].slice(prefix.length), n);
  }
  return { total, byPerson };
}

// ── メイン比較関数 ──────────────────────────────────────────────────────────

export async function compareRedisAndDB(): Promise<CompareResult> {
  const start = Date.now();
  const generatedAt = new Date().toISOString();

  const redis = getRedis();
  if (!redis) {
    return {
      generatedAt,
      durationMs: Date.now() - start,
      summary: [],
      personDiscrepancies: [],
      allMatch: false,
      redisOk: false,
      dbOk: true,
      error: 'Redis未接続 — UPSTASH_REDIS_REST_URL / TOKEN を確認してください',
    };
  }

  try {
    // フェーズ1: DB クエリを先に発火（Neon は Upstash と独立した接続）
    const dbPromise = Promise.all([
      countPersonsImported(),
      countPersonsPublished(),
      countPersonMeta(),
      countGroupMeta(),
      countVodProviders(),
      countWorks(),
      countProducts(),
      countVerdicts(),
      getWorksCountByPerson(),
      getProductsCountByPerson(),
      getVerdictsCountByPerson(),
    ]);

    // フェーズ2: Redis 固定キー（軽量な hlen 5本を並行）
    const [rImported, rPublished, rPersonMeta, rGroupMeta, rProviders] = await Promise.all([
      redis.hlen('imported:persons'),
      redis.hlen('persons:published'),
      redis.hlen('admin:person-meta'),
      redis.hlen('admin:groups'),
      redis.hlen('vod:providers'),
    ]);

    // フェーズ3: Redis パターンスキャンを順次実行
    // 並行すると Upstash REST pipeline の結果が欠落することがあるため、1本ずつ完結させる
    const worksData    = await getCountsByPattern(redis, 'works:*',    'works:');
    const productsData = await getCountsByPattern(redis, 'products:*', 'products:');
    const verdictsData = await getCountsByPattern(redis, 'verdicts:*', 'verdicts:');

    // DB 結果を受け取る
    const [
      dImported, dPublished, dPersonMeta, dGroupMeta, dProviders,
      dWorks, dProducts, dVerdicts,
      dbWorksByPerson, dbProductsByPerson, dbVerdictsByPerson,
    ] = await dbPromise;

    // ── サマリー作成 ──────────────────────────────────────────────────────────
    const summary: EntitySummary[] = [
      {
        label: 'インポート人物',
        redisKey: 'imported:persons',
        redisCount: rImported,
        dbCount: dImported,
        match: rImported === dImported,
      },
      {
        label: '公開人物',
        redisKey: 'persons:published',
        redisCount: rPublished,
        dbCount: dPublished,
        match: rPublished === dPublished,
        note: 'DB では persons.published_at IS NOT NULL で判定',
      },
      {
        label: '人物メタ',
        redisKey: 'admin:person-meta',
        redisCount: rPersonMeta,
        dbCount: dPersonMeta,
        match: rPersonMeta === dPersonMeta,
      },
      {
        label: 'グループメタ',
        redisKey: 'admin:groups',
        redisCount: rGroupMeta,
        dbCount: dGroupMeta,
        match: rGroupMeta === dGroupMeta,
      },
      {
        label: 'VODプロバイダー',
        redisKey: 'vod:providers',
        redisCount: rProviders,
        dbCount: dProviders,
        match: rProviders === dProviders,
      },
      {
        label: '出演作品',
        redisKey: 'works:*',
        redisCount: worksData.total,
        dbCount: dWorks,
        match: worksData.total === dWorks,
        personCount: worksData.byPerson.size,
        dbPersonCount: dbWorksByPerson.size,
      },
      {
        label: '商品',
        redisKey: 'products:*',
        redisCount: productsData.total,
        dbCount: dProducts,
        match: productsData.total === dProducts,
        personCount: productsData.byPerson.size,
        dbPersonCount: dbProductsByPerson.size,
      },
      {
        label: 'AI判定',
        redisKey: 'verdicts:*',
        redisCount: verdictsData.total,
        dbCount: dVerdicts,
        match: verdictsData.total === dVerdicts,
        personCount: verdictsData.byPerson.size,
        dbPersonCount: dbVerdictsByPerson.size,
      },
    ];

    // ── 人物別差分 ────────────────────────────────────────────────────────────
    const personDiscrepancies: PersonDiscrepancy[] = [];

    const checkByPerson = (
      entity: 'works' | 'products' | 'verdicts',
      redisByPerson: Map<string, number>,
      dbByPerson: Map<string, number>,
    ) => {
      // Redis にある人物
      for (const [name, rCount] of redisByPerson) {
        const dCount = dbByPerson.get(name) ?? 0;
        if (rCount !== dCount) {
          personDiscrepancies.push({ personName: name, entity, redisCount: rCount, dbCount: dCount, diff: dCount - rCount });
        }
      }
      // DB にあって Redis にない人物
      for (const [name, dCount] of dbByPerson) {
        if (!redisByPerson.has(name)) {
          personDiscrepancies.push({ personName: name, entity, redisCount: 0, dbCount: dCount, diff: dCount });
        }
      }
    };

    checkByPerson('works',    worksData.byPerson,   dbWorksByPerson);
    checkByPerson('products', productsData.byPerson, dbProductsByPerson);
    checkByPerson('verdicts', verdictsData.byPerson, dbVerdictsByPerson);

    // 人物名でソート
    personDiscrepancies.sort((a, b) => a.personName.localeCompare(b.personName, 'ja'));

    const allMatch = summary.every((s) => s.match) && personDiscrepancies.length === 0;

    return {
      generatedAt,
      durationMs: Date.now() - start,
      summary,
      personDiscrepancies,
      allMatch,
      redisOk: true,
      dbOk: true,
    };
  } catch (err) {
    return {
      generatedAt,
      durationMs: Date.now() - start,
      summary: [],
      personDiscrepancies: [],
      allMatch: false,
      redisOk: true,
      dbOk: false,
      error: String(err),
    };
  }
}
