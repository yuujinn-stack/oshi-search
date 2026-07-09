// products テーブルの Redis ↔ DB 差分詳細調査 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_ENTRIES_PER_SECTION = 100;

interface DbProductRow {
  person_name: string;
  category: string;
  fetched_at: Date | string | null;
  item_count: number | string | null;
  sample_item_name: string | null;
  sample_shop_name: string | null;
}

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItemName: string | null;
  sampleShopName: string | null;
}

function safeItemCount(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sortEntries(a: DiffEntry, b: DiffEntry): number {
  return a.personName.localeCompare(b.personName, 'ja') || a.category.localeCompare(b.category);
}

// ── Redis: SCAN で products:* キー一覧を取得 ──────────────────────────────────
async function scanProductKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 50; // 無限ループ防止
  do {
    const [cur, batch] = await redis.scan(cursor, { match: 'products:*', count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
    iterations++;
  } while (cursor !== 0 && iterations < MAX_ITERATIONS);
  return keys.sort();
}

// ── Redis: pipeline で全キーの hgetall を一括取得 ─────────────────────────────
async function buildRedisMap(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  keys: string[],
): Promise<{ map: Map<string, number>; malformedCount: number }> {
  const map = new Map<string, number>();
  let malformedCount = 0;

  if (keys.length === 0) return { map, malformedCount };

  // Upstash pipeline で一括 hgetall
  const pipe = redis.pipeline();
  for (const key of keys) {
    pipe.hgetall(key);
  }

  let pipeResults: Array<Record<string, unknown> | null>;
  try {
    pipeResults = (await pipe.exec()) as Array<Record<string, unknown> | null>;
  } catch (pipeErr) {
    console.warn('[db-diff-products] pipeline exec failed:', String(pipeErr).slice(0, 120));
    // pipeline 失敗時は1件ずつフォールバック
    pipeResults = await Promise.all(
      keys.map((key) =>
        redis.hgetall(key).catch((e) => {
          console.warn('[db-diff-products] hgetall fallback failed', key, String(e).slice(0, 80));
          return null;
        }),
      ),
    );
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const personName = key.replace(/^products:/, '');
    const raw = pipeResults[i];
    if (!raw) continue;

    for (const [category, value] of Object.entries(raw)) {
      try {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          malformedCount++;
          map.set(`${personName}::${category}`, 0);
          continue;
        }
        const parsed: unknown =
          typeof value === 'string' ? JSON.parse(value) : value;
        const items =
          (parsed as { products?: unknown[] } | null)?.products ?? [];
        map.set(`${personName}::${category}`, Array.isArray(items) ? items.length : 0);
      } catch {
        malformedCount++;
        map.set(`${personName}::${category}`, 0);
      }
    }
  }

  return { map, malformedCount };
}

export async function GET() {
  // 最外殻 try-catch: どんな例外でも必ず JSON を返す
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: 'Redis未接続 — UPSTASH_REDIS_REST_URL / TOKEN を確認してください' }, { status: 503 });
    }

    // ── Stage 1: DB クエリ ───────────────────────────────────────────────────
    let dbRows: DbProductRow[] = [];
    let dbError: string | null = null;
    try {
      const result = await db.execute(sql`
        SELECT
          person_name,
          category,
          fetched_at,
          COALESCE(jsonb_array_length(items), 0) AS item_count,
          CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'itemName' ELSE NULL END AS sample_item_name,
          CASE WHEN jsonb_typeof(items) = 'array' THEN items->0->>'shopName' ELSE NULL END AS sample_shop_name
        FROM products
        ORDER BY person_name, category
      `);
      dbRows = result as unknown as DbProductRow[];
      console.log(`[db-diff-products] DB: ${dbRows.length}行取得`);
    } catch (err) {
      dbError = String(err).slice(0, 200);
      console.warn('[db-diff-products] DB クエリ失敗:', dbError);
      return NextResponse.json({ error: `DB クエリエラー: ${dbError}` }, { status: 500 });
    }

    // ── Stage 2: Redis SCAN ──────────────────────────────────────────────────
    let redisKeys: string[] = [];
    try {
      redisKeys = await scanProductKeys(redis);
      console.log(`[db-diff-products] Redis SCAN: ${redisKeys.length}キー`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis SCAN 失敗:', msg);
      return NextResponse.json({ error: `Redis SCAN エラー: ${msg}` }, { status: 500 });
    }

    // ── Stage 3: Redis pipeline hgetall ─────────────────────────────────────
    let redisMap: Map<string, number>;
    let malformedCount = 0;
    try {
      const result = await buildRedisMap(redis, redisKeys);
      redisMap = result.map;
      malformedCount = result.malformedCount;
      console.log(`[db-diff-products] Redis: ${redisMap.size}エントリ (malformed=${malformedCount})`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      console.warn('[db-diff-products] Redis hgetall 失敗:', msg);
      return NextResponse.json({ error: `Redis hgetall エラー: ${msg}` }, { status: 500 });
    }

    // ── Stage 4: 差分計算 ────────────────────────────────────────────────────
    const dbMap = new Map<string, DbProductRow>();
    for (const r of dbRows) {
      dbMap.set(`${r.person_name}::${r.category}`, r);
    }

    const dbOnly: DiffEntry[] = [];
    const redisOnly: DiffEntry[] = [];
    const bothDiff: DiffEntry[] = [];

    for (const [compositeKey, row] of dbMap.entries()) {
      const redisCount = redisMap.get(compositeKey);
      const dbCount = safeItemCount(row.item_count);

      const fetchedAt =
        row.fetched_at instanceof Date
          ? row.fetched_at.toISOString()
          : (typeof row.fetched_at === 'string' ? row.fetched_at : null);

      const entry: DiffEntry = {
        personName:     row.person_name,
        category:       row.category,
        dbItemCount:    dbCount,
        redisItemCount: redisCount ?? null,
        fetchedAt,
        sampleItemName: row.sample_item_name,
        sampleShopName: row.sample_shop_name,
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
        const personName = compositeKey.slice(0, sepIdx);
        const category   = compositeKey.slice(sepIdx + 2);
        redisOnly.push({
          personName,
          category,
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
        dbTotal:        dbRows.length,
        redisTotal:     redisMap.size,
        dbOnlyCount:    dbOnly.length,
        redisOnlyCount: redisOnly.length,
        bothDiffCount:  bothDiff.length,
        malformedRedisCount: malformedCount,
        truncatedAt: MAX_ENTRIES_PER_SECTION,
      },
      // 各セクションは最大100件に制限（全件は summary.xxxCount で確認）
      dbOnly:    dbOnly.slice(0, MAX_ENTRIES_PER_SECTION),
      redisOnly: redisOnly.slice(0, MAX_ENTRIES_PER_SECTION),
      bothDiff:  bothDiff.slice(0, MAX_ENTRIES_PER_SECTION),
    });
  } catch (outerErr) {
    // 予期しない例外でも必ず JSON を返す
    const msg = String(outerErr).slice(0, 300);
    console.error('[db-diff-products] 予期しないエラー:', msg);
    return NextResponse.json({ error: `予期しないエラー: ${msg}` }, { status: 500 });
  }
}
