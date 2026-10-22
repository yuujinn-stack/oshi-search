import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  COLUMNS, INDEXES, TABLES, migrationStatements, preflightProblems, readState, undoStatements, verifyProblems, type Db,
} from '../../../scripts/price-review/setup-tables-core';

// 価格の確認待ちのテーブルだけを作る（scripts/price-review/setup-tables.ts の中身）。隔離した Postgres（PGlite）で実行。本番DBには接続しない。
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../drizzle/0020_price_reviews.sql'), 'utf8');

type PG = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown>; transaction: <T>(fn: (tx: PG) => Promise<T>) => Promise<T> };
let PGliteCtor: (new () => PG) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PGliteCtor = require('@electric-sql/pglite').PGlite;
} catch { /* 未導入 */ }

describe('マイグレーションの文の検査', () => {
  it('2テーブルの CREATE TABLE と 3つの CREATE INDEX（IF NOT EXISTS）だけ', () => {
    const s = migrationStatements(MIGRATION);
    expect(s.map((x) => x.split('(')[0].trim())).toEqual([
      'CREATE TABLE IF NOT EXISTS "price_reviews"',
      'CREATE UNIQUE INDEX IF NOT EXISTS "price_reviews_proposal_idx" ON "price_reviews"',
      'CREATE INDEX IF NOT EXISTS "price_reviews_status_idx" ON "price_reviews"',
      'CREATE TABLE IF NOT EXISTS "price_review_logs"',
      'CREATE INDEX IF NOT EXISTS "price_review_logs_created_at_idx" ON "price_review_logs"',
    ]);
  });
  it.each([
    ['他のテーブルの変更', 'ALTER TABLE products ADD COLUMN x text'],
    ['他のテーブルの作成', 'CREATE TABLE IF NOT EXISTS "unext_vod_reviews" (id int)'],
    ['削除', 'DROP TABLE products'],
    ['1つの区切りに複数の文', 'CREATE INDEX IF NOT EXISTS "a" ON "price_reviews" (id); DROP TABLE products'],
  ])('%s が混ざっていたら実行しない', (_l, extra) => {
    expect(() => migrationStatements(`${MIGRATION}\n--> statement-breakpoint\n${extra};`)).toThrow();
  });
});

describe.runIf(!!PGliteCtor)('作成・確認・取り消し（隔離した Postgres）', () => {
  let pg: PG;
  let db: Db;
  beforeEach(async () => {
    pg = new PGliteCtor!();
    await pg.exec(`
      CREATE TABLE products (person_name text NOT NULL, category text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), items jsonb NOT NULL DEFAULT '[]', PRIMARY KEY (person_name, category));
      CREATE TABLE verdicts (person_name text NOT NULL, product_id text NOT NULL, verdict text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (person_name, product_id));
      INSERT INTO products VALUES ('推しA', '写真集', '2026-01-01T00:00:00Z', '[{"id":"a","price":1000,"title":"A"}]');
      INSERT INTO verdicts VALUES ('推しA', 'a', 'related', '2026-01-01T00:00:00Z');`);
    const run = async (tx: PG, stmts: { text: string; params?: unknown[] }[]) => { const out = []; for (const s of stmts) out.push((await tx.query(s.text, s.params ?? [])).rows); return out; };
    db = {
      query: async (t, p = []) => (await pg.query(t, p)).rows,
      readOnly: (stmts) => pg.transaction(async (tx) => { await tx.query('SET TRANSACTION READ ONLY'); return run(tx, stmts); }),
      tx: async (stmts) => { await pg.transaction((tx) => run(tx, stmts)); },
    };
  });

  it('2テーブルと3インデックスだけを作り、既存の products・verdicts は変えない。2回実行しても同じ', async () => {
    const before = await readState(db);
    expect(before.tables).toEqual({ price_reviews: false, price_review_logs: false });
    expect(preflightProblems(before, { database: before.database })).toEqual([]);
    await db.tx(migrationStatements(MIGRATION).map((text) => ({ text })));
    await db.tx(migrationStatements(MIGRATION).map((text) => ({ text })));
    const after = await readState(db);
    expect(verifyProblems(after, before.fingerprint)).toEqual([]);
    expect(after.columns).toEqual(COLUMNS);
    expect(Object.keys(after.indexes)).toEqual([...INDEXES]);
    expect(after.rows).toEqual({ price_reviews: 0, price_review_logs: 0 });
    const tables = (await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows.map((r) => r.tablename);
    expect(tables).toEqual(['price_review_logs', 'price_reviews', 'products', 'verdicts']);
  });

  it('既存データが変わったら作成後の確認で分かる（指紋の確認が有効であること）', async () => {
    const before = await readState(db);
    await db.tx(migrationStatements(MIGRATION).map((text) => ({ text })));
    await pg.query(`UPDATE products SET items = '[{"id":"a","price":999,"title":"A"}]'`);
    expect(verifyProblems(await readState(db), before.fingerprint)).toContain('既存の products・verdicts の指紋が作成前と違う');
  });

  it('途中の文が失敗したら何も作らない（トランザクション）', async () => {
    const stmts = migrationStatements(MIGRATION).map((text) => ({ text }));
    await expect(db.tx([...stmts.slice(0, 2), { text: 'SELECT no_such_function()' }])).rejects.toThrow();
    expect((await readState(db)).tables).toEqual({ price_reviews: false, price_review_logs: false });
  });

  it('取り消しは2テーブルが空のときだけ（確認待ち・履歴があれば削除しない）', async () => {
    await db.tx(migrationStatements(MIGRATION).map((text) => ({ text })));
    await pg.query(`INSERT INTO price_review_logs (review_id, person_name, category, item_id, previous_price, fetched_price, action, performed_by) VALUES (1, '推しA', '写真集', 'a', 1000, 2000, 'rejected', 'x')`);
    expect(undoStatements(await readState(db)).problems).toHaveLength(1);
    await pg.query(`DELETE FROM price_review_logs`);
    const { stmts, problems } = undoStatements(await readState(db));
    expect(problems).toEqual([]);
    await db.tx(stmts);
    const s = await readState(db);
    expect(s.tables).toEqual({ price_reviews: false, price_review_logs: false });
    expect((await pg.query(`SELECT count(*)::int AS n FROM products`)).rows[0].n).toBe(1);
  });

  it('想定外の price_review* テーブルがあれば実行前の確認で止める', async () => {
    await pg.exec(`CREATE TABLE price_review_other (id int)`);
    expect(preflightProblems(await readState(db))).toEqual(['想定外のテーブルがある: price_review_other']);
  });

  it('作るテーブルの名前は2つだけ', () => {
    expect([...TABLES]).toEqual(['price_reviews', 'price_review_logs']);
  });
});
