// 楽天イベント管理のテーブル（rakuten_events・rakuten_event_products）だけを本番DBに作る・確認する・取り消す。
// /admin/db-init は使わない（全テーブルの CREATE・ALTER を毎回実行するため）。drizzle/0022_rakuten_events.sql の文だけを実行する。
//
//   npx tsx scripts/rakuten-events/setup-tables.ts check    … 実行前の確認（読み取りのみ。実行する文・現在の状態・既存データの指紋）
//   npx tsx scripts/rakuten-events/setup-tables.ts apply    … 作成（内容を表示し「APPLY」と入力したときだけ。1つのトランザクション）→ 続けて verify
//   npx tsx scripts/rakuten-events/setup-tables.ts verify   … 作成後の確認（読み取りのみ）
//   npx tsx scripts/rakuten-events/setup-tables.ts undo     … 取り消し（2テーブルが空のときだけ。「UNDO」と入力したときだけ）
//
// 接続は .env.local の DATABASE_URL（既存サイトと同じ neondb_owner）。接続文字列・エラーの秘密は表示しない。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { neon } from '@neondatabase/serverless';
import { migrationStatements, preflightProblems, readState, undoStatements, verifyProblems, type Db } from './setup-tables-core';

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'drizzle', '0022_rakuten_events.sql');

function readUrl(): string {
  const file = path.join(ROOT, '.env.local');
  const m = fs.readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
  if (!m) throw new Error('.env.local に DATABASE_URL がありません');
  return m[1].replace(/^['"]|['"]$/g, '');
}

function makeDb(url: string): Db {
  const sql = neon(url);
  return {
    query: (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
    readOnly: (stmts) => sql.transaction(stmts.map((s) => sql.query(s.text, s.params ?? [])), { readOnly: true }) as Promise<Record<string, unknown>[][]>,
    tx: async (stmts) => { await sql.transaction(stmts.map((s) => sql.query(s.text, s.params ?? []))); },
  };
}

async function confirm(word: string, message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${message}\n実行するには ${word} と入力して Enter（それ以外は中止）: `)).trim();
  rl.close();
  return ans === word;
}

function show(label: string, s: Awaited<ReturnType<typeof readState>>) {
  console.log(`${label}：接続 ${s.user} / ${s.database}`);
  console.log(`  テーブル: ${Object.entries(s.tables).map(([k, v]) => `${k}=${v ? 'あり' : 'なし'}`).join('  ')}`);
  console.log(`  インデックス: ${Object.entries(s.indexes).map(([k, v]) => `${k}=${v ? 'あり' : 'なし'}`).join('  ')}`);
  console.log(`  行数: ${Object.entries(s.rows).map(([k, v]) => `${k}=${v ?? '—'}`).join('  ')}`);
  console.log(`  既存データ: products ${s.fingerprint.products_rows} 行・verdicts ${s.fingerprint.verdicts_rows} 行（指紋 ${String(s.fingerprint.products_hash).slice(0, 8)}… / ${String(s.fingerprint.verdicts_hash).slice(0, 8)}…）`);
}

async function main() {
  const cmd = process.argv[2];
  const db = makeDb(readUrl());
  const stmts = migrationStatements(fs.readFileSync(MIGRATION, 'utf8'));
  try {
    if (cmd === 'check' || cmd === 'apply') {
      const before = await readState(db);
      show('現在の状態', before);
      const problems = preflightProblems(before, { user: 'neondb_owner', database: 'neondb' });
      console.log('\n実行する文（1つのトランザクション。途中で失敗したら何も適用されない。既存のテーブル・データ・権限は変えない）:');
      stmts.forEach((s, i) => console.log(`  ${i + 1}. ${s.split('\n')[0]}`));
      console.log(problems.length ? `\n実行前の確認：問題あり\n${problems.map((p) => '  - ' + p).join('\n')}` : '\n実行前の確認：問題なし');
      if (cmd === 'check' || problems.length) { if (problems.length) process.exitCode = 1; return; }
      if (!(await confirm('APPLY', '\n本番DB（neondb）に上の2テーブルとインデックスを作成します。'))) { console.log('中止しました（何も変更していません）。'); return; }
      await db.tx(stmts.map((text) => ({ text })));
      const after = await readState(db);
      show('\n作成後の状態', after);
      const ng = verifyProblems(after, before.fingerprint);
      console.log(ng.length ? `\n作成後の確認：NG\n${ng.map((p) => '  - ' + p).join('\n')}` : '\n作成後の確認：OK（2テーブル・3インデックスあり。既存の products・verdicts は作成前と同じ）');
      if (ng.length) process.exitCode = 1;
      return;
    }
    if (cmd === 'verify') {
      const s = await readState(db);
      show('現在の状態', s);
      const ng = verifyProblems(s);
      console.log(ng.length ? `NG\n${ng.map((p) => '  - ' + p).join('\n')}` : 'OK（2テーブル・3インデックスあり、列も想定どおり）');
      if (ng.length) process.exitCode = 1;
      return;
    }
    if (cmd === 'undo') {
      const s = await readState(db);
      show('現在の状態', s);
      const { stmts: drop, problems } = undoStatements(s);
      if (problems.length) { console.log(problems.map((p) => '  - ' + p).join('\n')); process.exitCode = 1; return; }
      if (!(await confirm('UNDO', '\nrakuten_event_products・rakuten_events（どちらも空）を削除します。既存の商品・判定は変わりません。'))) { console.log('中止しました。'); return; }
      await db.tx(drop);
      console.log('削除しました。');
      return;
    }
    console.log('使い方: check | apply | verify | undo');
    process.exitCode = 1;
  } catch (e) {
    // 接続文字列などを含みうるエラー文は出さない（種類とコードだけ）
    const x = e as { name?: string; code?: string };
    console.error(`エラー: ${x.name ?? 'Error'} ${x.code ?? ''}（トランザクションのため、途中で失敗した場合は何も適用されていません）`);
    process.exitCode = 1;
  }
}

main();
