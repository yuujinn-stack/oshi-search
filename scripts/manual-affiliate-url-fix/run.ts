// 手動登録の楽天商品で、アフィリエイトURLになっていない affiliateUrl の修正（2026-10・1回限り）。
// 判定ロジックは ./plan.ts（純粋関数）。詳細な方針は plan.ts 冒頭のコメントを参照。
//
// - デフォルトは dry-run（DBは一切書き換えない）。
// - 書き換えるのは --apply・--expect <変更件数>・--confirm-host <接続先ホスト名> をすべて付け、
//   変更予定件数・接続先ホスト名が一致し、異常判定（invalid_source・duplicate_id_in_row・ambiguous_source・title_mismatch）が
//   0件のときだけ。
// - 変更するのは products.items[] の該当要素の affiliateUrl だけ。商品ID・itemUrl・商品名・価格・カテゴリ・並び順・verdicts は変更しない。
// - apply / rollback は1トランザクション（neonSql.transaction）。各 products 行は「読み込んだ時点の items と完全一致」の場合だけ
//   更新し、1行でも食い違えば全体をロールバックする（同時更新があっても古いデータで上書きしない。部分反映なし）。
// - 冪等: 適用済みの要素は already_applied として何もしない。
// - 毎回、変更対象行の現在値（元のURLを含む items 全体）をバックアップ（JSON）に保存する。
//   --rollback <backup.json> で今回の変更だけを元のURLに戻せる。
// - --branch-selftest: Neon の検証用ブランチ専用の通し試験（同時更新の検出 → 適用 → 復元 → 元の状態と一致の確認）。
//   接続先が本番（.env.local の DATABASE_URL と同じホスト）の場合は実行しない。
// - 楽天API・外部APIは呼ばない（DB内の既存アフィリエイトURLを流用するだけ）。
//
// 実行方法（本番）:
//   dry-run : npx dotenv -e .env.local -- npx tsx scripts/manual-affiliate-url-fix/run.ts
//   apply   : npx dotenv -e .env.local -- npx tsx scripts/manual-affiliate-url-fix/run.ts --apply --expect 130 --confirm-host <ホスト名>
//   復元確認: npx dotenv -e .env.local -- npx tsx scripts/manual-affiliate-url-fix/run.ts --rollback <backup.json>
//   復元    : 上記に --apply --confirm-host <ホスト名> を付ける
// 実行方法（検証用ブランチ。.env.branch-test に DATABASE_URL=<ブランチの接続文字列> だけを書く）:
//   npx dotenv -e .env.branch-test -- npx tsx scripts/manual-affiliate-url-fix/run.ts --branch-selftest --expect 130 --confirm-host <ブランチのホスト名>
import fs from 'fs';
import path from 'path';
import { neonSql } from '@/db/client';
import {
  FIX_ID,
  buildRowUpdates,
  buildSourceIndex,
  evaluateRows,
  maskAffiliateUrl,
  summarize,
  type ItemResult,
  type ProductItem,
  type ProductRow,
  type RowUpdate,
  type SourceLink,
} from './plan';

const DEFAULT_OUT_DIR = 'tmp/manual-affiliate-url-fix';
const BLOCKING: ItemResult['status'][] = ['invalid_source', 'duplicate_id_in_row', 'ambiguous_source', 'title_mismatch'];

interface Change { personName: string; category: string; index: number; id: string; before: string; after: string }
interface Backup { fixId: string; createdAt: string; dbHost: string; rows: { personName: string; category: string; itemsBefore: ProductItem[] }[]; changes: Change[] }

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const known = new Set(['--apply', '--expect', '--out-dir', '--rollback', '--confirm-host', '--branch-selftest']);
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new Error(`未対応のオプションです: ${a}`);
  const expect = get('--expect');
  return {
    apply: argv.includes('--apply'),
    selftest: argv.includes('--branch-selftest'),
    expect: expect === undefined ? undefined : Number(expect),
    confirmHost: get('--confirm-host'),
    outDir: get('--out-dir') ?? DEFAULT_OUT_DIR,
    rollback: get('--rollback'),
  };
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}
const dbHost = () => hostOf(process.env.DATABASE_URL);

