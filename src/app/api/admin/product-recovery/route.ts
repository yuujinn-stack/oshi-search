// 商品復旧候補の調査 API — 読み取り専用
// 孤立verdict を DB と Redis の両面から分類する

import { NextRequest, NextResponse } from 'next/server';
import { neonSql } from '@/db/client';
import { getRedis } from '@/lib/redis';
import type { RakutenItem } from '@/types/rakuten';

export const dynamic = 'force-dynamic';

export interface OrphanStat {
  personName:  string;
  orphanCount: number;
}

export interface OrphanVerdict {
  productId:  string;
  verdict:    string;
  score:      number;
  source:     string;
  reason:     string | null;
  judgedAt:   string;
  /** 分類: A=Redis完全 B=Redis部分 C=DB別カテゴリ D=別ID候補 E=データなし */
  classification: 'A' | 'B' | 'C' | 'D' | 'E' | 'pending';
  redisCategory?: string;
  redisTitle?:    string;
}

// GET /api/admin/product-recovery
// query:
//   type=orphan-stats        → 孤立verdict 件数を人物別に集計
//   type=orphan-detail&personName={name}  → 人物の孤立 verdict 一覧
//   type=redis-check&personName={name}    → Redis で分類
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type       = searchParams.get('type') ?? 'orphan-stats';
  const personName = searchParams.get('personName') ?? '';

  // ── 孤立 verdict 人物別集計 ──────────────────────────────────────────────────
  if (type === 'orphan-stats') {
    try {
      const rows = await neonSql`
        WITH product_ids AS (
          SELECT DISTINCT p.person_name, elem->>'id' AS product_id
          FROM products p,
          LATERAL jsonb_array_elements(p.items) AS elem
          WHERE jsonb_typeof(p.items) = 'array'
        )
        SELECT v.person_name, COUNT(*)::int AS orphan_count
        FROM verdicts v
        LEFT JOIN product_ids pi
          ON v.person_name = pi.person_name AND v.product_id = pi.product_id
        WHERE pi.product_id IS NULL
        GROUP BY v.person_name
        ORDER BY orphan_count DESC
      `;
      const stats: OrphanStat[] = rows.map((r) => ({
        personName:  r.person_name as string,
        orphanCount: r.orphan_count as number,
      }));
      const total = stats.reduce((s, r) => s + r.orphanCount, 0);
      return NextResponse.json({ stats, total });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  // ── 人物の孤立 verdict 詳細 ───────────────────────────────────────────────────
  if (type === 'orphan-detail') {
    try {
      const rows = await neonSql`
        WITH product_ids AS (
          SELECT DISTINCT elem->>'id' AS product_id
          FROM products p,
          LATERAL jsonb_array_elements(p.items) AS elem
          WHERE p.person_name = ${personName}
            AND jsonb_typeof(p.items) = 'array'
        )
        SELECT
          v.product_id,
          v.verdict,
          v.score::float AS score,
          v.source,
          v.reason,
          v.judged_at
        FROM verdicts v
        LEFT JOIN product_ids pi ON v.product_id = pi.product_id
        WHERE v.person_name = ${personName}
          AND pi.product_id IS NULL
        ORDER BY v.judged_at DESC
        LIMIT 500
      `;
      const verdicts: OrphanVerdict[] = rows.map((r) => ({
        productId:      r.product_id as string,
        verdict:        r.verdict as string,
        score:          r.score as number,
        source:         r.source as string,
        reason:         r.reason as string | null,
        judgedAt:       String(r.judged_at).slice(0, 19).replace('T', ' '),
        classification: 'E' as const,
      }));
      return NextResponse.json({ verdicts, personName });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── Redis チェック ──────────────────────────────────────────────────────────
  if (type === 'redis-check') {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json(
        { error: 'Redis 未接続 — UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を確認してください' },
        { status: 503 },
      );
    }

    // 孤立 verdict を取得
    let orphanProductIds: string[] = [];
    try {
      const rows = await neonSql`
        WITH product_ids AS (
          SELECT DISTINCT elem->>'id' AS product_id
          FROM products p,
          LATERAL jsonb_array_elements(p.items) AS elem
          WHERE p.person_name = ${personName}
            AND jsonb_typeof(p.items) = 'array'
        )
        SELECT v.product_id
        FROM verdicts v
        LEFT JOIN product_ids pi ON v.product_id = pi.product_id
        WHERE v.person_name = ${personName}
          AND pi.product_id IS NULL
        LIMIT 1000
      `;
      orphanProductIds = rows.map((r) => r.product_id as string);
    } catch (err) {
      return NextResponse.json({ error: `DB query failed: ${String(err)}` }, { status: 500 });
    }

    if (orphanProductIds.length === 0) {
      return NextResponse.json({ verdicts: [], personName });
    }

    // Redis から products:{personName} をhgetall
    const redisKey = `products:${personName}`;
    let redisData: Record<string, unknown> = {};
    try {
      const raw = await redis.hgetall(redisKey);
      redisData = (raw ?? {}) as Record<string, unknown>;
    } catch {
      // Redis 接続失敗: 全件 E 分類で返す
    }

    // Redis の全カテゴリを走査して product_id を検索
    const redisProductMap = new Map<string, { category: string; title: string }>();
    for (const [category, rawJson] of Object.entries(redisData)) {
      try {
        const items = (typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson) as RakutenItem[];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (item?.id) {
            redisProductMap.set(item.id, { category, title: item.title ?? '' });
          }
        }
      } catch {
        // JSON parse 失敗: スキップ
      }
    }

    // 分類
    const results: OrphanVerdict[] = orphanProductIds.map((productId) => {
      const redisMatch = redisProductMap.get(productId);
      let classification: OrphanVerdict['classification'] = 'E';
      let redisCategory: string | undefined;
      let redisTitle: string | undefined;

      if (redisMatch) {
        classification = 'A';
        redisCategory  = redisMatch.category;
        redisTitle     = redisMatch.title;
      }

      return { productId, verdict: '', score: 0, source: '', reason: null, judgedAt: '', classification, redisCategory, redisTitle };
    });

    const classA = results.filter((r) => r.classification === 'A').length;
    const classE = results.filter((r) => r.classification === 'E').length;

    return NextResponse.json({
      verdicts: results,
      personName,
      summary: {
        total:  results.length,
        classA, // Redis に完全な商品情報あり
        classE, // データなし
        redisKeyExists: Object.keys(redisData).length > 0,
        redisCategories: Object.keys(redisData),
      },
    });
  }

  return NextResponse.json({ error: `不明な type: ${type}` }, { status: 400 });
}
