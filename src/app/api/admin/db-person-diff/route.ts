// 人物別 Redis ↔ DB 差分調査 API（読み取り専用）
// DB・Redis のデータを変更しない。DELETE/INSERT は行わない。
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';

// ── 型定義 ───────────────────────────────────────────────────────────────────

export type Classification =
  | 'dup_title_year'   // DBに同タイトル+年+種別が別workIdで存在
  | 'dup_title_only'   // DBに同タイトルが異なる年で存在
  | 'deleted'          // Redisで論理削除済み
  | 'suspect'          // 非表示・別人候補
  | 'migrate'          // DB未登録の移行候補
  | 'unknown';         // 判定不能（sourceなし等）

export interface WorkSummary {
  workId: string;
  title: string;
  releaseYear: number | null;
  workType: string;
  source: string;
  status: string;
  roleName: string | null;
  deleted: boolean;
}

export interface ClassifiedWork extends WorkSummary {
  classification: Classification;
  classificationNote: string;
  dupWorkId?: string;
}

export interface PersonCountRow {
  personName: string;
  redisCount: number;
  dbCount: number;
  diff: number; // db - redis: 負 = Redis が多い
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

function parseWork(v: unknown): WorkRecord | null {
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (obj && typeof obj === 'object' && 'id' in (obj as object)) return obj as WorkRecord;
    return null;
  } catch { return null; }
}

