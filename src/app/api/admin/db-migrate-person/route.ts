// 人物別 DB移行候補 INSERT API（読み取り専用調査の後工程）
//
// POST /api/admin/db-migrate-person  body: { personName: string }
//
// ■ 安全制約
//   - 登録対象は Classification = 'migrate' のみ
//   - deleted / suspect / dup_title_year / dup_title_only / unknown は絶対に登録しない
//   - 既存DBデータは変更しない（onConflictDoNothing）
//   - Redis・DB以外のデータに触れない
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { works } from '@/db/schema';
import { sql } from 'drizzle-orm';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';

// ── 分類ロジック（db-person-diff と同一） ──────────────────────────────────────

type Classification =
  | 'dup_title_year'
  | 'dup_title_only'
  | 'deleted'
  | 'suspect'
  | 'migrate'
  | 'unknown';

interface DbSummary { workId: string; title: string; releaseYear: number | null; workType: string; }

function normTitle(t: string): string {
  return t.replace(/[\s　]+/g, ' ').trim().toLowerCase();
}

function classify(
  work: WorkRecord,
  dbByTYT: Map<string, DbSummary>,
  dbByTitle: Map<string, DbSummary>,
): Classification {
  if (work.deleted)   return 'deleted';

  const norm   = normTitle(work.title);
  const tytKey = `${norm}|${work.releaseYear ?? ''}|${work.type}`;

  if (dbByTYT.has(tytKey))   return 'dup_title_year';
  if (dbByTitle.has(norm))    return 'dup_title_only';

  if (work.status === 'hidden' || work.aiSamePerson === false) return 'suspect';
  if (!work.source)            return 'unknown';

  return 'migrate';
}

// ── workToRow 変換 ────────────────────────────────────────────────────────────

