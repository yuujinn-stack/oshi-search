import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

// 各テーブルの CREATE TABLE IF NOT EXISTS を個別に実行する
const DDL_STATEMENTS = [
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

const TABLE_NAMES = ['persons', 'person_meta', 'group_meta', 'vod_providers', 'works', 'products', 'verdicts'];

async function getTableCounts(): Promise<Record<string, number | string>> {
  const counts: Record<string, number | string> = {};
  for (const t of TABLE_NAMES) {
    try {
      const result = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ${t}`));
      const rows = result as unknown as Array<{ cnt: string }>;
      counts[t] = Number(rows[0]?.cnt ?? 0);
    } catch (e) {
      counts[t] = `missing (${String(e).slice(0, 80)})`;
    }
  }
  return counts;
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  }
  const counts = await getTableCounts();
  return NextResponse.json({ counts });
}

export async function POST() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  }
  const errors: string[] = [];
  for (const stmt of DDL_STATEMENTS) {
    try {
      await db.execute(stmt);
    } catch (e) {
      errors.push(String(e).slice(0, 120));
    }
  }
  const counts = await getTableCounts();
  return NextResponse.json({ ok: errors.length === 0, errors, counts });
}
