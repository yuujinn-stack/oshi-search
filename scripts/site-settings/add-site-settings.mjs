// Task 203: 本番DBに site_settings テーブル「だけ」を追加する専用スクリプト（/admin/db-init は使わない）。
//
//   node scripts/site-settings/add-site-settings.mjs check   … 読み取りのみ（テーブルの有無・既存テーブルの定義と作品データの指紋を保存）
//   node scripts/site-settings/add-site-settings.mjs apply   … CREATE TABLE IF NOT EXISTS site_settings（この1文だけ）
//   node scripts/site-settings/add-site-settings.mjs verify  … 読み取りのみ（site_settings の定義・0行、既存の定義・作品データが check 時と同じか）
//
// 実行例（本番）:
//   cd ~/dev/oshi-search-work-image-d1 && set -a && source .env.local && set +a && node scripts/site-settings/add-site-settings.mjs check
//
// 安全性:
// ・実行する変更は CREATE TABLE IF NOT EXISTS 1文だけ。既存のテーブル・列・インデックス・行には触れない
//   （ALTER・UPDATE・DELETE・INSERT・DROP は無い）。何度実行しても同じ（IF NOT EXISTS）。
// ・行は入れない（空のまま）→ アプリは「従来画像表示」で動く。D-1 への切り替えは管理画面の保存で行う。
// ・新しいテーブルを作るだけなので既存テーブルのロックは取らない。念のため lock_timeout 5秒。
// ・指紋（check の結果）は SITE_SETTINGS_FP_DIR（既定 ~/dev-backup/2026-11-19-site-settings）に保存する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CREATE_SITE_SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

// 既存テーブルの定義（site_settings 以外の全テーブルの列・インデックス）の指紋
const CATALOG_SQL = `
SELECT
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'site_settings') AS tables,
  (SELECT md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), E'\\n' ORDER BY table_name, column_name), ''))
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'site_settings') AS columns_md5,
  (SELECT md5(coalesce(string_agg(indexdef, E'\\n' ORDER BY indexname), ''))
     FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'site_settings') AS indexes_md5`;

// 作品データ（works）の指紋。画像URL（poster/manual/og）と更新日時を含める
const WORKS_SQL = `
SELECT count(*)::int AS rows,
  md5(coalesce(string_agg(person_name || '|' || id || '|' || coalesce(poster_url, '') || '|' || coalesce(manual_image_url, '') || '|' || coalesce(og_image_url, '') || '|' || updated_at::text, E'\\n' ORDER BY person_name, id), '')) AS md5
FROM works`;

const SITE_SETTINGS_COLUMNS_SQL = `
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'site_settings'
ORDER BY ordinal_position`;

const EXPECTED_COLUMNS = [
  { column_name: 'key', data_type: 'text', is_nullable: 'NO' },
  { column_name: 'value', data_type: 'text', is_nullable: 'NO' },
  { column_name: 'updated_by', data_type: 'text', is_nullable: 'YES' },
  { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
];

/** db: { query(text) → rows[], transaction(texts[]) } */
export async function readState(db) {
  const [exists] = await db.query(`SELECT to_regclass('public.site_settings') IS NOT NULL AS exists`);
  const [catalog] = await db.query(CATALOG_SQL);
  const [works] = await db.query(WORKS_SQL);
  let siteSettings = null;
  if (exists.exists) {
    const columns = await db.query(SITE_SETTINGS_COLUMNS_SQL);
    const [cnt] = await db.query(`SELECT count(*)::int AS rows FROM site_settings`);
    const pk = await db.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'public.site_settings'::regclass AND i.indisprimary`);
    siteSettings = { columns, rows: cnt.rows, primaryKey: pk.map((r) => r.attname) };
  }
  return { siteSettings, catalog, works };
}

export async function apply(db) {
  await db.transaction([`SET LOCAL lock_timeout = '5s'`, CREATE_SITE_SETTINGS_SQL]);
}

export function judge(before, after) {
  const problems = [];
  const s = after.siteSettings;
  if (!s) problems.push('site_settings がありません');
  else {
    const cols = s.columns.map(({ column_name, data_type, is_nullable }) => ({ column_name, data_type, is_nullable }));
    if (JSON.stringify(cols) !== JSON.stringify(EXPECTED_COLUMNS)) problems.push(`site_settings の列が想定と違います: ${JSON.stringify(cols)}`);
    if (JSON.stringify(s.primaryKey) !== JSON.stringify(['key'])) problems.push(`主キーが想定と違います: ${JSON.stringify(s.primaryKey)}`);
    // check 時に既にテーブルがあった場合は行数を問わない（管理画面で保存済みの可能性）
    if (!before.siteSettings && s.rows !== 0) problems.push(`site_settings に行があります（${s.rows}行）`);
  }
  if (JSON.stringify(after.catalog) !== JSON.stringify(before.catalog)) problems.push('既存テーブルの定義（列・インデックス）が check 時と違います');
  if (JSON.stringify(after.works) !== JSON.stringify(before.works)) problems.push('作品データ（works）の指紋が check 時と違います（apply 中に管理画面・自動更新で作品が更新された可能性もあります）');
  return problems;
}

async function main() {
  const mode = process.argv[2];
  if (!['check', 'apply', 'verify'].includes(mode)) {
    console.error('使い方: node scripts/site-settings/add-site-settings.mjs check | apply | verify');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL がありません（.env.local を読み込んでください）');
    process.exit(1);
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const db = {
    query: (text) => sql.query(text),
    transaction: (texts) => sql.transaction(texts.map((t) => sql.query(t))),
  };
  const dir = process.env.SITE_SETTINGS_FP_DIR ?? path.join(os.homedir(), 'dev-backup', '2026-11-19-site-settings');
  const fpFile = path.join(dir, 'fingerprint-before.json');
  console.log(`DB: ${new URL(process.env.DATABASE_URL).host}`);

  if (mode === 'check') {
    const s = await readState(db);
    console.log(JSON.stringify(s, null, 1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fpFile, JSON.stringify(s));
    console.log(`指紋を保存しました: ${fpFile}`);
    console.log(s.siteSettings ? 'site_settings は既にあります（apply 不要）' : 'site_settings はまだありません → apply で追加できます');
  } else if (mode === 'apply') {
    if (!fs.existsSync(fpFile)) { console.error('先に check を実行してください'); process.exit(1); }
    await apply(db);
    console.log('CREATE TABLE IF NOT EXISTS site_settings を実行しました。続けて verify を実行してください');
  } else {
    if (!fs.existsSync(fpFile)) { console.error('先に check を実行してください'); process.exit(1); }
    const before = JSON.parse(fs.readFileSync(fpFile, 'utf8'));
    const after = await readState(db);
    console.log(JSON.stringify(after, null, 1));
    const problems = judge(before, after);
    if (problems.length === 0) console.log('OK: site_settings（4列・主キー key・0行）あり。既存テーブルの定義・作品データは check 時と同じです');
    else for (const p of problems) console.log(`NG: ${p}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
