// products テーブルの Redis ↔ DB 差分詳細調査 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_ENTRIES_PER_SECTION = 100;

// ── 型定義 ──────────────────────────────────────────────────────────────────

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItemName: string | null;
  sampleShopName: string | null;
}

// ── ユーティリティ ───────────────────────────────────────────────────────────

/** db.execute() の戻り値は NeonHttpQueryResult (配列継承版) かオブジェクト版かバージョンで異なる。
 *  どちらでも安全に行配列を取り出す。 */
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

/** Redis hgetall の戻り値を安全に Record<string, string> に正規化する。
 *  null / undefined / string / 想定外型はすべて {} を返す。 */
function normalizeHash(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const obj = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      out[k] = val;
    } else if (val !== null && val !== undefined) {
      // オブジェクトが既に parse 済みの場合は JSON.stringify で文字列化して保持
      try { out[k] = JSON.stringify(val); } catch { /* skip */ }
    }
  }
  return out;
}

/** Redis に格納された 1 カテゴリ値から items 件数を安全に取得する。
 *  壊れた値は malformed とみなし 0 を返す。 */
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

// ── Redis ヘルパー ────────────────────────────────────────────────────────────

async function scanProductKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  let guard = 0;
  do {
    const scanResult = await redis.scan(cursor, { match: 'products:*', count: 200 });
    // scan は [cursor, keys] の2要素タプルを返す
    if (!Array.isArray(scanResult) || scanResult.length < 2) break;
    cursor = Number(scanResult[0]);
    const batch = scanResult[1];
    if (Array.isArray(batch)) keys.push(...(batch as string[]));
    guard++;
  } while (cursor !== 0 && guard < 100);
  return keys.sort();
}

/** Promise.all で全キーを並行取得し redisMap を構築する。
 *  pipeline は型の不確実性が高いため使用しない。 */
async function buildRedisMap(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  keys: string[],
): Promise<{ map: Map<string, number>; malformedCount: number }> {
  const map = new Map<string, number>();
  let malformedCount = 0;
  if (keys.length === 0) return { map, malformedCount };

  // Upstash は HTTP ベースのため Promise.all は TCP 並列ではなく HTTP パイプライン
  // 1 回のリクエストに制限はないが、件数が多い場合は 50 件ずつバッチ処理する
  const BATCH_SIZE = 50;
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const batch = keys.slice(start, start + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((key) =>
        redis.hgetall(key).catch((e) => {
          console.warn('[db-diff-products] hgetall error', key, String(e).slice(0, 60));
          return null;
        }),
      ),
    );

    for (let i = 0; i < batch.length; i++) {
      const key = batch[i];
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
  item_count: unknown;
  sample_item_name: unknown;
  sample_shop_name: unknown;
}

async function fetchDbRows(): Promise<DbRow[]> {
  // db.execute() の戻り値形式はバージョンで異なるため extractRows() で正規化する
  const result = await db.execute(sql`
    SELECT
      person_name,
      category,
      fetched_at,
      COALESCE(
        CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) ELSE 0 END,
        0
      ) AS item_count,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'itemName' ELSE NULL END AS sample_item_name,
      CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'shopName' ELSE NULL END AS sample_shop_name
    FROM products
    ORDER BY person_name, category
  `);
  return extractRows<DbRow>(result);
}

function toFetchedAt(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

function toItemCount(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sortEntries(a: DiffEntry, b: DiffEntry): number {
  return a.personName.localeCompare(b.personName, 'ja') || a.category.localeCompare(b.category);
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

    // ── Stage 1: DB クエリ ────────────────────────────────────────────────
    let dbRows: DbRow[] = [];
    try {
      dbRows = await fetchDbRows();
      console.log(`[db-diff-products] DB: ${dbRows.length}行`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] DB クエリ失敗:', msg);
      return NextResponse.json({ error: `DB クエリエラー: ${msg}` }, { status: 500 });
    }

    // ── Stage 2: Redis SCAN ───────────────────────────────────────────────
    let redisKeys: string[] = [];
    try {
      redisKeys = await scanProductKeys(redis);
      console.log(`[db-diff-products] Redis SCAN: ${redisKeys.length}キー`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis SCAN 失敗:', msg);
      return NextResponse.json({ error: `Redis SCAN エラー: ${msg}` }, { status: 500 });
    }

    // ── Stage 3: Redis hgetall (バッチ) ──────────────────────────────────
    let redisMap: Map<string, number>;
    let malformedCount = 0;
    try {
      const result = await buildRedisMap(redis, redisKeys);
      redisMap = result.map;
      malformedCount = result.malformedCount;
      console.log(`[db-diff-products] Redis: ${redisMap.size}エントリ malformed=${malformedCount}`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis hgetall 失敗:', msg);
      return NextResponse.json({ error: `Redis hgetall エラー: ${msg}` }, { status: 500 });
    }

    // ── Stage 4: 差分計算 ─────────────────────────────────────────────────
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
      const dbCount = toItemCount(row.item_count);
      const redisCount = redisMap.get(compositeKey);

      const entry: DiffEntry = {
        personName:     row.person_name,
        category:       row.category,
        dbItemCount:    dbCount,
        redisItemCount: redisCount ?? null,
        fetchedAt:      toFetchedAt(row.fetched_at),
        sampleItemName: typeof row.sample_item_name === 'string' ? row.sample_item_name : null,
        sampleShopName: typeof row.sample_shop_name === 'string' ? row.sample_shop_name : null,
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
          sampleItemName: null,
          sampleShopName: null,
        });
      }
    }

    dbOnly.sort(sortEntries);
    redisOnly.sort(sortEntries);
    bothDiff.sort(sortEntries);

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
