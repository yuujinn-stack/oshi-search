// Prime Video 追加チャンネル誤登録の一括修正（2026-10・1回限り）。
//
// 最終確認済みCSV（scripts/data/prime-video-channel-fix-2026-10.csv）に書かれた変更だけを行う専用スクリプト。
// 通常のVOD CSV取り込み（同名providerを上書きする処理）は使わない。
//
// - デフォルトは dry-run（DBは一切書き換えない）。書き換えるのは --apply を付けたときだけ。
// - DB が CSV の修正前状態（personName / workId / canonicalWorkId / provider / 種別 / source / note）と
//   完全一致する provider だけを変更する。想定外の状態はエラーとして報告し、1件でもあれば apply しない。
// - 件数（変更141行・ユニーク106作品・rename 132 / unknown 8 / rent 1・維持17）が1件でも違えば apply しない。
// - 削除はしない。rename / 配信種別の変更のみ。
// - apply は1トランザクション（neonSql.transaction）。各作品行は「読み込んだ時点の vod_data と同一」の
//   場合だけ更新し、1行でも食い違えば全体をロールバックする（部分反映なし）。
// - 冪等: 適用済みの行は already_applied として何もしない。
// - 毎回、変更対象の現在値をバックアップ（CSV + JSON）に保存する。--rollback <backup.json> で今回の変更だけを戻せる。
//
// 実行方法:
//   dry-run : npx dotenv -e .env.local -- npx tsx scripts/prime-video-channel-fix/run.ts
//   apply   : npx dotenv -e .env.local -- npx tsx scripts/prime-video-channel-fix/run.ts --apply
//   復元確認: npx dotenv -e .env.local -- npx tsx scripts/prime-video-channel-fix/run.ts --rollback tmp/prime-channel-fix/<実行>/backup.json
//   復元    : 上記に --apply を付ける
import fs from 'fs';
import path from 'path';
import { neonSql } from '@/db/client';
import {
  FIX_ID,
  buildWorkRowUpdates,
  evaluatePlanRow,
  evaluateRollbackEntry,
  parsePlanCsv,
  providersOf,
  summarize,
  targetOf,
  type BackupEntry,
  type DbWorkRow,
  type RowResult,
} from './plan';
import type { VodProvider } from '@/types/vod';

const DEFAULT_PLAN = 'scripts/data/prime-video-channel-fix-2026-10.csv';
const DEFAULT_OUT_DIR = 'tmp/prime-channel-fix';

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const known = new Set(['--apply', '--plan', '--out-dir', '--rollback']);
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new Error(`未対応のオプションです: ${a}`);
  return {
    apply: argv.includes('--apply'),
    plan: get('--plan') ?? DEFAULT_PLAN,
    outDir: get('--out-dir') ?? DEFAULT_OUT_DIR,
    rollback: get('--rollback'),
  };
}

const keyOf = (personName: string, workId: string) => `${personName}\u0000${workId}`;

async function loadDbRows(pairs: { personName: string; workId: string }[]): Promise<Map<string, DbWorkRow>> {
  const uniq = [...new Map(pairs.map((p) => [keyOf(p.personName, p.workId), p])).values()];
  const persons = uniq.map((p) => p.personName);
  const ids = uniq.map((p) => p.workId);
  const rows = (await neonSql`
    SELECT w.person_name, w.id, w.deleted, w.vod_data, a.canonical_work_id AS alias_canonical
    FROM works w
    JOIN unnest(${persons}::text[], ${ids}::text[]) AS t(person_name, id)
      ON w.person_name = t.person_name AND w.id = t.id
    LEFT JOIN work_aliases a ON a.alias_work_id = w.id
  `) as { person_name: string; id: string; deleted: boolean; vod_data: Record<string, unknown> | null; alias_canonical: string | null }[];
  const map = new Map<string, DbWorkRow>();
  for (const r of rows) {
    map.set(keyOf(r.person_name, r.id), {
      personName: r.person_name,
      id: r.id,
      deleted: r.deleted,
      vodData: r.vod_data ?? {},
      aliasCanonicalWorkId: r.alias_canonical,
    });
  }
  return map;
}