function workToRow(work: WorkRecord, fallbackPersonName: string): typeof works.$inferInsert {
  const aiData: Record<string, unknown> = {};
  if (work.aiDecision !== undefined)             aiData.aiDecision             = work.aiDecision;
  if (work.aiSamePerson !== undefined)           aiData.aiSamePerson           = work.aiSamePerson;
  if (work.aiReason !== undefined)               aiData.aiReason               = work.aiReason;
  if (work.aiRelation !== undefined)             aiData.aiRelation             = work.aiRelation;
  if (work.aiStatusRecommendation !== undefined) aiData.aiStatusRecommendation = work.aiStatusRecommendation;
  if (work.aiNeedsHumanReview !== undefined)     aiData.aiNeedsHumanReview     = work.aiNeedsHumanReview;
  if (work.usedAi !== undefined)                 aiData.usedAi                 = work.usedAi;
  if (work.tmdbMatchedPersonId !== undefined)    aiData.tmdbMatchedPersonId    = work.tmdbMatchedPersonId;
  if (work.tmdbMatchedPersonName !== undefined)  aiData.tmdbMatchedPersonName  = work.tmdbMatchedPersonName;
  if (work.workDisplayType !== undefined)        aiData.workDisplayType        = work.workDisplayType;

  const vodData: Record<string, unknown> = {};
  if (work.vodProviders !== undefined)    vodData.vodProviders    = work.vodProviders;
  if (work.vodUpdatedAt !== undefined)    vodData.vodUpdatedAt    = work.vodUpdatedAt;
  if (work.vodAiCheckedAt !== undefined)  vodData.vodAiCheckedAt  = work.vodAiCheckedAt;
  if (work.vodStatus !== undefined)       vodData.vodStatus       = work.vodStatus;
  if (work.nextVodCheckAt !== undefined)  vodData.nextVodCheckAt  = work.nextVodCheckAt;
  if (work.lastVodCheckAt !== undefined)  vodData.lastVodCheckAt  = work.lastVodCheckAt;
  if (work.vodCheckSource !== undefined)  vodData.vodCheckSource  = work.vodCheckSource;
  if (work.vodCheckStatus !== undefined)  vodData.vodCheckStatus  = work.vodCheckStatus;
  if (work.vodCheckError !== undefined)   vodData.vodCheckError   = work.vodCheckError;
  if (work.priorityRecheck !== undefined) vodData.priorityRecheck = work.priorityRecheck;

  return {
    id:              work.id,
    personName:      work.personName || fallbackPersonName,
    title:           work.title,
    originalTitle:   work.originalTitle ?? null,
    normalizedTitle: work.normalizedTitle ?? '',
    type:            work.type,
    tmdbId:          work.tmdbId ?? null,
    source:          work.source,
    releaseYear:     work.releaseYear ?? null,
    roleName:        work.roleName ?? null,
    overview:        work.overview ?? null,
    posterUrl:       work.posterUrl ?? null,
    confidenceScore: String(work.confidenceScore ?? 0),
    status:          work.status ?? 'needs_review',
    deleted:         work.deleted ?? false,
    deletedAt:       work.deletedAt  ? new Date(work.deletedAt)  : null,
    deletedBy:       work.deletedBy  ?? null,
    checkedAt:       work.checkedAt  ? new Date(work.checkedAt)  : null,
    aiData,
    vodData,
    createdAt:       work.createdAt  ? new Date(work.createdAt)  : new Date(),
    updatedAt:       work.updatedAt  ? new Date(work.updatedAt)  : new Date(),
  };
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

function parseWork(v: unknown): WorkRecord | null {
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (obj && typeof obj === 'object' && 'id' in (obj as object)) return obj as WorkRecord;
    return null;
  } catch { return null; }
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis未接続' }, { status: 503 });
  }

  let personName: string;
  try {
    const body = (await req.json()) as { personName?: unknown };
    personName = typeof body.personName === 'string' ? body.personName.trim() : '';
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 });
  }

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  try {
    // ── Step 1: Redis から全作品取得 ──────────────────────────────────────────
    const raw = (await redis.hgetall(`works:${personName}`)) ?? {};
    const redisWorks: WorkRecord[] = [];
    for (const v of Object.values(raw)) {
      const w = parseWork(v);
      if (w) redisWorks.push(w);
    }

    // ── Step 2: DB から既存行を取得 ────────────────────────────────────────────
    interface DbRow { id: unknown; title: unknown; type: unknown; release_year: unknown; }
    const dbResult = await db.execute(sql`
      SELECT id, title, type, release_year
      FROM works
      WHERE person_name = ${personName}
    `);
    const dbRows = extractRows<DbRow>(dbResult);

    const dbIdSet = new Set<string>(dbRows.map((r) => String(r.id)));

    // 分類用ルックアップマップ（first-wins）
    const dbByTYT   = new Map<string, DbSummary>();
    const dbByTitle = new Map<string, DbSummary>();
    for (const r of dbRows) {
      const s: DbSummary = {
        workId:      String(r.id ?? ''),
        title:       String(r.title ?? ''),
        releaseYear: r.release_year != null ? Number(r.release_year) : null,
        workType:    String(r.type ?? ''),
      };
      const norm   = normTitle(s.title);
      const tytKey = `${norm}|${s.releaseYear ?? ''}|${s.workType}`;
      if (!dbByTYT.has(tytKey))   dbByTYT.set(tytKey, s);
      if (!dbByTitle.has(norm))    dbByTitle.set(norm, s);
    }

    // ── Step 3: 分類→INSERT ────────────────────────────────────────────────────
    let inserted = 0;
    let skipped  = 0;
    let failed   = 0;
    const failedIds: string[] = [];

    for (const work of redisWorks) {
      // ① DB に既に存在 → スキップ
      if (dbIdSet.has(work.id)) {
        skipped++;
        continue;
      }

      // ② 分類チェック — migrate のみ INSERT（他は絶対に登録しない）
      const cls = classify(work, dbByTYT, dbByTitle);
      if (cls !== 'migrate') {
        skipped++;
        continue;
      }

      // ③ INSERT（onConflictDoNothing = PK衝突時は何もしない）
      try {
        await db
          .insert(works)
          .values(workToRow(work, personName))
          .onConflictDoNothing();
        inserted++;

        // 登録済みとしてマップに追加（後続の重複判定に反映）
        const norm   = normTitle(work.title);
        const tytKey = `${norm}|${work.releaseYear ?? ''}|${work.type}`;
        const s: DbSummary = { workId: work.id, title: work.title, releaseYear: work.releaseYear ?? null, workType: work.type };
        if (!dbByTYT.has(tytKey))   dbByTYT.set(tytKey, s);
        if (!dbByTitle.has(norm))    dbByTitle.set(norm, s);
      } catch (err) {
        failed++;
        failedIds.push(work.id);
        console.error(`[db-migrate-person] INSERT失敗 ${personName}/${work.id}: ${String(err).slice(0, 200)}`);
      }
    }

    return NextResponse.json({ inserted, skipped, failed, failedIds });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 });
  }
}
