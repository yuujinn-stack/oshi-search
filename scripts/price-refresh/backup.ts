// 価格更新の前の状態をローカルに保存し、必要なら戻す（Neon のブランチを使わない方法）。
//
//   保存（読み取りのみ）:
//     npx dotenv -e .env.local -- npx tsx scripts/price-refresh/backup.ts export "成田凌"
//     → tmp/price-refresh-backups/<日時>/ に、人物ごとの products の行（items・fetched_at）と verdicts を JSON で保存（git 管理外）
//   戻す前の確認（読み取りのみ・既定）:
//     npx dotenv -e .env.local -- npx tsx scripts/price-refresh/backup.ts restore tmp/price-refresh-backups/<日時> "成田凌"
//     → 保存時と違うカテゴリ行・判定の違いを表示するだけ
//   戻す（書き込み。緊急時のみ・ユーザーの判断で）:
//     PRICE_REFRESH_RESTORE_CONFIRM=yes ... backup.ts restore <dir> "成田凌" --apply
//     → 違いのある products の行だけ、保存時の items と fetched_at に UPDATE で戻す（判定は価格更新で変わらないため対象外）
//
// 保存したファイルには楽天の商品情報が含まれるため、ローカルの tmp/ 以外に置かない・共有しない。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RakutenItem } from '@/types/rakuten';

const ROOT = 'tmp/price-refresh-backups';
const h = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

interface BackupFile {
  person: string;
  savedAt: string;
  products: { category: string; fetchedAt: string; items: RakutenItem[] }[];
  verdicts: Record<string, unknown>[];
}

async function exportBackup(personsArg: string) {
  const { neonSql } = await import('@/db/client');
  const names = personsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) throw new Error('人物を指定してください');
  const dir = path.join(ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  for (const person of names) {
    const products = (await neonSql`SELECT category, fetched_at, items FROM products WHERE person_name = ${person} ORDER BY category`) as { category: string; fetched_at: string; items: RakutenItem[] }[];
    const verdicts = (await neonSql`SELECT product_id, verdict, score, source, reason, prompt_version, judged_at, updated_at FROM verdicts WHERE person_name = ${person} ORDER BY product_id`) as Record<string, unknown>[];
    const file: BackupFile = { person, savedAt: new Date().toISOString(), products: products.map((r) => ({ category: r.category, fetchedAt: new Date(r.fetched_at).toISOString(), items: r.items })), verdicts };
    fs.writeFileSync(path.join(dir, `${crypto.createHash('sha1').update(person).digest('hex').slice(0, 12)}.json`), JSON.stringify(file));
    console.log(JSON.stringify({ person, categories: products.length, items: products.reduce((n, r) => n + r.items.length, 0), verdicts: verdicts.length }));
  }
  console.log(JSON.stringify({ saved: dir }));
}

async function restore(dir: string, personsArg: string, apply: boolean) {
  const { neonSql } = await import('@/db/client');
  const names = new Set(personsArg.split(',').map((s) => s.trim()).filter(Boolean));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as BackupFile);
  if (apply && process.env.PRICE_REFRESH_RESTORE_CONFIRM !== 'yes') throw new Error('戻すには PRICE_REFRESH_RESTORE_CONFIRM=yes が必要です');
  for (const b of files.filter((f) => names.size === 0 || names.has(f.person))) {
    const cur = (await neonSql`SELECT category, fetched_at, items FROM products WHERE person_name = ${b.person}`) as { category: string; fetched_at: string; items: RakutenItem[] }[];
    const curBy = new Map(cur.map((r) => [r.category, r]));
    const changed = b.products.filter((r) => { const c = curBy.get(r.category); return !c || h(c.items) !== h(r.items) || new Date(c.fetched_at).toISOString() !== r.fetchedAt; });
    const v = (await neonSql`SELECT product_id, verdict, score, source, reason, prompt_version, judged_at, updated_at FROM verdicts WHERE person_name = ${b.person} ORDER BY product_id`) as Record<string, unknown>[];
    const verdictsSame = h(v) === h(b.verdicts);
    console.log(JSON.stringify({ person: b.person, changedCategories: changed.map((r) => r.category), verdictsUnchanged: verdictsSame, mode: apply ? 'apply' : 'dry-run' }));
    if (!apply) continue;
    for (const r of changed) {
      await neonSql`UPDATE products SET items = ${JSON.stringify(r.items)}::jsonb, fetched_at = ${r.fetchedAt} WHERE person_name = ${b.person} AND category = ${r.category}`;
    }
    console.log(JSON.stringify({ person: b.person, restoredCategories: changed.length }));
  }
}

const [cmd, a, b] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
(cmd === 'export' ? exportBackup(a ?? '') : cmd === 'restore' ? restore(a, b ?? '', apply) : Promise.reject(new Error('使い方: export "<人物>" | restore <dir> "<人物>" [--apply]')))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
