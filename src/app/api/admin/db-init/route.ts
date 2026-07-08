import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

// ── CREATE TABLE IF NOT EXISTS ────────────────────────────────────────────────
const CREATE_STATEMENTS = [
  sql`CREATE TABLE IF NOT EXISTS persons (
    name                TEXT PRIMARY KEY,
    group_name          TEXT NOT NULL DEFAULT '',
    genre               TEXT NOT NULL DEFAULT '坂道',
    aliases             JSONB NOT NULL DEFAULT '[]',
    tmdb_person_id      INTEGER,
    description         TEXT,
    source              TEXT NOT NULL DEFAULT 'static',
    data_fetch_status   TEXT NOT NULL DEFAULT 'not_started',
    last_data_fetched_at TIMESTAMPTZ,
    data_fetch_error    TEXT,
    imported_at         TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    config              JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE TABLE IF NOT EXISTS person_meta (
    person_name         TEXT PRIMARY KEY,
    activity_status     TEXT,
    generation          TEXT,
    titles              JSONB,
    current_group_name  TEXT,
    joined_at           TEXT,
    left_at             TEXT,
    former_group_names  JSONB,
    membership_note     TEXT,
    primary_genre       TEXT,
    genres              JSONB,
    public_roles        JSONB,
    awards              JSONB,
    career_status       TEXT,
    role_note           TEXT,
    memo                TEXT,
    priority            TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE TABLE IF NOT EXISTS group_meta (
    group_name      TEXT PRIMARY KEY,
    slug            TEXT NOT NULL DEFAULT '',
    activity_status TEXT NOT NULL DEFAULT 'unknown',
    formed_at       TEXT,
    ended_at        TEXT,
    renamed_from    TEXT,
    renamed_to      TEXT,
    former_names    JSONB NOT NULL DEFAULT '[]',
    official_site   TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE TABLE IF NOT EXISTS vod_providers (
    slug       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    logo_url   TEXT NOT NULL DEFAULT '',
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  sql`CREATE TABLE IF NOT EXISTS works (
    id               TEXT NOT NULL,
    person_name      TEXT NOT NULL,
    title            TEXT NOT NULL,
    original_title   TEXT,
    normalized_title TEXT NOT NULL DEFAULT '',
    type             TEXT NOT NULL,
    tmdb_id          INTEGER,
    source           TEXT NOT NULL,
    release_year     INTEGER,
    role_name        TEXT,
    overview         TEXT,
    poster_url       TEXT,
    confidence_score NUMERIC NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'needs_review',
    deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    deleted_by       TEXT,
    checked_at       TIMESTAMPTZ,
    ai_data          JSONB NOT NULL DEFAULT '{}',
    vod_data         JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (person_name, id)
  )`,
  sql`CREATE INDEX IF NOT EXISTS works_status_idx ON works (status)`,
  sql`CREATE TABLE IF NOT EXISTS products (
    person_name TEXT NOT NULL,
    category    TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    items       JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (person_name, category)
  )`,
  sql`CREATE INDEX IF NOT EXISTS products_person_name_idx ON products (person_name)`,
  sql`CREATE TABLE IF NOT EXISTS verdicts (
    person_name    TEXT NOT NULL,
    product_id     TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    score          NUMERIC NOT NULL DEFAULT 0,
    source         TEXT NOT NULL,
    reason         TEXT,
    prompt_version TEXT,
    judged_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (person_name, product_id)
  )`,
  sql`CREATE INDEX IF NOT EXISTS verdicts_person_name_idx ON verdicts (person_name)`,
];

// ── ALTER TABLE ADD COLUMN IF NOT EXISTS ─────────────────────────────────────
// 既存テーブルに後から追加されたカラムを安全に追加する。
// DROP / TRUNCATE / DELETE は一切使わない。既存データは変更しない。
// すべて NULLABLE または DEFAULT 付きのため既存行に影響なし。
const ALTER_STATEMENTS = [
  // ── persons ────────────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT ''`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS genre TEXT NOT NULL DEFAULT '坂道'`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS tmdb_person_id INTEGER`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS description TEXT`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'static'`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS data_fetch_status TEXT NOT NULL DEFAULT 'not_started'`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS last_data_fetched_at TIMESTAMPTZ`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS data_fetch_error TEXT`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),
  sql.raw(`ALTER TABLE persons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),

  // ── person_meta ────────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS activity_status TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS generation TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS titles JSONB`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS current_group_name TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS joined_at TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS left_at TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS former_group_names JSONB`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS membership_note TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS primary_genre TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS genres JSONB`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS public_roles JSONB`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS awards JSONB`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS career_status TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS role_note TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS memo TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS priority TEXT`),
  sql.raw(`ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),

  // ── group_meta ─────────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT ''`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS activity_status TEXT NOT NULL DEFAULT 'unknown'`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS formed_at TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS ended_at TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS renamed_from TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS renamed_to TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS former_names JSONB NOT NULL DEFAULT '[]'`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS official_site TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS note TEXT`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),
  sql.raw(`ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),

  // ── vod_providers ──────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE vod_providers ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`),
  sql.raw(`ALTER TABLE vod_providers ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT ''`),
  sql.raw(`ALTER TABLE vod_providers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`),
  sql.raw(`ALTER TABLE vod_providers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),
  sql.raw(`ALTER TABLE vod_providers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),

  // ── works ──────────────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS original_title TEXT`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS normalized_title TEXT NOT NULL DEFAULT ''`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS tmdb_id INTEGER`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS release_year INTEGER`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS role_name TEXT`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS overview TEXT`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS poster_url TEXT`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS confidence_score NUMERIC NOT NULL DEFAULT 0`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'needs_review'`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_by TEXT`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS ai_data JSONB NOT NULL DEFAULT '{}'`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS vod_data JSONB NOT NULL DEFAULT '{}'`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),
  sql.raw(`ALTER TABLE works ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),

  // ── verdicts ───────────────────────────────────────────────────────────────
  sql.raw(`ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS reason TEXT`),
  sql.raw(`ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS prompt_version TEXT`),
  sql.raw(`ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`),
];

const TABLE_NAMES = ['persons', 'person_meta', 'group_meta', 'vod_providers', 'works', 'products', 'verdicts'];

async function getTableCounts(): Promise<Record<string, number | string>> {
  const counts: Record<string, number | string> = {};
  for (const t of TABLE_NAMES) {
    try {
      const result = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ${t}`));
      const rows = result as unknown as Array<{ cnt: string }>;
      counts[t] = Number(rows[0]?.cnt ?? 0);
    } catch (e) {
      counts[t] = `error: ${String(e).slice(0, 80)}`;
    }
  }
  return counts;
}

