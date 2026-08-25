import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { RakutenItem } from '@/types/rakuten';

// GET /api/admin/photobooks/search-products?personName=...&q=...
//
// 写真集の手動追加(manual_include)用: 既存の products テーブルに登録済みの商品だけを
// 検索する。外部API（楽天等）は一切呼び出さない。新規商品の取得は行わない。
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const personName = searchParams.get('personName')?.trim() ?? '';
    const q = searchParams.get('q')?.trim() ?? '';

    if (!personName && !q) {
      return NextResponse.json({ items: [] });
    }

    const conditions = [];
    if (personName) conditions.push(sql`person_name = ${personName}`);
    if (q) conditions.push(sql`item->>'title' ILIKE ${'%' + q + '%'}`);
    const whereClause = conditions.length === 2
      ? sql`${conditions[0]} AND ${conditions[1]}`
      : conditions[0] ?? conditions[1];

    const result = await db.execute(sql`
      SELECT person_name, category, item
      FROM products, jsonb_array_elements(items) AS item
      WHERE ${whereClause}
      LIMIT 60
    `);

    const rows = result.rows as unknown as { person_name: string; category: string; item: RakutenItem }[];
    const items = rows.map((r) => ({
      personName: r.person_name,
      category: r.category,
      productId: r.item.id,
      title: r.item.title,
      imageUrl: r.item.imageUrl,
      price: r.item.price,
      itemUrl: r.item.itemUrl,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