/** .env.local の DATABASE_URL（本番）のホスト名。検証用ブランチでの通し試験が本番で動かないようにするために使う */
function productionHostFromEnvLocal(): string {
  try {
    const m = /^DATABASE_URL=(.*)$/m.exec(fs.readFileSync('.env.local', 'utf-8'));
    return hostOf(m?.[1]?.trim().replace(/^["']|["']$/g, ''));
  } catch {
    return '';
  }
}

function requireConfirmHost(confirmHost: string | undefined) {
  if (!confirmHost || confirmHost !== dbHost()) {
    throw new Error(`--confirm-host（${confirmHost ?? '未指定'}）が接続先（${dbHost() || '不明'}）と一致しないため中止しました。DBは変更していません。`);
  }
}

// ── 読み込み（読み取りのみ） ────────────────────────────────────────────────

/** 対象行：手動登録商品のうち、affiliateUrl がアフィリエイトURLでないもの、または修正済み（itemUrl が楽天ブックス通常URL）を含む行 */
async function loadTargetRows(): Promise<ProductRow[]> {
  const rows = (await neonSql`
    SELECT p.person_name, p.category, p.items
    FROM products p
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.items) it
      WHERE it->>'id' LIKE 'mn-%'
        AND (coalesce(it->>'affiliateUrl', '') !~ '^https?://hb\\.afl\\.rakuten\\.co\\.jp/'
             OR coalesce(it->>'itemUrl', '') ~ '^https?://books\\.rakuten\\.co\\.jp/rb/')
    )
    ORDER BY p.person_name, p.category`) as { person_name: string; category: string; items: ProductItem[] }[];
  return rows.map((r) => ({ personName: r.person_name, category: r.category, items: r.items }));
}

async function loadRow(personName: string, category: string): Promise<ProductItem[] | null> {
  const rows = (await neonSql`SELECT items FROM products WHERE person_name = ${personName} AND category = ${category}`) as { items: ProductItem[] }[];
  return rows[0]?.items ?? null;
}

/** 流用元：手動登録以外（楽天API）の、楽天ブックス商品のアフィリエイトURL（必要な商品番号のものだけ） */
async function loadSources(productNumbers: string[]): Promise<SourceLink[]> {
  if (productNumbers.length === 0) return [];
  return (await neonSql`
    SELECT DISTINCT it->>'id' AS id, it->>'title' AS title, it->>'affiliateUrl' AS url
    FROM products p, jsonb_array_elements(p.items) it
    WHERE it->>'id' !~ '^mn-'
      AND it->>'affiliateUrl' ~ '^https?://hb\\.afl\\.rakuten\\.co\\.jp/hgc/'
      AND substring(it->>'affiliateUrl' from 'books\\.rakuten\\.co\\.jp%2Frb%2F([0-9]+)') = ANY(${productNumbers}::text[])`) as SourceLink[];
}

/** 楽天APIが楽天ブックス商品に発行するアフィリエイトURLの識別部分（DB全体で1種類であることを確認する） */
async function loadBooksHgc(): Promise<{ hgc: string; kinds: number; total: number }> {
  const rows = (await neonSql`
    SELECT substring(it->>'affiliateUrl' from '/hgc/([^/]+)/') AS hgc, count(*)::int AS n
    FROM products p, jsonb_array_elements(p.items) it
    WHERE it->>'id' !~ '^mn-' AND it->>'affiliateUrl' ~ '^https?://hb\\.afl\\.rakuten\\.co\\.jp/hgc/[^/]+/\\?pc=https?%3A%2F%2Fbooks\\.rakuten\\.co\\.jp'
    GROUP BY 1`) as { hgc: string; n: number }[];
  return { hgc: rows[0]?.hgc ?? '', kinds: rows.length, total: rows.reduce((s, r) => s + r.n, 0) };
}

async function plan() {
  const rows = await loadTargetRows();
  const books = await loadBooksHgc();
  const productNumbers = [...new Set(rows.flatMap((r) => r.items
    .filter((it) => it.id?.startsWith('mn-'))
    .map((it) => /books\.rakuten\.co\.jp\/rb\/(\d+)/.exec(String(it.itemUrl ?? ''))?.[1])
    .filter((x): x is string => !!x)))];
  const index = buildSourceIndex(await loadSources(productNumbers));
  const results = evaluateRows(rows, index, books.hgc);
  const summary = summarize(results);
  const updates = buildRowUpdates(rows, results);
  const blockers: string[] = [];
  if (books.kinds !== 1) blockers.push(`楽天ブックス向けアフィリエイトURLの識別部分が ${books.kinds} 種類あります（1種類のはず）`);
  for (const s of BLOCKING) if (summary.byStatus[s] > 0) blockers.push(`${s} が ${summary.byStatus[s]} 件あります`);
  return { rows, books, results, summary, updates, blockers, reEvaluate: async () => summarize(evaluateRows(await loadTargetRows(), index, books.hgc)) };
}

// ── 書き込み（トランザクション・楽観ロック） ──────────────────────────────────

/** 各行を「読み込んだ時点の items と完全一致」の場合だけ更新する。1行でも一致しなければ全体をロールバック */
async function writeRowsGuarded(list: { personName: string; category: string; expected: ProductItem[]; next: ProductItem[] }[]) {
  const queries = list.map((u) => neonSql`
    WITH u AS (
      UPDATE products SET items = ${JSON.stringify(u.next)}::jsonb
      WHERE person_name = ${u.personName} AND category = ${u.category} AND items = ${JSON.stringify(u.expected)}::jsonb
      RETURNING 1
    )
    SELECT 1 / (SELECT count(*)::int FROM u) AS ok`);
  await neonSql.transaction(queries);
}

const applyList = (updates: RowUpdate[]) =>
  updates.map((u) => ({ personName: u.personName, category: u.category, expected: u.beforeItems, next: u.afterItems }));

function toBackup(updates: RowUpdate[]): Backup {
  return {
    fixId: FIX_ID,
    createdAt: new Date().toISOString(),
    dbHost: dbHost(),
    rows: updates.map((u) => ({ personName: u.personName, category: u.category, itemsBefore: u.beforeItems })),
    changes: updates.flatMap((u) => u.changes.map((c) => ({ personName: c.personName, category: c.category, index: c.index, id: c.id, before: c.before, after: c.after! }))),
  };
}

/** 復元計画：現在 after になっている要素だけを before に戻す。想定外の状態はエラー */
async function planRollback(backup: Backup) {
  const keyOf = (p: string, c: string) => `${p}\u0000${c}`;
  const current = new Map<string, ProductItem[]>();
  for (const r of backup.rows) {
    const items = await loadRow(r.personName, r.category);
    if (items) current.set(keyOf(r.personName, r.category), items);
  }
  const next = new Map<string, ProductItem[]>();
  let pending = 0;
  let already = 0;
  const errors: string[] = [];
  for (const c of backup.changes) {
    const k = keyOf(c.personName, c.category);
    const cur = current.get(k)?.[c.index];
    if (!cur || cur.id !== c.id) { errors.push(`${c.personName} / ${c.category} / ${c.id}: 要素が見つかりません`); continue; }
    if (cur.affiliateUrl === c.before) { already++; continue; }
    if (cur.affiliateUrl !== c.after) { errors.push(`${c.personName} / ${c.category} / ${c.id}: 想定外の affiliateUrl`); continue; }
    const items = next.get(k) ?? current.get(k)!.map((it) => ({ ...it }));
    items[c.index] = { ...cur, affiliateUrl: c.before };
    next.set(k, items);
    pending++;
  }
  const list = [...next.entries()].map(([k, items]) => {
    const [personName, category] = k.split('\u0000');
    return { personName, category, expected: current.get(k)!, next: items };
  });
  return { pending, already, errors, list };
}

/** キーの並び順に依存しない比較（jsonb は読み出し時にキー順が正規化されるため） */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
const sameJson = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

// ── 出力 ────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeOutputs(dir: string, results: ItemResult[], backup: Backup) {
  const header = ['status', 'personName', 'category', 'index', 'productId', 'title', 'productNumber', 'itemUrl', 'affiliateUrlBefore', 'affiliateUrlAfter', 'sourceProductId', 'sourceTitle', 'message'];
  const body = results.map((r) => [r.status, r.personName, r.category, r.index, r.id, r.title, r.productNumber ?? '', r.itemUrl, r.before, r.after ?? '', r.source?.id ?? '', r.source?.title ?? '', r.message ?? '']);
  fs.writeFileSync(path.join(dir, 'result.csv'), '﻿' + [header, ...body].map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(backup, null, 1), 'utf-8');
}

function makeRunDir(outDir: string, mode: string): string {
  const dir = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function printPlan(p: Awaited<ReturnType<typeof plan>>) {
  console.log(`楽天ブックス向けアフィリエイトURL: ${p.books.total} 件 / 識別部分 ${p.books.kinds} 種類`);
  console.log(`対象行 ${p.rows.length} 行 / 手動登録の判定対象 ${p.summary.total} 件`);
  for (const [k, v] of Object.entries(p.summary.byStatus)) console.log(`  ${k}: ${v}`);
  console.log(`変更予定: ${p.summary.byStatus.pending} 件（products ${p.updates.length} 行）`);
  for (const r of p.results.filter((x) => x.status === 'pending').slice(0, 3)) {
    console.log(`  例) ${r.personName} / ${r.category} / ${r.id}: ${r.before} → ${maskAffiliateUrl(r.after)}`);
  }
}

// ── モード ──────────────────────────────────────────────────────────────────

async function runFix(args: ReturnType<typeof parseArgs>) {
  console.log(`== ${FIX_ID} (${args.apply ? 'APPLY' : 'DRY-RUN：DBは書き換えません'}) ==`);
  console.log(`DB: ${dbHost() || '(不明)'}`);
  const p = await plan();
  if (args.apply && args.expect !== p.summary.byStatus.pending) {
    p.blockers.push(`--expect（${args.expect ?? '未指定'}）と変更予定件数（${p.summary.byStatus.pending}）が一致しません`);
  }
  const dir = makeRunDir(args.outDir, args.apply ? 'apply' : 'dry-run');
  writeOutputs(dir, p.results, toBackup(p.updates));
  printPlan(p);
  for (const b of p.blockers) console.log(`  [apply不可] ${b}`);
  console.log(`出力: ${dir}（result.csv：全判定と修正前後URL、backup.json：変更予定の行の現在値＝元のURL）`);

  if (!args.apply) {
    console.log(p.blockers.length === 0 ? 'dry-run OK（--apply --expect --confirm-host で反映可能な状態です）' : 'dry-run NG（このままでは apply できません）');
    return;
  }
  if (p.blockers.length) {
    console.error('件数または状態が想定と一致しないため apply を中止しました。DBは変更していません。');
    process.exitCode = 1;
    return;
  }
  requireConfirmHost(args.confirmHost);
  if (p.updates.length === 0) {
    console.log('すべて適用済みです。DBは変更していません。');
    return;
  }
  await writeRowsGuarded(applyList(p.updates));
  console.log(`apply 完了: products ${p.updates.length} 行 / affiliateUrl ${p.summary.byStatus.pending} 件を1トランザクションで更新しました。`);
  const verify = await p.reEvaluate();
  console.log(`反映後の検証: 適用済み ${verify.byStatus.already_applied} / 変更予定 ${verify.byStatus.pending}`);
  if (verify.byStatus.already_applied !== p.summary.byStatus.pending || verify.byStatus.pending !== 0) process.exitCode = 1;
}

async function runRollback(args: ReturnType<typeof parseArgs>) {
  const backup = JSON.parse(fs.readFileSync(args.rollback!, 'utf-8')) as Backup;
  if (backup.fixId !== FIX_ID) throw new Error(`別の修正のバックアップです（${backup.fixId}）`);
  console.log(`== ${FIX_ID} 復元 (${args.apply ? 'APPLY' : 'DRY-RUN：DBは書き換えません'}) ==`);
  console.log(`DB: ${dbHost() || '(不明)'}（バックアップ取得時: ${backup.dbHost ?? '不明'}）`);
  const r = await planRollback(backup);
  console.log(`バックアップ ${backup.changes.length} 件: 復元予定 ${r.pending} / 復元済み ${r.already} / エラー ${r.errors.length}`);
  for (const e of r.errors) console.log(`  [エラー] ${e}`);
  if (!args.apply) return;
  if (r.errors.length) {
    console.error('想定外の状態があるため復元を中止しました。DBは変更していません。');
    process.exitCode = 1;
    return;
  }
  requireConfirmHost(args.confirmHost);
  if (r.list.length === 0) {
    console.log('すべて復元済みです。DBは変更していません。');
    return;
  }
  await writeRowsGuarded(r.list);
  console.log(`復元完了: products ${r.list.length} 行 / affiliateUrl ${r.pending} 件`);
}

/** 検証用ブランチ専用の通し試験。本番ホストでは実行しない */
async function runBranchSelftest(args: ReturnType<typeof parseArgs>) {
  const prodHost = productionHostFromEnvLocal();
  console.log(`== ${FIX_ID} 検証用ブランチ通し試験 ==`);
  console.log(`DB: ${dbHost() || '(不明)'} / 本番: ${prodHost || '(.env.local から取得できません)'}`);
  if (!prodHost || !dbHost() || prodHost === dbHost()) throw new Error('接続先が本番（または判別不能）のため、通し試験を中止しました。DBは変更していません。');
  requireConfirmHost(args.confirmHost);

  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? 'OK ' : 'NG '} ${label}`);
    if (!ok) throw new Error(`通し試験失敗: ${label}`);
  };
  const p = await plan();
  printPlan(p);
  check(p.blockers.length === 0, '異常判定が0件');
  check(args.expect === p.summary.byStatus.pending, `変更予定件数が --expect（${args.expect}）と一致`);
  const dir = makeRunDir(args.outDir, 'branch-selftest');
  const backup = toBackup(p.updates);
  writeOutputs(dir, p.results, backup);
  console.log(`  バックアップ: ${dir}/backup.json`);

  // 1) 同時更新の検出：対象行の1つを（試験用に）別の内容へ変えてから、古い計画で更新を試みる → 全体が失敗し、どの行も変わらないこと
  const target = p.updates[0];
  const tampered = target.beforeItems.map((it, i) => (i === 0 ? { ...it, __selftestConcurrentEdit: true } : it));
  await writeRowsGuarded([{ personName: target.personName, category: target.category, expected: target.beforeItems, next: tampered }]);
  let failed = false;
  try {
    await writeRowsGuarded(applyList(p.updates));
  } catch {
    failed = true;
  }
  check(failed, '同時更新があると更新全体が中止される');
  const afterAbort = await p.reEvaluate();
  check(afterAbort.byStatus.already_applied === 0, '中止後、どの商品も更新されていない（部分反映なし）');
  await writeRowsGuarded([{ personName: target.personName, category: target.category, expected: tampered, next: target.beforeItems }]);
  check(sameJson(await loadRow(target.personName, target.category), target.beforeItems), '試験用の変更を元に戻した');

  // 2) 適用
  await writeRowsGuarded(applyList(p.updates));
  const afterApply = await p.reEvaluate();
  check(afterApply.byStatus.already_applied === p.summary.byStatus.pending && afterApply.byStatus.pending === 0, `適用後: 適用済み ${afterApply.byStatus.already_applied} 件 / 変更予定 0 件`);
  for (const u of p.updates) {
    const items = await loadRow(u.personName, u.category);
    check(sameJson(items, u.afterItems), `${u.personName} / ${u.category}: affiliateUrl 以外は変わらず、更新後URLが想定どおり（${u.changes.length} 件）`);
  }

  // 3) 復元
  const r = await planRollback(backup);
  check(r.errors.length === 0 && r.pending === backup.changes.length, `復元予定 ${r.pending} 件・エラー0`);
  await writeRowsGuarded(r.list);
  for (const row of backup.rows) {
    check(sameJson(await loadRow(row.personName, row.category), row.itemsBefore), `${row.personName} / ${row.category}: 元の状態（元のURL）に完全に戻った`);
  }
  const final = await p.reEvaluate();
  check(final.byStatus.pending === p.summary.byStatus.pending, `復元後: 変更予定 ${final.byStatus.pending} 件（試験前と同じ）`);
  console.log('通し試験 PASS（検証用ブランチは試験前の状態に戻っています）');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) await runBranchSelftest(args);
  else if (args.rollback) await runRollback(args);
  else await runFix(args);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