// information_schema から各テーブルの実カラム一覧を取得する
async function getExistingColumns(): Promise<Record<string, string[]>> {
  try {
    const result = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY['persons','person_meta','group_meta','vod_providers','works','products','verdicts'])
      ORDER BY table_name, ordinal_position
    `);
    const rows = result as unknown as Array<{ table_name: string; column_name: string }>;
    const map: Record<string, string[]> = {};
    for (const r of rows) {
      if (!map[r.table_name]) map[r.table_name] = [];
      map[r.table_name].push(r.column_name);
    }
    return map;
  } catch {
    return {};
  }
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  }
  const [counts, columns] = await Promise.all([getTableCounts(), getExistingColumns()]);
  return NextResponse.json({ counts, columns });
}

export async function POST() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  }

  const createErrors: string[] = [];
  for (const stmt of CREATE_STATEMENTS) {
    try {
      await db.execute(stmt);
    } catch (e) {
      createErrors.push(String(e).slice(0, 120));
    }
  }

  const alterErrors: string[] = [];
  for (const stmt of ALTER_STATEMENTS) {
    try {
      await db.execute(stmt);
    } catch (e) {
      // カラムが既に存在する場合は IF NOT EXISTS で無視されるため、ここに来るのは本当のエラーのみ
      alterErrors.push(String(e).slice(0, 120));
    }
  }

  const counts = await getTableCounts();
  return NextResponse.json({
    ok:           createErrors.length === 0 && alterErrors.length === 0,
    createErrors,
    alterErrors,
    counts,
  });
}
