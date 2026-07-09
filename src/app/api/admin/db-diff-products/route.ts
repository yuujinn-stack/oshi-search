// products テーブルの Redis ↔ DB 差分詳細調査 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_ENTRIES_PER_SECTION = 100;

// ── 型定義 ──────────────────────────────────────────────────────────────────

type StructureClass = 'normal' | 'empty-array' | 'unknown-structure' | 'malformed';

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItems: string[];
  sampleShopName: string | null;
  structureClass: StructureClass;
}

interface PersonBreakdown {
  personName: string;
  categoryCount: number;
  totalItemCount: number;
  normal: number;
  emptyArray: number;
  unknownStructure: number;
  malformed: number;
}

export interface DbOnlyAnalysis {
  schemaNote: string;
  distinctPersons: string[];
  fetchedAtMin: string | null;
  fetchedAtMax: string | null;
  totalDbItemCount: number;
  originHint: string;
  verdict: 'real-data' | 'likely-real' | 'unknown' | 'test-data';
}

// ── ユーティリティ ───────────────────────────────────────────────────────────

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

function normalizeHash(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const obj = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      out[k] = val;
    } else if (val !== null && val !== undefined) {
      try { out[k] = JSON.stringify(val); } catch { /* skip */ }
    }
  }
  return out;
}

function parseRedisItemCount(raw: string): { count: number; malformed: boolean } {
  if (!raw || raw.trim() === '') return { count: 0, malformed: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { count: 0, malformed: true };
    }
    const items = (parsed as Record<string, unknown>)['products'];
    return { count: Array.isArray(items) ? items.length : 0, malformed: false };
  } catch {
    return { count: 0, malformed: true };
  }
}

