// 商品復旧候補の調査・復旧 API
// GET: 読み取り専用 — 孤立verdict を DB と Redis の両面から分類する
// POST: 商品復旧 — Redis に残るデータを既存 DB 配列へ追記（削除・置換しない）

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { neonSql } from '@/db/client';
import { products as productsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertProduct, hasIdempotencyKey, insertWorkStatusHistory } from '@/db/write';
import { getRedis } from '@/lib/redis';
import type { RakutenItem } from '@/types/rakuten';

export const dynamic = 'force-dynamic';

const MAX_CANDIDATES_PER_EXECUTE = 100;

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

export interface ProductRecoveryCandidate {
  productId:     string;
  redisCategory: string;
}

// ── GET ─��────────────────────────────────────────────────────────────────────
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

  // ── 人物の孤�� verdict 詳細 ───────────────────────────────────────────────────
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

  // ── Redis チェック ────────────────────────────────────���─────────────────────
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
      return NextResponse.json({
        verdicts: [], personName,
        summary: { total: 0, classA: 0, classE: 0, redisKeyExists: false, redisCategories: [] },
      });
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

    // 分類（商品URLや画像URLはログに出力しない）
    const results: OrphanVerdict[] = orphanProductIds.map((productId) => {
      const redisMatch = redisProductMap.get(productId);
      if (redisMatch) {
        return {
          productId, verdict: '', score: 0, source: '', reason: null, judgedAt: '',
          classification: 'A' as const,
          redisCategory: redisMatch.category,
          redisTitle:    redisMatch.title,
        };
      }
      return { productId, verdict: '', score: 0, source: '', reason: null, judgedAt: '', classification: 'E' as const };
    });

    const classA = results.filter((r) => r.classification === 'A').length;
    const classE = results.filter((r) => r.classification === 'E').length;

    return NextResponse.json({
      verdicts: results,
      personName,
      summary: {
        total:  results.length,
        classA,
        classE,
        redisKeyExists: Object.keys(redisData).length > 0,
        redisCategories: Object.keys(redisData),
      },
    });
  }

  return NextResponse.json({ error: `不明な type: ${type}` }, { status: 400 });
}