function normTitle(t: string): string {
  return t.replace(/[\s　]+/g, ' ').trim().toLowerCase();
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

// ── 分類ロジック ──────────────────────────────────────────────────────────────

function classify(
  work: WorkRecord,
  dbByTYT: Map<string, WorkSummary>,   // title+year+type → WorkSummary
  dbByTitle: Map<string, WorkSummary>, // normTitle → WorkSummary
): { classification: Classification; note: string; dupWorkId?: string } {
  // 1. Redisで論理削除済み
  if (work.deleted) {
    return { classification: 'deleted', note: 'Redisで論理削除済み (deleted=true)' };
  }

  const norm = normTitle(work.title);
  const tytKey = `${norm}|${work.releaseYear ?? ''}|${work.type}`;

  // 2. DBに同タイトル+年+種別が別workIdで存在
  const dupByTYT = dbByTYT.get(tytKey);
  if (dupByTYT) {
    return {
      classification: 'dup_title_year',
      note: `DBに同タイトル・同年・同種別が別workIdで存在`,
      dupWorkId: dupByTYT.workId,
    };
  }

  // 3. DBに同タイトル（年が異なる）が存在
  const dupByTitle = dbByTitle.get(norm);
  if (dupByTitle) {
    const yr = `Redis年=${work.releaseYear ?? 'null'} DB年=${dupByTitle.releaseYear ?? 'null'}`;
    return {
      classification: 'dup_title_only',
      note: `DBに同タイトルが異なる年で存在 (${yr})`,
      dupWorkId: dupByTitle.workId,
    };
  }

  // 4. 非表示・別人候補
  if (work.status === 'hidden' || work.aiSamePerson === false) {
    return {
      classification: 'suspect',
      note: `非表示・別人候補 (status=${work.status}, aiSamePerson=${work.aiSamePerson ?? 'undefined'})`,
    };
  }

  // 5. sourceが空 → db-patch-works フィルタでスキップされる
  if (!work.source) {
    return {
      classification: 'unknown',
      note: 'sourceが空文字 — db-patch-works の移行フィルタ (work.source) でスキップされる可能性あり',
    };
  }

  // 6. DB未登録の移行候補
  return {
    classification: 'migrate',
    note: `DB未登録 (source=${work.source}, status=${work.status})`,
  };
}

// ── DB: 1人物の全作品取得 ──────────────────────────────────────────────────

interface DbWorkRow {
  id: unknown;
  title: unknown;
  type: unknown;
  release_year: unknown;
  source: unknown;
  status: unknown;
  deleted: unknown;
  role_name: unknown;
}

async function fetchDbWorksForPerson(personName: string): Promise<WorkSummary[]> {
  const result = await db.execute(sql`
    SELECT id, title, type, release_year, source, status, deleted, role_name
    FROM works
    WHERE person_name = ${personName}
    ORDER BY id
  `);
  return extractRows<DbWorkRow>(result).map((r) => ({
    workId:      String(r.id ?? ''),
    title:       String(r.title ?? ''),
    releaseYear: r.release_year != null ? Number(r.release_year) : null,
    workType:    String(r.type ?? ''),
    source:      String(r.source ?? ''),
    status:      String(r.status ?? ''),
    roleName:    r.role_name != null ? String(r.role_name) : null,
    deleted:     r.deleted === true || r.deleted === 't' || r.deleted === '1',
  }));
}

// ── 全人物スキャン ────────────────────────────────────────────────────────────

async function getAllPersonsDiff(
  redis: NonNullable<ReturnType<typeof getRedis>>,
): Promise<PersonCountRow[]> {
  // works:* キーを全スキャン
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
  } while (cursor !== 0 && guard < 300);

  // Redis hlen をパイプラインで取得
  const redisByPerson = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const pipe = redis.pipeline();
    for (const k of chunk) pipe.hlen(k);
    const lens = (await pipe.exec()) as number[];
    for (let j = 0; j < chunk.length; j++) {
      redisByPerson.set(chunk[j].slice('works:'.length), lens[j] ?? 0);
    }
  }

  // DB 件数を人物別に取得
  const dbResult = await db.execute(sql`
    SELECT person_name, count(*)::int AS n FROM works GROUP BY person_name
  `);
  const dbByPerson = new Map<string, number>();
  for (const row of extractRows<{ person_name: unknown; n: unknown }>(dbResult)) {
    dbByPerson.set(String(row.person_name), Number(row.n));
  }

  // 不一致のみリストアップ
  const result: PersonCountRow[] = [];
  const allNames = new Set([...redisByPerson.keys(), ...dbByPerson.keys()]);
  for (const name of allNames) {
    const r = redisByPerson.get(name) ?? 0;
    const d = dbByPerson.get(name) ?? 0;
    if (r !== d) result.push({ personName: name, redisCount: r, dbCount: d, diff: d - r });
  }
  // diff 昇順（Redis > DB が上位）
  result.sort((a, b) => a.diff - b.diff);
  return result;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis未接続 — 環境変数を確認してください' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const personName = searchParams.get('person') ?? '';

  try {
    // ── 全人物モード ────────────────────────────────────────────────────────
    if (!personName) {
      const persons = await getAllPersonsDiff(redis);
      return NextResponse.json({
        mode: 'all',
        persons,
        redisMajority: persons.filter((p) => p.diff < 0).length,
        dbMajority:    persons.filter((p) => p.diff > 0).length,
      });
    }

    // ── 人物詳細モード ──────────────────────────────────────────────────────
    const raw = (await redis.hgetall(`works:${personName}`)) ?? {};
    const redisRawCount = Object.keys(raw).length;

    const redisWorks: WorkRecord[] = [];
    const parseErrors: string[] = [];
    for (const [wid, v] of Object.entries(raw)) {
      const w = parseWork(v);
      if (w) redisWorks.push(w);
      else   parseErrors.push(wid);
    }

    const dbWorks = await fetchDbWorksForPerson(personName);
    const dbById  = new Map<string, WorkSummary>(dbWorks.map((w) => [w.workId, w]));

    // DB側ルックアップマップ（first-wins）
    const dbByTYT:   Map<string, WorkSummary> = new Map();
    const dbByTitle: Map<string, WorkSummary> = new Map();
    for (const w of dbWorks) {
      const norm   = normTitle(w.title);
      const tytKey = `${norm}|${w.releaseYear ?? ''}|${w.workType}`;
      if (!dbByTYT.has(tytKey))   dbByTYT.set(tytKey, w);
      if (!dbByTitle.has(norm))    dbByTitle.set(norm, w);
    }

    const redisOnly: ClassifiedWork[] = [];
    let matchedCount = 0;

    for (const w of redisWorks) {
      if (dbById.has(w.id)) {
        matchedCount++;
      } else {
        const { classification, note, dupWorkId } = classify(w, dbByTYT, dbByTitle);
        redisOnly.push({
          workId:             w.id,
          title:              w.title,
          releaseYear:        w.releaseYear ?? null,
          workType:           w.type,
          source:             w.source ?? '',
          status:             w.status,
          roleName:           w.roleName ?? null,
          deleted:            w.deleted ?? false,
          classification,
          classificationNote: note,
          dupWorkId,
        });
      }
    }

    // DBのみ（DBにあってRedisにない）
    const redisIdSet = new Set(redisWorks.map((w) => w.id));
    const dbOnly = dbWorks.filter((w) => !redisIdSet.has(w.workId));

    // 分類順でソート
    const classOrder: Record<Classification, number> = {
      dup_title_year: 0, dup_title_only: 1, suspect: 2, unknown: 3, migrate: 4, deleted: 5,
    };
    redisOnly.sort(
      (a, b) =>
        classOrder[a.classification] - classOrder[b.classification] ||
        a.title.localeCompare(b.title, 'ja'),
    );

    // 分類別集計
    const classSummary: Record<string, number> = {};
    for (const w of redisOnly) classSummary[w.classification] = (classSummary[w.classification] ?? 0) + 1;

    return NextResponse.json({
      mode:         'person',
      personName,
      redisRawCount,
      redisParseOk: redisWorks.length,
      dbTotal:      dbWorks.length,
      matchedCount,
      redisOnly,
      dbOnly,
      classSummary,
      parseErrors,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 });
  }
}
