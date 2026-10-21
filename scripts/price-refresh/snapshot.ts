// 価格更新の前後比較（読み取りのみ。DB・Redis への書き込みなし）。
// 本番での小規模更新の前と後にスナップショットを取り、価格の項目（price・priceFetchedAt・レビュー）以外が
// 変わっていないこと（判定・商品件数・商品IDと並び・商品名・商品ページURL・アフィリエイトURL・その他の全項目）を確認し、
// 価格・価格の取得日時が変わった件数を数える。想定外の変更があれば終了コード1（自動更新を止める合図）。
// 出力はローカルの tmp/（git 管理外）。商品の中身はハッシュにして保存し、ファイルにも画面にも商品名・URLを出さない。
//
//   スナップショット: npx dotenv -e .env.local -- npx tsx scripts/price-refresh/snapshot.ts snapshot before.json "賀喜遥香,成田凌"
//   比較:             npx tsx scripts/price-refresh/snapshot.ts compare before.json after.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RakutenItem } from '@/types/rakuten';

const DIR = 'tmp/price-refresh-snapshots';
const h = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// 価格更新で変わってよい項目（これ以外が1つでも変わったら異常。商品名・画像・URL・アフィリエイトURL・ID・並びも不変）
const PRICE_FIELDS = new Set(['price', 'priceFetchedAt', 'reviewCount', 'reviewAverage']);

interface Snap {
  takenAt: string;
  persons: Record<string, {
    rows: Record<string, { count: number; ids: string; fetchedAt: string }>;
    items: Record<string, { protected: string; price: number; priceFetchedAt?: number }>;
    verdicts: string;
    verdictCount: number;
  }>;
}

async function snapshot(file: string, personsArg: string) {
  const { neonSql } = await import('@/db/client');
  const names = personsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('人物を指定してください（カンマ区切り）');
  const snap: Snap = { takenAt: new Date().toISOString(), persons: {} };
  for (const name of names) {
    const rows = (await neonSql`SELECT category, fetched_at, items FROM products WHERE person_name = ${name}`) as { category: string; fetched_at: string; items: RakutenItem[] }[];
    const verdicts = (await neonSql`SELECT product_id, verdict, score, source, reason, prompt_version FROM verdicts WHERE person_name = ${name} ORDER BY product_id`) as Record<string, unknown>[];
    const p: Snap['persons'][string] = { rows: {}, items: {}, verdicts: h(verdicts), verdictCount: verdicts.length };
    for (const r of rows) {
      p.rows[r.category] = { count: r.items.length, ids: h(r.items.map((i) => i.id)), fetchedAt: String(r.fetched_at) };
      for (const it of r.items) {
        const keep = Object.fromEntries(Object.entries(it).filter(([k]) => !PRICE_FIELDS.has(k)).sort());
        p.items[`${r.category}|${it.id}`] = { protected: h(keep), price: Number(it.price), priceFetchedAt: it.priceFetchedAt };
      }
    }
    snap.persons[name] = p;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const out = path.join(DIR, path.basename(file));
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(JSON.stringify({ saved: out, persons: names.length }));
}

function compare(aFile: string, bFile: string) {
  const read = (f: string): Snap => JSON.parse(fs.readFileSync(path.join(DIR, path.basename(f)), 'utf8'));
  const a = read(aFile), b = read(bFile);
  const problems: string[] = [];
  const info: Record<string, number> = { categoryRowsRefetched: 0, pricesChanged: 0, priceFetchedAtSet: 0, priceFetchedAtCleared: 0, itemsCompared: 0 };
  for (const [name, pa] of Object.entries(a.persons)) {
    const pb = b.persons[name];
    if (!pb) { problems.push(`${name}: 比較後のスナップショットに無い`); continue; }
    if (pa.verdicts !== pb.verdicts || pa.verdictCount !== pb.verdictCount) problems.push(`${name}: 判定（verdicts）が変わった`);
    for (const k of Object.keys(pb.items)) if (!pa.items[k]) problems.push(`${name}: 商品が増えた ${k.split('|')[1]}`);
    for (const cat of Object.keys(pb.rows)) if (!pa.rows[cat]) problems.push(`${name}/${cat}: カテゴリ行が増えた`);
    for (const [cat, ra] of Object.entries(pa.rows)) {
      const rb = pb.rows[cat];
      if (!rb) { problems.push(`${name}/${cat}: カテゴリ行が無くなった`); continue; }
      if (ra.count !== rb.count) problems.push(`${name}/${cat}: 商品件数が変わった ${ra.count}→${rb.count}`);
      if (ra.ids !== rb.ids) problems.push(`${name}/${cat}: 商品IDの並びが変わった`);
      if (ra.fetchedAt !== rb.fetchedAt) info.categoryRowsRefetched++;
    }
    for (const [k, ia] of Object.entries(pa.items)) {
      const ib = pb.items[k];
      if (!ib) { problems.push(`${name}: 商品が無くなった ${k.split('|')[1]}`); continue; }
      info.itemsCompared++;
      if (ia.protected !== ib.protected) problems.push(`${name}: 価格以外の項目が変わった ${k.split('|')[1]}`);
      if (ia.price !== ib.price) info.pricesChanged++;
      if (!ia.priceFetchedAt && ib.priceFetchedAt) info.priceFetchedAtSet++;
      if (ia.priceFetchedAt && !ib.priceFetchedAt) { info.priceFetchedAtCleared++; problems.push(`${name}: 価格の取得日時が消えた ${k.split('|')[1]}`); }
      if (ia.priceFetchedAt && ib.priceFetchedAt && ib.priceFetchedAt < ia.priceFetchedAt) problems.push(`${name}: 価格の取得日時が古くなった ${k.split('|')[1]}`);
    }
  }
  console.log(JSON.stringify({ ok: problems.length === 0, problems: problems.slice(0, 50), problemCount: problems.length, ...info }, null, 1));
  if (problems.length) process.exit(1);
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'snapshot') snapshot(x, y ?? '').catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
else if (cmd === 'compare') compare(x, y);
else { console.error('使い方: snapshot <file> "<人物,人物>" | compare <before> <after>'); process.exit(1); }