// ── POST ─────────────���───────────────────────────────────────────────────────
// body:
//   personName:     string    — 対象人物名
//   candidates:     ProductRecoveryCandidate[]  — { productId, redisCategory }[]
//   dryRun:         boolean   — default true
//   confirmToken:   string    — 実行時必須: 'RECOVER_PRODUCTS'
//   idempotencyKey: string    — 実行時必須
//   reason:         string    — 実行時必須
//
// 安全ガード:
//   - dryRun=false: DATA_RECOVERY_EXECUTION_ENABLED=true が必須 (403)
//   - max 100件 / 実行
//   - 確認トークン 'RECOVER_PRODUCTS' 必須
//   - 冪等性キー必須（二重実行防止）
//   - 現 DB に同一 productId がある場合は復旧対象外 (already_in_db)
//   - 全置換せず既存配列へ追記（削除・上書きしな��）
//   - 一部カテゴリ失敗時も他カテゴリは続行（ロールバックしない）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    dryRun         = true,
    personName,
    candidates,
    confirmToken,
    idempotencyKey,
    reason,
  } = body as {
    dryRun?:         boolean;
    personName?:     string;
    candidates?:     ProductRecoveryCandidate[];
    confirmToken?:   string;
    idempotencyKey?: string;
    reason?:         string;
  };

  if (!personName || !Array.isArray(candidates) || candidates.length === 0) {
    return NextResponse.json({ error: 'personName, candidates が必要です' }, { status: 400 });
  }
  if (candidates.length > MAX_CANDIDATES_PER_EXECUTE) {
    return NextResponse.json(
      { error: `一度に指定できる最大件数は ${MAX_CANDIDATES_PER_EXECUTE} 件です` },
      { status: 400 },
    );
  }

  // ── 実行モードのバリデーション ────────────────────────────────────────────
  if (!dryRun) {
    if (process.env.DATA_RECOVERY_EXECUTION_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'DATA_RECOVERY_EXECUTION_ENABLED=true が設定されていないため実行できません' },
        { status: 403 },
      );
    }
    if (!reason?.trim()) {
      return NextResponse.json({ error: '実行には reason が必��です' }, { status: 400 });
    }
    if (!idempotencyKey?.trim()) {
      return NextResponse.json({ error: '実行には idempotencyKey が必���です' }, { status: 400 });
    }
    if (confirmToken !== 'RECOVER_PRODUCTS') {
      return NextResponse.json(
        { error: 'confirmToken に "RECOVER_PRODUCTS" を入力してください' },
        { status: 400 },
      );
    }
    // 二重実行防止
    try {
      if (await hasIdempotencyKey(idempotencyKey)) {
        return NextResponse.json(
          { error: 'この idempotencyKey は既に実行済みです（二重実行防止）' },
          { status: 409 },
        );
      }
    } catch (err) {
      return NextResponse.json({ error: `idempotencyKey チェック失敗: ${String(err)}` }, { status: 500 });
    }
  }

  // Redis から人物の全カテゴリデータを取得
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis 未接続' }, { status: 503 });
  }

  let redisData: Record<string, unknown> = {};
  try {
    const raw = await redis.hgetall(`products:${personName}`);
    redisData = (raw ?? {}) as Record<string, unknown>;
  } catch (err) {
    return NextResponse.json({ error: `Redis 取得失敗: ${String(err)}` }, { status: 500 });
  }

  // Redis 全カテゴリから productId → { item, category } マップを構築
  const redisItemMap = new Map<string, { item: RakutenItem; category: string }>();
  for (const [category, rawJson] of Object.entries(redisData)) {
    try {
      const items = (typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson) as RakutenItem[];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item?.id && !redisItemMap.has(item.id)) {
          redisItemMap.set(item.id, { item, category });
        }
      }
    } catch { /* skip */ }
  }

  // DB から現在の商品 ID セットを取得（重複チェック用）
  const existingProductIds = new Set<string>();
  try {
    const rows = await db.select().from(productsTable)
      .where(eq(productsTable.personName, personName));
    for (const row of rows) {
      for (const item of (row.items as RakutenItem[])) {
        if (item?.id) existingProductIds.add(item.id);
      }
    }
  } catch (err) {
    return NextResponse.json({ error: `DB 取得失敗: ${String(err)}` }, { status: 500 });
  }

  // 各候補を評価
  type CandidateStatus = 'recoverable' | 'already_in_db' | 'not_in_redis';
  interface EvaluatedCandidate {
    productId:    string;
    status:       CandidateStatus;
    item?:        RakutenItem;
    category?:    string;
  }

  const evaluated: EvaluatedCandidate[] = candidates.map(({ productId }) => {
    if (existingProductIds.has(productId)) {
      return { productId, status: 'already_in_db' };
    }
    const found = redisItemMap.get(productId);
    if (!found) {
      return { productId, status: 'not_in_redis' };
    }
    return { productId, status: 'recoverable', item: found.item, category: found.category };
  });

  const recoverable = evaluated.filter((c): c is EvaluatedCandidate & { status: 'recoverable'; item: RakutenItem; category: string } =>
    c.status === 'recoverable',
  );

  // ── dry-run ──────────────────────────────────────────────────────────────
  if (dryRun) {
    return NextResponse.json({
      dryRun:           true,
      recoverableCount: recoverable.length,
      alreadyInDbCount: evaluated.filter((c) => c.status === 'already_in_db').length,
      notInRedisCount:  evaluated.filter((c) => c.status === 'not_in_redis').length,
      preview: recoverable.map((c) => ({
        productId: c.productId,
        category:  c.category,
        title:     c.item.title ?? '',
      })),
    });
  }

  // ── 実行: カテゴリ別にグループ化して1カテゴリ1回のDB書き込み ─────────────
  const byCategory = new Map<string, RakutenItem[]>();
  for (const c of recoverable) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c.item);
  }

  let recovered = 0;
  const skippedIds: string[] = [];

  for (const [category, newItems] of byCategory) {
    try {
      // 現在の DB データを読み取り（既存商品を保持するため）
      const rows = await db.select().from(productsTable)
        .where(eq(productsTable.personName, personName));
      const row = rows.find((r) => r.category === category);
      const existing: RakutenItem[] = row ? (row.items as RakutenItem[]) : [];
      const existingIdsInCat = new Set(existing.map((i) => i.id));

      // 既存にないものだけ追加（二重追加防止）
      const toAdd = newItems.filter((i) => !existingIdsInCat.has(i.id));
      if (toAdd.length === 0) {
        skippedIds.push(...newItems.map((i) => i.id));
        continue;
      }

      // 既存配列へ追記（削除・置換しない��
      const merged = [...existing, ...toAdd];
      const fetchedAt = row ? row.fetchedAt.getTime() : Date.now();
      await upsertProduct(personName, category, merged, fetchedAt);
      recovered += toAdd.length;
    } catch (err) {
      // 一部カテゴリ失敗: このカテゴリをスキップ（他カテゴリは続行、ロールバックしない）
      skippedIds.push(...newItems.map((i) => i.id));
      console.error(`[product-recovery] category=${category} write failed: ${String(err)}`);
    }
  }

  // 監査ログ（fire-and-forget）
  insertWorkStatusHistory({
    personName,
    workId:         `product-recovery-${idempotencyKey ?? Date.now()}`,
    title:          `商品復旧 ${recovered}件 / ${personName}`,
    workSource:     'product_recovery',
    previousStatus: 'orphaned',
    newStatus:      'restored',
    changedBy:      'admin:product-recovery',
    reason:         reason!.trim(),
    idempotencyKey,
  }).catch((e) => console.error('[product-recovery] audit log failed:', String(e)));

  return NextResponse.json({
    ok:            true,
    recovered,
    skipped:       skippedIds.length,
    idempotencyKey,
  });
}