function toFetchedAt(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

function toItemCount(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function safeString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

function sortEntries(a: DiffEntry, b: DiffEntry): number {
  return a.personName.localeCompare(b.personName, 'ja') || a.category.localeCompare(b.category);
}

// ── 起源判断ロジック ────────────────────────────────────────────────────────

const REAL_CATEGORIES = new Set([
  'CD', 'Blu-ray・DVD', '写真集', '本', 'DVD', 'Blu-ray',
  '楽器', 'グッズ', 'ゲーム', 'フィギュア', '雑誌',
]);

function analyzeDbOnly(entries: DiffEntry[]): DbOnlyAnalysis {
  const schemaNote =
    'products テーブルには source / created_at / updated_at カラムは存在しません。' +
    '判断に使える情報: fetched_at（取得日時）と items JSONB（楽天商品配列）のみです。';

  if (entries.length === 0) {
    return {
      schemaNote,
      distinctPersons: [],
      fetchedAtMin: null,
      fetchedAtMax: null,
      totalDbItemCount: 0,
      originHint: 'DB のみエントリなし',
      verdict: 'real-data',
    };
  }

  const distinctPersons = [...new Set(entries.map((e) => e.personName))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );

  const fetchedAts = entries
    .map((e) => e.fetchedAt)
    .filter((v): v is string => v !== null)
    .sort();
  const fetchedAtMin = fetchedAts[0] ?? null;
  const fetchedAtMax = fetchedAts[fetchedAts.length - 1] ?? null;

  const totalDbItemCount = entries.reduce((s, e) => s + (e.dbItemCount ?? 0), 0);

  // カテゴリが実際の楽天カテゴリか判定
  const realCatCount = entries.filter((e) => REAL_CATEGORIES.has(e.category)).length;
  const realCatRatio = entries.length > 0 ? realCatCount / entries.length : 0;

  // 商品名サンプルが含まれているか
  const hasSampleItems = entries.some((e) => e.sampleItems.length > 0);

  // fetched_at が今日かどうか
  const today = new Date().toISOString().slice(0, 10);
  const isFetchedToday =
    fetchedAtMin !== null &&
    fetchedAtMin.slice(0, 10) === today;

  // fetched_at が一定範囲に集中しているか（バッチ取得らしい）
  const isClusteredFetch =
    fetchedAtMin !== null &&
    fetchedAtMax !== null &&
    Math.abs(new Date(fetchedAtMax).getTime() - new Date(fetchedAtMin).getTime()) < 60 * 60 * 1000; // 1時間以内

  let originHint = '';
  let verdict: DbOnlyAnalysis['verdict'] = 'unknown';

  if (realCatRatio >= 0.8 && hasSampleItems && totalDbItemCount > 10) {
    if (isFetchedToday && isClusteredFetch) {
      originHint =
        `fetched_at が今日(${today})で1時間以内に集中 → 楽天商品バッチ取得で dual-write されたデータの可能性が高い。` +
        `Redis 側の書き込みが失敗（fire-and-forget のため無音）した可能性あり。正当な商品データとみなせる。`;
      verdict = 'real-data';
    } else if (isFetchedToday) {
      originHint =
        `fetched_at が今日(${today})。カテゴリ(${Math.round(realCatRatio * 100)}%)が実楽天カテゴリ。` +
        `商品サンプルあり。正当な楽天商品データとみなせる。`;
      verdict = 'real-data';
    } else {
      originHint =
        `カテゴリ(${Math.round(realCatRatio * 100)}%)が実楽天カテゴリで商品サンプルあり。` +
        `fetched_at: ${fetchedAtMin?.slice(0, 10) ?? '不明'} 〜 ${fetchedAtMax?.slice(0, 10) ?? '不明'}。` +
        `正当な楽天商品データの可能性が高い。`;
      verdict = 'likely-real';
    }
  } else if (totalDbItemCount === 0) {
    originHint = `items が全件 0 件。空データのみ → テスト実行やマイグレーション残留の可能性あり。`;
    verdict = 'test-data';
  } else {
    originHint = `カテゴリや商品名から起源を特定できませんでした。手動で内容を確認してください。`;
    verdict = 'unknown';
  }

  return {
    schemaNote,
    distinctPersons,
    fetchedAtMin,
    fetchedAtMax,
    totalDbItemCount,
    originHint,
    verdict,
  };
}

// ── Redis ヘルパー ────────────────────────────────────────────────────────────

async function scanProductKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  let guard = 0;
  do {
    const scanResult = await redis.scan(cursor, { match: 'products:*', count: 200 });
    if (!Array.isArray(scanResult) || scanResult.length < 2) break;
    cursor = Number(scanResult[0]);
    const batch = scanResult[1];
    if (Array.isArray(batch)) keys.push(...(batch as string[]));
    guard++;
  } while (cursor !== 0 && guard < 100);
  return keys.sort();
}

async function buildRedisMap(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  keys: string[],
): Promise<{ map: Map<string, number>; malformedCount: number }> {
  const map = new Map<string, number>();
  let malformedCount = 0;
  if (keys.length === 0) return { map, malformedCount };

  const BATCH = 50;
  for (let start = 0; start < keys.length; start += BATCH) {
    const chunk = keys.slice(start, start + BATCH);
    const results = await Promise.all(
      chunk.map((key) =>
        redis.hgetall(key).catch((e) => {
          console.warn('[db-diff-products] hgetall error', key.slice(0, 40), String(e).slice(0, 60));
          return null;
        }),
      ),
    );
    for (let i = 0; i < chunk.length; i++) {
      const key = chunk[i];
      const personName = key.replace(/^products:/, '');
      const hash = normalizeHash(results[i]);
      for (const [category, rawValue] of Object.entries(hash)) {
        const { count, malformed } = parseRedisItemCount(rawValue);
        if (malformed) malformedCount++;
        map.set(`${personName}::${category}`, count);
      }
    }
  }
  return { map, malformedCount };
}

// ── DB ヘルパー ───────────────────────────────────────────────────────────────

interface DbRow {
  person_name: string;
  category: string;
  fetched_at: unknown;
  items_type: unknown;
  item_count: unknown;
  sample_item_0: unknown;
  sample_item_1: unknown;
  sample_item_2: unknown;
  sample_shop_name: unknown;
}

function classifyStructure(row: DbRow, sampleItems: string[]): StructureClass {
  const itemsType = safeString(row.items_type);
  const itemCount = toItemCount(row.item_count);
  if (itemsType !== 'array') return 'malformed';
  if (itemCount === 0) return 'empty-array';
  if (sampleItems.length > 0) return 'normal';
  return 'unknown-structure';
}

function buildPersonBreakdown(entries: DiffEntry[]): PersonBreakdown[] {
  const map = new Map<string, PersonBreakdown>();
  for (const e of entries) {
    const p = map.get(e.personName) ?? {
      personName: e.personName,
      categoryCount: 0,
      totalItemCount: 0,
      normal: 0,
      emptyArray: 0,
      unknownStructure: 0,
      malformed: 0,
    };
    p.categoryCount++;
    p.totalItemCount += e.dbItemCount ?? 0;
    if (e.structureClass === 'normal') p.normal++;
    else if (e.structureClass === 'empty-array') p.emptyArray++;
    else if (e.structureClass === 'unknown-structure') p.unknownStructure++;
    else p.malformed++;
    map.set(e.personName, p);
  }
  return [...map.values()].sort((a, b) => b.totalItemCount - a.totalItemCount);
}

async function fetchDbRows(): Promise<DbRow[]> {
  const result = await db.execute(sql`
    SELECT
      person_name,
      category,
      fetched_at,
      jsonb_typeof(items) AS items_type,
      COALESCE(
        CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) ELSE 0 END,
        0
      ) AS item_count,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'title' ELSE NULL END AS sample_item_0,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->1->>'title' ELSE NULL END AS sample_item_1,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->2->>'title' ELSE NULL END AS sample_item_2,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'shopName' ELSE NULL END AS sample_shop_name
    FROM products
    ORDER BY person_name, category
  `);
  return extractRows<DbRow>(result);
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json(
        { error: 'Redis未接続 — UPSTASH_REDIS_REST_URL / TOKEN を確認してください' },
        { status: 503 },
      );
    }

    // Stage 1: DB
    let dbRows: DbRow[] = [];
    try {
      dbRows = await fetchDbRows();
      console.log(`[db-diff-products] DB: ${dbRows.length}行`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] DB クエリ失敗:', msg);
      return NextResponse.json({ error: `DB クエリエラー: ${msg}` }, { status: 500 });
    }

    // Stage 2: Redis SCAN
    let redisKeys: string[] = [];
    try {
      redisKeys = await scanProductKeys(redis);
      console.log(`[db-diff-products] Redis SCAN: ${redisKeys.length}キー`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis SCAN 失敗:', msg);
      return NextResponse.json({ error: `Redis SCAN エラー: ${msg}` }, { status: 500 });
    }

    // Stage 3: Redis hgetall (バッチ)
    let redisMap: Map<string, number>;
    let malformedCount = 0;
    try {
      const r = await buildRedisMap(redis, redisKeys);
      redisMap = r.map;
      malformedCount = r.malformedCount;
      console.log(`[db-diff-products] Redis: ${redisMap.size}エントリ malformed=${malformedCount}`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis hgetall 失敗:', msg);
      return NextResponse.json({ error: `Redis hgetall エラー: ${msg}` }, { status: 500 });
    }

    // Stage 4: 差分計算
    const dbMap = new Map<string, DbRow>();
    for (const row of dbRows) {
      if (row && typeof row.person_name === 'string' && typeof row.category === 'string') {
        dbMap.set(`${row.person_name}::${row.category}`, row);
      }
    }

    const dbOnly: DiffEntry[] = [];
    const redisOnly: DiffEntry[] = [];
    const bothDiff: DiffEntry[] = [];

    for (const [compositeKey, row] of dbMap.entries()) {
      const dbCount    = toItemCount(row.item_count);
      const redisCount = redisMap.get(compositeKey);

      const sampleItems = [
        safeString(row.sample_item_0),
        safeString(row.sample_item_1),
        safeString(row.sample_item_2),
      ].filter((s): s is string => s !== null);

      const entry: DiffEntry = {
        personName:     row.person_name,
        category:       row.category,
        dbItemCount:    dbCount,
        redisItemCount: redisCount ?? null,
        fetchedAt:      toFetchedAt(row.fetched_at),
        sampleItems,
        sampleShopName: safeString(row.sample_shop_name),
        structureClass: classifyStructure(row, sampleItems),
      };

      if (redisCount === undefined) {
        dbOnly.push(entry);
      } else if (dbCount !== redisCount) {
        bothDiff.push(entry);
      }
    }

    for (const [compositeKey, redisCount] of redisMap.entries()) {
      if (!dbMap.has(compositeKey)) {
        const sepIdx = compositeKey.indexOf('::');
        if (sepIdx < 0) continue;
        redisOnly.push({
          personName:     compositeKey.slice(0, sepIdx),
          category:       compositeKey.slice(sepIdx + 2),
          dbItemCount:    null,
          redisItemCount: redisCount,
          fetchedAt:      null,
          sampleItems:    [],
          sampleShopName: null,
          structureClass: 'empty-array',
        });
      }
    }

    dbOnly.sort(sortEntries);
    redisOnly.sort(sortEntries);
    bothDiff.sort(sortEntries);

    // Stage 5: 起源分析 + 人物別集計
    const dbOnlyAnalysis = analyzeDbOnly(dbOnly);
    const dbOnlyPersonBreakdown = buildPersonBreakdown(dbOnly);

    return NextResponse.json({
      summary: {
        dbTotal:             dbRows.length,
        redisTotal:          redisMap.size,
        dbOnlyCount:         dbOnly.length,
        redisOnlyCount:      redisOnly.length,
        bothDiffCount:       bothDiff.length,
        malformedRedisCount: malformedCount,
        truncatedAt:         MAX_ENTRIES_PER_SECTION,
      },
      dbOnlyAnalysis,
      dbOnlyPersonBreakdown,
      dbOnly:    dbOnly.slice(0,    MAX_ENTRIES_PER_SECTION),
      redisOnly: redisOnly.slice(0, MAX_ENTRIES_PER_SECTION),
      bothDiff:  bothDiff.slice(0,  MAX_ENTRIES_PER_SECTION),
    });
  } catch (outerErr) {
    const msg = String(outerErr).slice(0, 300);
    console.error('[db-diff-products] 予期しないエラー:', msg);
    return NextResponse.json({ error: `予期しないエラー: ${msg}` }, { status: 500 });
  }
}
