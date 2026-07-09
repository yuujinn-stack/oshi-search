// works テーブルの Redis ↔ DB 差分詳細調査 API（読み取り専用）
// DELETE / TRUNCATE / DROP は一切使わない
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const MAX_ENTRIES = 200;

// ── 型定義 ──────────────────────────────────────────────────────────────────

interface WorkEntry {
  personName: string;
  workId: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  source: string;
  status: string;
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PersonCount { personName: string; count: number; }

interface DbOnlyAnalysis {
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  byPerson: PersonCount[];
  deletedCount: number;
  totalCount: number;
  verdict: 'normal' | 'likely-normal' | 'suspicious' | 'unknown';
  verdictNote: string;
}

interface DiffSummary {
  dbTotal: number;
  redisTotal: number;
  dbOnlyCount: number;
  redisOnlyCount: number;
  truncatedAt: number;
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

function toStr(v: unknown): string { return typeof v === 'string' ? v : String(v ?? ''); }
function toNum(v: unknown): number | null {
  const n = Number(v);
  return isNaN(n) || v === null || v === '' ? null : n;
}
function toBool(v: unknown): boolean { return v === true || v === 't' || v === '1'; }
function toDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

// ── 起源分析 ────────────────────────────────────────────────────────────────

const KNOWN_SOURCES = new Set([
  'tmdb', 'tmdb-import', 'csv', 'csv-import',
  'manual', 'work-vod-import', 'ai-import', 'batch',
]);

function analyzeDbOnly(entries: WorkEntry[]): DbOnlyAnalysis {
  const totalCount = entries.length;

  if (totalCount === 0) {
    return {
      bySource: {}, byStatus: {}, byPerson: [],
      deletedCount: 0, totalCount: 0,
      verdict: 'normal', verdictNote: 'DB のみエントリなし',
    };
  }

  // ソース集計
  const bySource: Record<string, number> = {};
  for (const e of entries) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  }

  // ステータス集計
  const byStatus: Record<string, number> = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  }

  // 人物別集計
  const personMap = new Map<string, number>();
  for (const e of entries) {
    personMap.set(e.personName, (personMap.get(e.personName) ?? 0) + 1);
  }
  const byPerson: PersonCount[] = [...personMap.entries()]
    .map(([personName, count]) => ({ personName, count }))
    .sort((a, b) => b.count - a.count);

  const deletedCount = entries.filter((e) => e.deleted).length;

  // ソースの正当性
  const knownSourceCount = entries.filter((e) => KNOWN_SOURCES.has(e.source)).length;
  const knownSourceRatio = knownSourceCount / totalCount;

  // 削除済み割合
  const deletedRatio = deletedCount / totalCount;

  // テスト的タイトルの有無
  const testTitleCount = entries.filter((e) =>
    /^(test|テスト|dummy|sample|サンプル)/i.test(e.title),
  ).length;

  let verdict: DbOnlyAnalysis['verdict'];
  let verdictNote: string;

  if (deletedRatio > 0.5) {
    verdict = 'suspicious';
    verdictNote =
      `deleted=true が ${deletedCount}/${totalCount} 件（${Math.round(deletedRatio * 100)}%）。` +
      `Redis 側で削除済みの作品が DB に残っている可能性。手動確認を推奨。`;
  } else if (testTitleCount > 0) {
    verdict = 'suspicious';
    verdictNote =
      `タイトルが test/テスト/dummy 等で始まるエントリが ${testTitleCount} 件。テストデータの可能性あり。`;
  } else if (knownSourceRatio >= 0.9) {
    verdict = 'normal';
    verdictNote =
      `ソース ${Math.round(knownSourceRatio * 100)}% が正規（${Object.keys(bySource).join(', ')}）。` +
      `dual-write の Redis 側未書き込み、または DB 側の VOD 更新等による追加と考えられます。削除不要。`;
  } else if (knownSourceRatio >= 0.6) {
    verdict = 'likely-normal';
    verdictNote =
      `ソースの ${Math.round(knownSourceRatio * 100)}% が正規。一部不明ソースあり（${
        Object.keys(bySource).filter((s) => !KNOWN_SOURCES.has(s)).join(', ')
      }）。概ね正常データとみなせます。`;
  } else {
    verdict = 'unknown';
    verdictNote = `ソースが不明または多様。手動で内容を確認してください。`;
  }

  return { bySource, byStatus, byPerson, deletedCount, totalCount, verdict, verdictNote };
}

// ── Redis ヘルパー ────────────────────────────────────────────────────────────

