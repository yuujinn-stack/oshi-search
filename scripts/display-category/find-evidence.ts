// 表示分類の根拠つき補正（src/lib/display-category-evidence.ts）の候補を、本番DBを読み取り専用で照合して作る・検証する。
//
//   npx tsx scripts/display-category/find-evidence.ts
//
// - 対象：判定 related の「写真集」「本・雑誌」の商品のうち、商品名だけでは CD か映像か分からず「その他」（要確認）になる楽天ブックスの商品。
// - 根拠：同じ楽天ブックスの商品番号（books.rakuten.co.jp/rb/<番号>）の商品が、CD カテゴリ（楽天ブックスの CD 検索で取得）または
//   Blu-ray・DVD カテゴリ（DVD 検索で取得）に保存されていること。判定（verdict）は問わない（形式の根拠であり、関連の根拠ではない）。
//   どちらか一方だけにあれば候補、両方にある・どちらにも無い商品は候補にしない（要確認のまま）。商品名では照合しない。
// - 出力：候補の一覧と、現在の一覧（DISPLAY_CATEGORY_EVIDENCE）との違い（根拠が無くなった・形式が変わった商品は「要見直し」）。
// - DB は READ ONLY のトランザクションで SELECT だけ。書き込み・楽天APIの呼び出しはしない。接続文字列・エラーの秘密は表示しない。
import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { classifyProductDetailed } from '../../src/lib/product-curation';
import { productKeyOfLink } from '../../src/lib/rakuten-affiliate-link';
import { DISPLAY_CATEGORY_EVIDENCE } from '../../src/lib/display-category-evidence';
import type { ProductCategory } from '../../src/types/person';

const ROOT = path.resolve(__dirname, '..', '..');

function readUrl(): string {
  const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
  if (!m) throw new Error('.env.local に DATABASE_URL がありません');
  return m[1].replace(/^['"]|['"]$/g, '');
}

const booksNumber = (url: unknown): string | null => {
  const k = productKeyOfLink(typeof url === 'string' ? url : '');
  return k?.source === 'books' ? k.productNumber : null;
};

async function main() {
  const sql = neon(readUrl());
  const [discRows, bookRows] = await sql.transaction([
    sql.query(`SELECT p.category, e.item->>'itemUrl' AS u, e.item->>'affiliateUrl' AS a
      FROM products p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items)='array' THEN p.items ELSE '[]'::jsonb END) e(item)
      WHERE p.category IN ('CD', 'Blu-ray・DVD')`),
    sql.query(`SELECT p.person_name, p.category, e.item->>'id' AS id, e.item->>'title' AS t, e.item->>'itemUrl' AS u
      FROM products p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items)='array' THEN p.items ELSE '[]'::jsonb END) e(item)
      JOIN verdicts v ON v.person_name = p.person_name AND v.product_id = e.item->>'id'
      WHERE p.category IN ('写真集', '本・雑誌') AND v.verdict = 'related'`),
  ], { readOnly: true }) as Record<string, unknown>[][];

  const formats = new Map<string, Set<string>>();
  for (const r of discRows) {
    const n = booksNumber(r.u) ?? booksNumber(r.a);
    if (n) (formats.get(n) ?? formats.set(n, new Set()).get(n)!).add(String(r.category));
  }
  type Cand = { number: string; title: string; formats: string[]; rows: number; persons: Set<string> };
  const cands = new Map<string, Cand>();
  for (const r of bookRows) {
    const title = String(r.t ?? '');
    const cls = classifyProductDetailed(title, r.category as ProductCategory, String(r.u ?? ''), { useEvidence: false });
    if (!cls.needsReview) continue;
    const n = booksNumber(r.u);
    if (!n) continue;
    const c = cands.get(n) ?? cands.set(n, { number: n, title, formats: [...(formats.get(n) ?? [])].sort(), rows: 0, persons: new Set() }).get(n)!;
    c.rows++; c.persons.add(String(r.person_name));
  }
  const list = [...cands.values()].sort((a, b) => b.rows - a.rows);
  const one = list.filter((c) => c.formats.length === 1);
  console.log(`要確認になる楽天ブックスの商品：${list.length} 商品・${list.reduce((s, c) => s + c.rows, 0)} 件（人物別）`);
  console.log(`  CD だけに根拠：${one.filter((c) => c.formats[0] === 'CD').length} 商品・映像だけに根拠：${one.filter((c) => c.formats[0] === 'Blu-ray・DVD').length} 商品・両方：${list.filter((c) => c.formats.length > 1).length} 商品・根拠なし：${list.filter((c) => !c.formats.length).length} 商品\n`);
  for (const c of list) {
    const mark = c.formats.length === 1 ? `候補→${c.formats[0]}` : c.formats.length ? '要確認（両方に根拠）' : '要確認（根拠なし）';
    const cur = DISPLAY_CATEGORY_EVIDENCE[c.number];
    const state = cur ? (c.formats.length === 1 && cur.section === c.formats[0] ? '一覧に登録済み' : '★要見直し（一覧と根拠が一致しない）') : c.formats.length === 1 ? '一覧に未登録' : '';
    console.log(`${c.number}｜${mark}｜${c.rows}件・${c.persons.size}人｜${state}｜${c.title.slice(0, 60)}`);
  }
  // 一覧にあるが、今回は要確認の商品として出てこなかった（商品名の規則で分類できるようになった・商品が無くなった等）
  const stale = Object.keys(DISPLAY_CATEGORY_EVIDENCE).filter((n) => !cands.has(n));
  if (stale.length) console.log(`\n一覧にあるが要確認の商品として見つからない商品番号（補正は効かないため害は無いが、整理の候補）：${stale.join(', ')}`);
}

main().catch((e) => {
  const x = e as { name?: string; code?: string };
  console.error(`エラー: ${x.name ?? 'Error'} ${x.code ?? ''}`);
  process.exitCode = 1;
});
