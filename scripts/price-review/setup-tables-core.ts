// 価格の確認待ちのテーブル（price_reviews・price_review_logs）だけを作る処理の中身（scripts/price-review/setup-tables.ts から使う）。
// /admin/db-init は全テーブルの CREATE・ALTER（約150文）を毎回実行するため、今回は使わず、
// drizzle/0020_price_reviews.sql の文だけを1つのトランザクションで実行する。既存のテーブル・データ・権限は変えない。

export interface Stmt { text: string; params?: unknown[] }
export interface Db {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** 読み取り専用のトランザクションで実行（確認用） */
  readOnly(stmts: Stmt[]): Promise<Record<string, unknown>[][]>;
  /** 1つのトランザクションで実行（どれかが失敗したら何も適用しない） */
  tx(stmts: Stmt[]): Promise<void>;
}

export const TABLES = ['price_reviews', 'price_review_logs'] as const;
export const INDEXES = ['price_reviews_proposal_idx', 'price_reviews_status_idx', 'price_review_logs_created_at_idx'] as const;
export const COLUMNS: Record<(typeof TABLES)[number], string[]> = {
  price_reviews: ['id', 'person_name', 'category', 'item_id', 'previous_price', 'fetched_price', 'change_rate', 'reason', 'fetched_at_ms', 'item_identity', 'item_title', 'status', 'first_seen_at', 'updated_at', 'decided_by', 'decided_at'],
  price_review_logs: ['id', 'review_id', 'person_name', 'category', 'item_id', 'item_title', 'previous_price', 'fetched_price', 'action', 'performed_by', 'note', 'created_at'],
};

/** マイグレーションの文を取り出し、2テーブルの CREATE TABLE / CREATE INDEX（IF NOT EXISTS）以外が1つでもあれば拒否する */
export function migrationStatements(sqlText: string): string[] {
  const stmts = sqlText.split('--> statement-breakpoint')
    .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, ''))
    .filter(Boolean);
  const target = `"(?:${TABLES.join('|')})"`;
  const allowed = [
    new RegExp(`^CREATE TABLE IF NOT EXISTS ${target} \\(`),
    new RegExp(`^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "\\w+" ON ${target} \\(`),
  ];
  for (const s of stmts) {
    if (s.includes(';')) throw new Error(`1つの区切りに複数の文があります: ${s.slice(0, 60)}`);
    if (!allowed.some((re) => re.test(s))) throw new Error(`許可していない文です（2テーブルの作成とインデックスだけを実行します）: ${s.slice(0, 80)}`);
    if (/\b(DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/i.test(s)) throw new Error(`許可していない語が含まれています: ${s.slice(0, 80)}`);
  }
  if (stmts.length !== TABLES.length + INDEXES.length) throw new Error(`文の数が想定（${TABLES.length + INDEXES.length}）と違います: ${stmts.length}`);
  return stmts;
}

/** 既存データの指紋（products・verdicts の全行。DB 側で計算し、転送はごくわずか）。作成の前後で同じなら既存データは不変 */
export const FINGERPRINT_SQL = `SELECT
  (SELECT count(*)::int FROM products) AS products_rows,
  (SELECT md5(coalesce(string_agg(person_name || '|' || category || '|' || fetched_at::text || '|' || md5(items::text), ',' ORDER BY person_name, category), '')) FROM products) AS products_hash,
  (SELECT count(*)::int FROM verdicts) AS verdicts_rows,
  (SELECT md5(coalesce(string_agg(person_name || '|' || product_id || '|' || verdict || '|' || coalesce(updated_at::text, ''), ',' ORDER BY person_name, product_id), '')) FROM verdicts) AS verdicts_hash`;

export interface State {
  user: string;
  database: string;
  tables: Record<string, boolean>;
  indexes: Record<string, boolean>;
  columns: Record<string, string[]>;
  /** price_review で始まる、想定外のテーブル */
  unexpectedTables: string[];
  rows: Record<string, number | null>;
  fingerprint: Record<string, unknown>;
}

/** 現在の状態（読み取り専用のトランザクション） */
export async function readState(db: Db): Promise<State> {
  const [who, t, i, c, fp] = await db.readOnly([
    { text: `SELECT current_user::text AS u, current_database()::text AS d` },
    { text: `SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'price\\_review%'` },
    { text: `SELECT indexname::text AS i FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)`, params: [[...TABLES]] },
    { text: `SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name, ordinal_position`, params: [[...TABLES]] },
    { text: FINGERPRINT_SQL },
  ]);
  const existing = new Set(t.map((r) => String(r.t)));
  const idx = new Set(i.map((r) => String(r.i)));
  const columns: Record<string, string[]> = {};
  for (const r of c) (columns[String(r.t)] ??= []).push(String(r.c));
  const rows: Record<string, number | null> = {};
  for (const name of TABLES) {
    rows[name] = existing.has(name) ? Number((await db.readOnly([{ text: `SELECT count(*)::int AS n FROM ${name}` }]))[0][0].n) : null;
  }
  return {
    user: String(who[0].u), database: String(who[0].d),
    tables: Object.fromEntries(TABLES.map((n) => [n, existing.has(n)])),
    indexes: Object.fromEntries(INDEXES.map((n) => [n, idx.has(n)])),
    columns,
    unexpectedTables: [...existing].filter((n) => !(TABLES as readonly string[]).includes(n)),
    rows,
    fingerprint: fp[0],
  };
}

/** 作成前の確認：問題があれば理由を返す（読み取りのみ） */
export function preflightProblems(s: State, expect: { user?: string; database?: string } = {}): string[] {
  const p: string[] = [];
  if (expect.user && s.user !== expect.user) p.push(`接続ユーザーが ${expect.user} ではない（${s.user}）`);
  if (expect.database && s.database !== expect.database) p.push(`データベースが ${expect.database} ではない（${s.database}）`);
  if (s.unexpectedTables.length) p.push(`想定外のテーブルがある: ${s.unexpectedTables.join(', ')}`);
  return p;
}

/** 作成後の確認（列・インデックスが想定どおり・既存データの指紋が作成前と同じ） */
export function verifyProblems(s: State, before?: Record<string, unknown>): string[] {
  const p: string[] = [];
  for (const t of TABLES) {
    if (!s.tables[t]) { p.push(`${t} がない`); continue; }
    if (JSON.stringify(s.columns[t] ?? []) !== JSON.stringify(COLUMNS[t])) p.push(`${t} の列が想定と違う: ${(s.columns[t] ?? []).join(',')}`);
  }
  for (const i of INDEXES) if (!s.indexes[i]) p.push(`インデックス ${i} がない`);
  if (before && JSON.stringify(before) !== JSON.stringify(s.fingerprint)) p.push('既存の products・verdicts の指紋が作成前と違う');
  return p;
}

/** 取り消し：2テーブルが空のときだけ削除する（確認待ち・履歴のデータがあれば削除しない） */
export function undoStatements(s: State): { stmts: Stmt[]; problems: string[] } {
  const problems = TABLES.filter((t) => (s.rows[t] ?? 0) > 0).map((t) => `${t} に ${s.rows[t]} 行あるため削除しません（必要なら先に内容を保存してください）`);
  return { problems, stmts: problems.length ? [] : [{ text: 'DROP TABLE IF EXISTS price_review_logs' }, { text: 'DROP TABLE IF EXISTS price_reviews' }] };
}