async function buildRedisWorkSet(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<{ set: Set<string>; total: number }> {
  const keys: string[] = [];
  let cursor = 0;
  let guard = 0;
  do {
    const scanResult = await redis.scan(cursor, { match: 'works:*', count: 200 });
    if (!Array.isArray(scanResult) || scanResult.length < 2) break;
    cursor = Number(scanResult[0]);
    const batch = scanResult[1];
    if (Array.isArray(batch)) keys.push(...(batch as string[]));
    guard++;
  } while (cursor !== 0 && guard < 100);

  const set = new Set<string>();
  let total = 0;
  const BATCH = 50;

  for (let start = 0; start < keys.length; start += BATCH) {
    const chunk = keys.slice(start, start + BATCH);
    const results = await Promise.all(
      chunk.map((k) => redis.hkeys(k).catch(() => [] as string[])),
    );
    for (let i = 0; i < chunk.length; i++) {
      const personName = chunk[i].slice('works:'.length);
      const workIds = results[i] as string[];
      total += workIds.length;
      for (const workId of workIds) {
        set.add(`${personName}::${workId}`);
      }
    }
  }

  return { set, total };
}

// ── DB ヘルパー ───────────────────────────────────────────────────────────────

interface DbRow {
  person_name: unknown;
  id: unknown;
  title: unknown;
  type: unknown;
  release_year: unknown;
  source: unknown;
  status: unknown;
  deleted: unknown;
  created_at: unknown;
  updated_at: unknown;
}

async function fetchAllDbWorks(): Promise<Map<string, WorkEntry>> {
  const result = await db.execute(sql`
    SELECT
      person_name, id, title, type, release_year,
      source, status, deleted, created_at, updated_at
    FROM works
    ORDER BY person_name, id
  `);
  const rows = extractRows<DbRow>(result);
  const map = new Map<string, WorkEntry>();
  for (const r of rows) {
    const personName = toStr(r.person_name);
    const workId     = toStr(r.id);
    map.set(`${personName}::${workId}`, {
      personName,
      workId,
      title:       toStr(r.title),
      workType:    toStr(r.type),
      releaseYear: toNum(r.release_year),
      source:      toStr(r.source),
      status:      toStr(r.status),
      deleted:     toBool(r.deleted),
      createdAt:   toDate(r.created_at),
      updatedAt:   toDate(r.updated_at),
    });
  }
  return map;
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

    // Stage 1: DB 全作品取得
    let dbMap: Map<string, WorkEntry>;
    try {
      dbMap = await fetchAllDbWorks();
      console.log(`[db-diff-works] DB: ${dbMap.size}件`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      return NextResponse.json({ error: `DB クエリエラー: ${msg}` }, { status: 500 });
    }

    // Stage 2: Redis work ID セット構築（hkeys のみ — 値は不要）
    let redisSet: Set<string>;
    let redisTotal: number;
    try {
      const r = await buildRedisWorkSet(redis);
      redisSet = r.set;
      redisTotal = r.total;
      console.log(`[db-diff-works] Redis: ${redisTotal}件`);
    } catch (err) {
      const msg = String(err).slice(0, 200);
      return NextResponse.json({ error: `Redis エラー: ${msg}` }, { status: 500 });
    }

    // Stage 3: 差分計算
    const dbOnly: WorkEntry[] = [];
    const redisOnly: Array<{ personName: string; workId: string }> = [];

    for (const [key, entry] of dbMap.entries()) {
      if (!redisSet.has(key)) dbOnly.push(entry);
    }
    for (const key of redisSet) {
      if (!dbMap.has(key)) {
        const sep = key.indexOf('::');
        if (sep >= 0) {
          redisOnly.push({ personName: key.slice(0, sep), workId: key.slice(sep + 2) });
        }
      }
    }

    // 人物名 → ID の順でソート
    dbOnly.sort((a, b) => a.personName.localeCompare(b.personName, 'ja') || a.workId.localeCompare(b.workId));
    redisOnly.sort((a, b) => a.personName.localeCompare(b.personName, 'ja') || a.workId.localeCompare(b.workId));

    // Stage 4: 起源分析
    const dbOnlyAnalysis = analyzeDbOnly(dbOnly);

    return NextResponse.json({
      summary: {
        dbTotal: dbMap.size,
        redisTotal,
        dbOnlyCount: dbOnly.length,
        redisOnlyCount: redisOnly.length,
        truncatedAt: MAX_ENTRIES,
      } satisfies DiffSummary,
      dbOnlyAnalysis,
      dbOnly:    dbOnly.slice(0, MAX_ENTRIES),
      redisOnly: redisOnly.slice(0, MAX_ENTRIES),
    });
  } catch (outerErr) {
    const msg = String(outerErr).slice(0, 300);
    console.error('[db-diff-works] 予期しないエラー:', msg);
    return NextResponse.json({ error: `予期しないエラー: ${msg}` }, { status: 500 });
  }
}