/** 読み込んだ vod_data がそのまま jsonb 等価比較で一致するか（apply 時の楽観ロック条件が成立するかの事前確認・読み取りのみ） */
async function countGuardMatches(rows: { personName: string; workId: string; vodData: Record<string, unknown> }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = (await neonSql`
    SELECT count(*)::int AS n
    FROM works w
    JOIN unnest(${rows.map((r) => r.personName)}::text[], ${rows.map((r) => r.workId)}::text[], ${rows.map((r) => JSON.stringify(r.vodData))}::text[])
      AS t(person_name, id, vod)
      ON w.person_name = t.person_name AND w.id = t.id AND w.deleted = false AND w.vod_data = t.vod::jsonb
  `) as { n: number }[];
  return result[0]?.n ?? 0;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(file, '﻿' + body + '\n', 'utf-8');
}

function dbHostLabel(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname || '(不明)';
  } catch {
    return '(DATABASE_URL を解釈できません)';
  }
}

function makeRunDir(outDir: string, mode: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(outDir, `${stamp}-${mode}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBackup(dir: string, results: RowResult[], dbRows: Map<string, DbWorkRow>) {
  const pending = results.filter((r) => r.status === 'pending');
  const entries: (BackupEntry & { workTitle: string; providerIndex: number })[] = pending.map((r) => {
    const t = targetOf(r.plan);
    return {
      personName: r.plan.personName,
      workId: r.plan.workId,
      canonicalWorkId: r.plan.canonicalWorkId,
      workTitle: r.plan.workTitle,
      action: r.plan.action,
      providerIndex: r.providerIndex!,
      providerBefore: r.before!,
      expectedAfterProviderName: t.providerName,
      expectedAfterType: t.type,
    };
  });
  const vodDataBefore = Object.fromEntries(
    [...new Set(pending.map((r) => keyOf(r.plan.personName, r.plan.workId)))].map((k) => {
      const db = dbRows.get(k)!;
      return [`${db.personName}/${db.id}`, db.vodData];
    }),
  );
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify({ fixId: FIX_ID, createdAt: new Date().toISOString(), entries, vodDataBefore }, null, 1), 'utf-8');
  writeCsv(
    path.join(dir, 'backup.csv'),
    ['fixId', 'personName', 'workId', 'canonicalWorkId', 'workTitle', 'action', 'providerIndex', 'providerName', 'type', 'source', 'note',
      'providerId', 'logoPath', 'sourceUrl', 'officialUrl', 'expectedAfterProviderName', 'expectedAfterType', 'providerBeforeJson', 'vodDataBeforeJson'],
    entries.map((e) => {
      const p = e.providerBefore;
      return [FIX_ID, e.personName, e.workId, e.canonicalWorkId, e.workTitle, e.action, e.providerIndex, p.providerName, p.type, p.source, p.note ?? '',
        p.providerId, p.logoPath ?? '', p.sourceUrl ?? '', p.officialUrl ?? '', e.expectedAfterProviderName, e.expectedAfterType,
        JSON.stringify(p), JSON.stringify(dbRows.get(keyOf(e.personName, e.workId))!.vodData)];
    }),
  );
  return entries.length;
}

async function runFix(args: ReturnType<typeof parseArgs>) {
  const { rows, errors: parseErrors } = parsePlanCsv(fs.readFileSync(args.plan, 'utf-8'));
  if (parseErrors.length) {
    console.error('CSVの読み込みに失敗しました:\n  ' + parseErrors.join('\n  '));
    process.exitCode = 1;
    return;
  }
  const dbRows = await loadDbRows(rows.map((r) => ({ personName: r.personName, workId: r.workId })));
  const results = rows.map((r) => evaluatePlanRow(r, dbRows.get(keyOf(r.personName, r.workId))));
  const summary = summarize(results);
  const now = Date.now();
  const updates = buildWorkRowUpdates(results, dbRows, now);
  const guardOk = await countGuardMatches(updates.map((u) => ({ personName: u.personName, workId: u.workId, vodData: u.before })));
  if (guardOk !== updates.length) summary.blockers.push(`楽観ロック条件の事前確認: ${guardOk}/${updates.length} 行のみ一致`);

  const dir = makeRunDir(args.outDir, args.apply ? 'apply' : 'dry-run');
  writeCsv(
    path.join(dir, 'result.csv'),
    ['lineNo', 'status', 'message', 'action', 'personName', 'workId', 'canonicalWorkId', 'workTitle', 'currentProvider', 'currentType',
      'newProviderName', 'newType', 'providerIndex', 'providerIdBefore', 'logoPathBefore'],
    results.map((r) => {
      const t = targetOf(r.plan);
      return [r.plan.lineNo, r.status, r.message ?? '', r.plan.action, r.plan.personName, r.plan.workId, r.plan.canonicalWorkId, r.plan.workTitle,
        r.plan.currentProvider, r.plan.availabilityType, t.providerName, t.type, r.providerIndex ?? '', r.before?.providerId ?? '', r.before?.logoPath ?? ''];
    }),
  );
  const backupCount = writeBackup(dir, results, dbRows);

  const pendingRename = results.filter((r) => r.status === 'pending' && r.plan.action === 'rename');
  const renameByName: Record<string, number> = {};
  for (const r of pendingRename) renameByName[r.plan.newProviderName] = (renameByName[r.plan.newProviderName] ?? 0) + 1;

  console.log(`== ${FIX_ID} (${args.apply ? 'APPLY' : 'DRY-RUN：DBは書き換えません'}) ==`);
  console.log(`DB: ${dbHostLabel()}`);
  console.log(`CSV: ${args.plan}（${summary.totalRows}行）`);
  console.log(`変更行: ${summary.changeRows}（ユニーク作品 ${summary.changeUniqueWorks}） / 維持: ${summary.byAction.keep}`);
  console.log(`  内訳 rename ${summary.byAction.rename} / set_unknown ${summary.byAction.set_unknown} / set_rent ${summary.byAction.set_rent}`);
  console.log(`判定: 変更予定 ${summary.byStatus.pending}（rename ${summary.pendingByAction.rename} / unknown ${summary.pendingByAction.set_unknown} / rent ${summary.pendingByAction.set_rent}）`
    + ` / 適用済み ${summary.byStatus.already_applied} / 変更なし(維持) ${summary.byStatus.unchanged_keep} / エラー ${summary.byStatus.error}`);
  console.log(`更新する作品行（人物×作品）: ${summary.workRowsToUpdate} / 楽観ロック条件の事前確認 ${guardOk}/${updates.length}`);
  console.log(`  rename の内訳: ${JSON.stringify(renameByName)}`);
  console.log(`  rename で外す Prime の logoPath: ${pendingRename.filter((r) => r.before?.logoPath).length} 件 / providerId≠-1: ${pendingRename.filter((r) => r.before?.providerId !== -1).length} 件`);
  for (const e of summary.errors) console.log(`  [エラー] ${e.plan.lineNo}行目 ${e.plan.personName} / ${e.plan.workId}: ${e.message}`);
  for (const b of summary.blockers) console.log(`  [apply不可] ${b}`);
  console.log(`出力: ${dir}（result.csv / backup.csv / backup.json：変更予定 ${backupCount} 行の現在値）`);

  if (!args.apply) {
    console.log(summary.blockers.length === 0 ? 'dry-run OK（--apply で反映可能な状態です）' : 'dry-run NG（このままでは apply できません）');
    return;
  }
  if (summary.blockers.length) {
    console.error('件数または状態が想定と一致しないため apply を中止しました。DBは変更していません。');
    process.exitCode = 1;
    return;
  }
  if (updates.length === 0) {
    console.log('すべて適用済みです。DBは変更していません。');
    return;
  }

  const queries = updates.flatMap((u) => [
    neonSql`
      WITH u AS (
        UPDATE works SET vod_data = ${JSON.stringify(u.after)}::jsonb, updated_at = now()
        WHERE person_name = ${u.personName} AND id = ${u.workId} AND deleted = false AND vod_data = ${JSON.stringify(u.before)}::jsonb
        RETURNING 1
      )
      SELECT 1 / (SELECT count(*)::int FROM u) AS ok`,
    neonSql`
      INSERT INTO vod_recheck_logs (person_name, work_id, action, performed_by, note, updated_provider_count)
      VALUES (${u.personName}, ${u.workId}, 'note', ${`script:${FIX_ID}`},
        ${`Prime Video追加チャンネル誤登録の修正: ${u.changes.map((c) => `${c.plan.currentProvider}→${targetOf(c.plan).providerName}(${targetOf(c.plan).type})`).join(' / ')}`},
        ${u.changes.length})`,
  ]);
  await neonSql.transaction(queries);
  console.log(`apply 完了: 作品行 ${updates.length} 件 / provider ${summary.byStatus.pending} 件を1トランザクションで更新しました。`);

  // 反映後の検証（読み取りのみ）
  const after = await loadDbRows(rows.map((r) => ({ personName: r.personName, workId: r.workId })));
  const verify = summarize(rows.map((r) => evaluatePlanRow(r, after.get(keyOf(r.personName, r.workId)))));
  console.log(`反映後の検証: 適用済み ${verify.byStatus.already_applied} / 変更予定 ${verify.byStatus.pending} / 維持 ${verify.byStatus.unchanged_keep} / エラー ${verify.byStatus.error}`);
  if (verify.byStatus.already_applied !== summary.changeRows || verify.byStatus.error > 0) process.exitCode = 1;
}

async function runRollback(args: ReturnType<typeof parseArgs>) {
  const backup = JSON.parse(fs.readFileSync(args.rollback!, 'utf-8')) as { fixId: string; entries: BackupEntry[] };
  if (backup.fixId !== FIX_ID) throw new Error(`別の修正のバックアップです（${backup.fixId}）`);
  const dbRows = await loadDbRows(backup.entries.map((e) => ({ personName: e.personName, workId: e.workId })));
  const results = backup.entries.map((e) => evaluateRollbackEntry(e, dbRows.get(keyOf(e.personName, e.workId))));
  const count = (s: string) => results.filter((r) => r.status === s).length;
  console.log(`== ${FIX_ID} 復元 (${args.apply ? 'APPLY' : 'DRY-RUN：DBは書き換えません'}) ==`);
  console.log(`DB: ${dbHostLabel()}`);
  console.log(`バックアップ ${backup.entries.length} 件: 復元予定 ${count('pending')} / 復元済み ${count('already_restored')} / エラー ${count('error')}`);
  for (const r of results.filter((x) => x.status === 'error')) console.log(`  [エラー] ${r.entry.personName} / ${r.entry.workId}: ${r.message}`);
  if (!args.apply) return;
  if (count('error') > 0) {
    console.error('想定外の状態があるため復元を中止しました。DBは変更していません。');
    process.exitCode = 1;
    return;
  }
  const grouped = new Map<string, typeof results>();
  for (const r of results.filter((x) => x.status === 'pending')) {
    const k = keyOf(r.entry.personName, r.entry.workId);
    grouped.set(k, [...(grouped.get(k) ?? []), r]);
  }
  if (grouped.size === 0) {
    console.log('すべて復元済みです。DBは変更していません。');
    return;
  }
  const queries = [...grouped.entries()].flatMap(([k, list]) => {
    const db = dbRows.get(k)!;
    const providers: VodProvider[] = providersOf(db.vodData).slice();
    for (const r of list) providers[r.providerIndex!] = r.entry.providerBefore;
    const after = { ...db.vodData, vodProviders: providers };
    return [
      neonSql`
        WITH u AS (
          UPDATE works SET vod_data = ${JSON.stringify(after)}::jsonb, updated_at = now()
          WHERE person_name = ${db.personName} AND id = ${db.id} AND deleted = false AND vod_data = ${JSON.stringify(db.vodData)}::jsonb
          RETURNING 1
        )
        SELECT 1 / (SELECT count(*)::int FROM u) AS ok`,
      neonSql`
        INSERT INTO vod_recheck_logs (person_name, work_id, action, performed_by, note, updated_provider_count)
        VALUES (${db.personName}, ${db.id}, 'note', ${`script:${FIX_ID}:rollback`}, ${'Prime Video追加チャンネル修正の復元'}, ${list.length})`,
    ];
  });
  await neonSql.transaction(queries);
  console.log(`復元完了: 作品行 ${grouped.size} 件 / provider ${count('pending')} 件`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rollback) await runRollback(args);
  else await runFix(args);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
