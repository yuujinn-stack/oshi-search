// products テーブルの Redis ↔ DB 差分詳細調査 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

interface DbProductRow {
  person_name: string;
  category: string;
  fetched_at: Date | string | null;
  item_count: number;
  // JSONB 先頭アイテムのサンプルフィールド
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

async function scanProductKeys(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: 'products:*', count: 200 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys.sort();
}

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });

  // ── DB 全行取得（サンプルタイトルつき）─────────────────────────────────────
  const dbResult = await db.execute(sql`
    SELECT
      person_name,
      category,
      fetched_at,
      jsonb_array_length(items)               AS item_count,
      items->0->>'itemName'                    AS sample_item_name,
      items->0->>'shopName'                    AS sample_shop_name
    FROM products
    ORDER BY person_name, category
  `);
  const dbRows = dbResult as unknown as DbProductRow[];

  // DB の (person_name, category) セットを構築
  const dbMap = new Map<string, DbProductRow>();
  for (const r of dbRows) {
    dbMap.set(`${r.person_name}::${r.category}`, r);
  }

  // ── Redis 全行取得 ────────────────────────────────────────────────────────
  const redisKeys = await scanProductKeys(redis);
  // 各キーの全フィールド（category → item数）を取得
  const redisMap = new Map<string, number>(); // key: "personName::category" → item count

  for (const key of redisKeys) {
    const personName = key.replace(/^products:/, '');
    const raw = await redis.hgetall(key);
    if (!raw) continue;
    for (const [category, value] of Object.entries(raw)) {
      try {
        const parsed =
          typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        const items = (parsed as { products?: unknown[] }).products ?? [];
        redisMap.set(`${personName}::${category}`, items.length);
      } catch {
        redisMap.set(`${personName}::${category}`, 0);
      }
    }
  }

  // ── 差分計算 ──────────────────────────────────────────────────────────────
  const dbOnly: DiffEntry[] = [];
  const redisOnly: DiffEntry[] = [];
  const bothDiff: DiffEntry[] = [];

  // DB にあって Redis にないもの / 両方あるが件数が違うもの
  for (const [compositeKey, row] of dbMap.entries()) {
    const redisCount = redisMap.get(compositeKey);
    const fetchedAt =
      row.fetched_at instanceof Date
        ? row.fetched_at.toISOString()
        : (row.fetched_at as string | null);

    const entry: DiffEntry = {
      personName: row.person_name,
      category: row.category,
      dbItemCount: Number(row.item_count),
      redisItemCount: redisCount ?? null,
      fetchedAt,
      sampleItemName: row.sample_item_name,
      sampleShopName: row.sample_shop_name,
    };

    if (redisCount === undefined) {
      dbOnly.push(entry);
    } else if (Number(row.item_count) !== redisCount) {
      bothDiff.push(entry);
    }
  }

  // Redis にあって DB にないもの
  for (const [compositeKey, redisCount] of redisMap.entries()) {
    if (!dbMap.has(compositeKey)) {
      const [personName, ...catParts] = compositeKey.split('::');
      redisOnly.push({
        personName,
        category: catParts.join('::'),
        dbItemCount: null,
        redisItemCount: redisCount,
        fetchedAt: null,
        sampleItemName: null,
        sampleShopName: null,
      });
    }
  }

  // ソート
  const sort = (a: DiffEntry, b: DiffEntry) =>
    a.personName.localeCompare(b.personName, 'ja') || a.category.localeCompare(b.category);
  dbOnly.sort(sort);
  redisOnly.sort(sort);
  bothDiff.sort(sort);

  return NextResponse.json({
    summary: {
      dbTotal:    dbRows.length,
      redisTotal: redisMap.size,
      dbOnlyCount:    dbOnly.length,
      redisOnlyCount: redisOnly.length,
      bothDiffCount:  bothDiff.length,
    },
    dbOnly,
    redisOnly,
    bothDiff,
  });
}
