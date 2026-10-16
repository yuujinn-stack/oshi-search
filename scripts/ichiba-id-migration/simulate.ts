// 楽天市場の商品ID移行のシミュレーション（読み取り専用。DB・Redis への書き込みは一切しない）。
// 計画ロジックは ./plan.ts。結果を tmp/ichiba-id-migration/<実行>-simulation/ に CSV・JSON で出力する。
//
// 実行方法:
//   npx dotenv -e .env.local -- npx tsx scripts/ichiba-id-migration/simulate.ts
import fs from 'fs';
import path from 'path';
import { neonSql } from '@/db/client';
import { planMigration, type ProductRow, type VerdictRow } from './plan';

const OUT_DIR = 'tmp/ichiba-id-migration';

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file: string, header: string[], rows: unknown[][]) {
  fs.writeFileSync(file, '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'utf-8');
}

async function main() {
  console.log('== 楽天市場の商品ID移行シミュレーション（読み取り専用：DB・Redis は変更しません） ==');
  const rows = ((await neonSql`
    SELECT p.person_name, p.category, p.items
    FROM products p
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) it WHERE it->>'id' LIKE 'ic-%' OR it->>'id' LIKE 'ich-%')
    ORDER BY p.person_name, p.category`) as { person_name: string; category: string; items: ProductRow['items'] }[])
    .map((r) => ({ personName: r.person_name, category: r.category, items: r.items }));
  const legacyVerdicts = ((await neonSql`
    SELECT person_name, product_id, verdict, source, score, reason FROM verdicts WHERE product_id LIKE 'ic-%' AND product_id NOT LIKE 'ich-%'`) as { person_name: string; product_id: string; verdict: string; source: string; score: string; reason: string | null }[])
    .map((v): VerdictRow => ({ personName: v.person_name, productId: v.product_id, verdict: v.verdict, source: v.source, score: v.score, reason: v.reason }));
  const newVerdicts = ((await neonSql`SELECT person_name, product_id, verdict, source FROM verdicts WHERE product_id LIKE 'ich-%'`) as { person_name: string; product_id: string; verdict: string; source: string }[])
    .map((v): VerdictRow => ({ personName: v.person_name, productId: v.product_id, verdict: v.verdict, source: v.source }));

  const { items, summary, verdictInserts } = planMigration(rows, legacyVerdicts, newVerdicts);

  const dir = path.join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-simulation`);
  fs.mkdirSync(dir, { recursive: true });
  writeCsv(path.join(dir, 'items.csv'),
    ['personName', 'category', 'index', 'legacyId', 'newId', 'status', 'currentVerdict', 'verdictSource', 'verdictPlan', 'hiddenAfterMigration', 'title'],
    items.map((i) => [i.personName, i.category, i.index, i.legacyId, i.newId ?? '', i.status, i.verdict ?? '', i.verdictSource ?? '', i.verdictPlan, i.hiddenAfterMigration, i.title]));
  writeCsv(path.join(dir, 'verdict-carry.csv'),
    ['personName', 'newProductId', 'fromLegacyProductId', 'verdict', 'source', 'score', 'reason'],
    verdictInserts.map((v) => [v.personName, v.productId, v.fromProductId, v.verdict, v.source, v.score ?? '', v.reason ?? '']));
  writeCsv(path.join(dir, 'review-list.csv'),
    ['personName', 'category', 'legacyId', 'newId', 'currentVerdict', 'verdictSource', 'hiddenAfterMigration', 'title'],
    items.filter((i) => i.verdictPlan === 'review_shared').map((i) => [i.personName, i.category, i.legacyId, i.newId ?? '', i.verdict ?? '', i.verdictSource ?? '', i.hiddenAfterMigration, i.title]));
  const hiddenByPerson: Record<string, number> = {};
  for (const i of items) if (i.hiddenAfterMigration) hiddenByPerson[i.personName] = (hiddenByPerson[i.personName] ?? 0) + 1;
  const reviewByVerdict: Record<string, number> = {};
  for (const i of items.filter((x) => x.verdictPlan === 'review_shared')) reviewByVerdict[`${i.verdict}/${i.verdictSource}`] = (reviewByVerdict[`${i.verdict}/${i.verdictSource}`] ?? 0) + 1;
  const carryByVerdict: Record<string, number> = {};
  for (const v of verdictInserts) carryByVerdict[`${v.verdict}/${v.source}`] = (carryByVerdict[`${v.verdict}/${v.source}`] ?? 0) + 1;
  const out = { summary, reviewByVerdict, carryByVerdict, hiddenPersons: Object.keys(hiddenByPerson).length, hiddenByPersonTop: Object.entries(hiddenByPerson).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(out, null, 1), 'utf-8');
  console.log(JSON.stringify(out, null, 1));
  console.log(`出力: ${dir}（items.csv・verdict-carry.csv・review-list.csv・summary.json）`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
