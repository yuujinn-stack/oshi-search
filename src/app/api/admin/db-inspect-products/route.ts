// products テーブルの items JSONB 構造診断 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

export async function GET() {
  try {
    // 1. items 型の分布
    const overviewResult = await db.execute(sql`
      SELECT
        COALESCE(jsonb_typeof(items), 'NULL') AS items_type,
        COUNT(*)::int AS cnt,
        COALESCE(
          SUM(CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) ELSE 0 END)::int,
          0
        ) AS total_items
      FROM products
      GROUP BY jsonb_typeof(items)
      ORDER BY cnt DESC
    `);
    const overview = extractRows<{ items_type: string; cnt: number; total_items: number }>(overviewResult);

    // 2. item_count > 0 のサンプル（件数の多い順に最大5行）
    const sampleResult = await db.execute(sql`
      SELECT
        person_name,
        category,
        jsonb_typeof(items)                                AS items_type,
        jsonb_array_length(items)                          AS item_count,
        jsonb_typeof(items->0)                             AS elem0_type,
        CASE
          WHEN jsonb_typeof(items->0) = 'object'
          THEN (SELECT array_agg(k ORDER BY k)::text
                FROM jsonb_object_keys(items->0) k)
        END                                                AS elem0_keys,
        LEFT((items->0)::text, 800)                        AS elem0_raw,
        items->0->>'title'                                 AS f_title,
        items->0->>'itemName'                              AS f_itemname,
        items->0->>'name'                                  AS f_name,
        items->0->>'productName'                           AS f_productname,
        (items->0->'Item')->>'itemName'                    AS f_item_itemname,
        (items->0->'Item')->>'title'                       AS f_item_title,
        items->0->>'id'                                    AS f_id,
        items->0->>'itemUrl'                               AS f_itemurl
      FROM products
      WHERE jsonb_typeof(items) = 'array'
        AND jsonb_array_length(items) > 0
      ORDER BY jsonb_array_length(items) DESC
      LIMIT 5
    `);
    const samples = extractRows<{
      person_name: string;
      category: string;
      items_type: string;
      item_count: number;
      elem0_type: string | null;
      elem0_keys: string | null;
      elem0_raw: string | null;
      f_title: string | null;
      f_itemname: string | null;
      f_name: string | null;
      f_productname: string | null;
      f_item_itemname: string | null;
      f_item_title: string | null;
      f_id: string | null;
      f_itemurl: string | null;
    }>(sampleResult);

    // 3. title が非null なレコード数
    const titleCountResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND items->0->>'title' IS NOT NULL)::int AS has_title,
        COUNT(*) FILTER (WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND items->0->>'itemName' IS NOT NULL)::int AS has_itemname,
        COUNT(*) FILTER (WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND items->0->>'name' IS NOT NULL)::int AS has_name,
        COUNT(*) FILTER (WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND (items->0->'Item')->>'itemName' IS NOT NULL)::int AS has_item_itemname,
        COUNT(*) FILTER (WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0)::int AS has_items
      FROM products
    `);
    const fieldCounts = extractRows<{
      has_title: number;
      has_itemname: number;
      has_name: number;
      has_item_itemname: number;
      has_items: number;
    }>(titleCountResult)[0] ?? null;

    return NextResponse.json({ overview, samples, fieldCounts });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 400) }, { status: 500 });
  }
}
