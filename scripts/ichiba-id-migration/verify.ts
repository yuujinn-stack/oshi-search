// 楽天市場の商品ID移行：本番公開・移行前の安全確認（読み取り専用。DB・Redis への書き込みは一切しない）。
// 本番DBの実データを読み込み、メモリ上で「新コードでの再取得」「移行」「復元」を再現して、公開中の商品・判定・
// affiliateUrl が変わらないことを確認する。楽天API・OpenAI は呼ばない。
//
// 実行方法:
//   npx dotenv -e .env.local -- npx tsx scripts/ichiba-id-migration/verify.ts
import { neonSql } from '@/db/client';
import { mergeProductItems, normalizeItemUrl } from '@/lib/product-store';
import { ichibaItemIdFromStoredItem, ichibaPageKey, isLegacyIchibaId } from '@/lib/rakuten-item-id';
import type { RakutenItem } from '@/types/rakuten';
import { applyPlanToRows, planMigration, rollbackPlan, type ProductRow, type VerdictRow } from './plan';

const k = (...p: string[]) => p.join('\u0000');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((x) => `${JSON.stringify(x)}:${stable((v as Record<string, unknown>)[x])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** 公開中の商品（verdict=related）の集合：人物・カテゴリ・商品ページ単位 */
function publishedSet(rows: ProductRow[], verdicts: Map<string, string>): Set<string> {
  const s = new Set<string>();
  for (const r of rows) for (const it of r.items) {
    if (verdicts.get(k(r.personName, it.id)) === 'related') s.add(k(r.personName, r.category, normalizeItemUrl(String(it.itemUrl ?? '')), String(it.title ?? '')));
  }
  return s;
}
const eqSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** 新コードの取得結果を再現：既存の楽天市場商品を、itemCode 付き・新IDで取り直したものとして作る */
function refetchOf(row: ProductRow, opts: { dropAffiliate?: boolean; extraNewProduct?: boolean; codeDiffers?: boolean } = {}): RakutenItem[] {
  const out: RakutenItem[] = [];
  for (const it of row.items) {
    if (!isLegacyIchibaId(it.id) && !String(it.id).startsWith('ich-')) continue;
    const page = ichibaPageKey(String(it.affiliateUrl || it.itemUrl || ''));
    if (!page) continue;
    const code = opts.codeDiffers ? `${page.code}-x` : page.code;
    const fetched = { ...(it as unknown as RakutenItem), id: `ich-${page.shop}:${code}`, itemCode: `${page.shop}:${code}` };
    if (opts.dropAffiliate) fetched.affiliateUrl = String(it.itemUrl ?? ''); // API が affiliateUrl を返さず itemUrl で代用された場合
    out.push(fetched);
  }
  if (opts.extraNewProduct && out[0]) {
    const p = ichibaPageKey(String(out[0].affiliateUrl || out[0].itemUrl))!;
    const url = `https://item.rakuten.co.jp/${p.shop}/zz-synthetic-new/`;
    out.push({ ...out[0], id: `ich-${p.shop}:zz-synthetic-new`, itemCode: `${p.shop}:zz-synthetic-new`, title: '同じ店舗の別商品（検証用）', itemUrl: url, affiliateUrl: url });
  }
  return out;
}

function refetchAll(rows: ProductRow[], verdictIds: Set<string>, opts: Parameters<typeof refetchOf>[1] = {}): ProductRow[] {
  return rows.map((r) => {
    const fetched = refetchOf(r, opts);
    if (fetched.length === 0) return r;
    const { items } = mergeProductItems(fetched, r.items as unknown as RakutenItem[], verdictIds);
    // mergeProductItems は fetched の順に並べるため、比較は id → 内容で行う
    return { ...r, items: items as unknown as ProductRow['items'] };
  });
}

async function main() {
  console.log('== 楽天市場の商品ID移行：本番公開・移行前の安全確認（読み取り専用） ==');
  const rows = ((await neonSql`
    SELECT p.person_name, p.category, p.items FROM products p
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) it WHERE it->>'id' LIKE 'ic-%' OR it->>'id' LIKE 'ich-%')
    ORDER BY 1, 2`) as { person_name: string; category: string; items: ProductRow['items'] }[])
    .map((r) => ({ personName: r.person_name, category: r.category, items: r.items }));
  const persons = [...new Set(rows.map((r) => r.personName))];
  const verdictRows = ((await neonSql`SELECT person_name, product_id, verdict, source, score, reason FROM verdicts WHERE person_name = ANY(${persons}::text[])`) as { person_name: string; product_id: string; verdict: string; source: string; score: string; reason: string | null }[])
    .map((v): VerdictRow => ({ personName: v.person_name, productId: v.product_id, verdict: v.verdict, source: v.source, score: v.score, reason: v.reason }));
  const vmap = (vs: VerdictRow[]) => new Map(vs.map((v) => [k(v.personName, v.productId), v.verdict]));
  const verdictIdsOf = (person: string) => new Set(verdictRows.filter((v) => v.personName === person).map((v) => v.productId));
  const allVerdictIds = new Set(verdictRows.map((v) => v.productId));
  const before = publishedSet(rows, vmap(verdictRows));
  const ichibaCount = rows.reduce((s, r) => s + r.items.filter((i) => isLegacyIchibaId(i.id)).length, 0);
  console.log(`対象 ${rows.length} 行・楽天市場商品 ${ichibaCount} 件・公開中（この行の範囲）${before.size} 件`);

  const plan = planMigration(rows, verdictRows.filter((v) => isLegacyIchibaId(v.productId)), verdictRows.filter((v) => v.productId.startsWith('ich-')));
  const deferred = plan.items.filter((i) => i.status === 'deferred_shared');

  // ── S1：コードだけ先に公開し、定期取得で同じ商品を取り直した場合 ──
  const s1 = refetchAll(rows, allVerdictIds);
  const idsBefore = new Set(rows.flatMap((r) => r.items.map((i) => k(r.personName, r.category, i.id))));
  const idsAfterS1 = new Set(s1.flatMap((r) => r.items.map((i) => k(r.personName, r.category, i.id))));
  check('S1 再取得しても既存商品のIDは変わらない（旧IDのまま）', eqSet(idsBefore, idsAfterS1), `${idsBefore.size} → ${idsAfterS1.size}`);
  check('S1 商品数が変わらない（消えない・増えない）', rows.every((r, i) => r.items.length === s1[i].items.length));
  const contentSame = rows.every((r, i) => {
    const after = new Map(s1[i].items.map((x) => [x.id, x]));
    return r.items.every((it) => { const a = after.get(it.id); if (!a) return false; const { itemCode: _c, ...rest } = a as Record<string, unknown>; void _c; return stable(rest) === stable(it); });
  });
  check('S1 商品の中身（商品名・URL・affiliateUrl・価格等）が変わらない（itemCode が記録されるだけ）', contentSame);
  check('S1 公開中の商品が変わらない（消えない・入れ替わらない）', eqSet(before, publishedSet(s1, vmap(verdictRows))));
  const deferredAfter = deferred.every((d) => s1.find((r) => r.personName === d.personName && r.category === d.category)!.items.some((it) => it.id === d.legacyId));
  check('S1 移行対象外の478件は旧IDのまま残り、判定の共有状態も現状どおり', deferredAfter, `${deferred.length} 件`);

  // ── S2：API が affiliateUrl を返さなかった場合 ──
  const s2 = refetchAll(rows, allVerdictIds, { dropAffiliate: true });
  const affKept = rows.every((r, i) => { const m = new Map(s2[i].items.map((x) => [x.id, x])); return r.items.every((it) => m.get(it.id)?.affiliateUrl === it.affiliateUrl); });
  check('S2 正規 affiliateUrl が通常URLで上書きされない', affKept);

  // ── S3：同じ店舗の別商品が新しく見つかった場合 ──
  const s3 = refetchAll(rows, allVerdictIds, { extraNewProduct: true });
  const added = s3.reduce((n, r, i) => n + (r.items.length - rows[i].items.length), 0);
  const noDupIds = s3.every((r) => new Set(r.items.map((i) => i.id)).size === r.items.length);
  check('S3 同じ店舗の別商品は新IDで別に追加され、既存商品は変わらない', added === rows.filter((r) => refetchOf(r).length > 0).length && noDupIds, `追加 ${added} 件・行内ID重複なし ${noDupIds}`);
  check('S3 新しく追加された商品は未判定（公開されない）・既存の公開は不変', eqSet(before, publishedSet(s3, vmap(verdictRows))));

  // ── S4：itemCode の商品コードが URL と異なる場合 ──
  const s4 = refetchAll(rows, allVerdictIds, { codeDiffers: true });
  check('S4 itemCode と URL が食い違っても既存IDは変わらない', eqSet(idsBefore, new Set(s4.flatMap((r) => r.items.map((i) => k(r.personName, r.category, i.id))))));

  // ── S5：移行（メモリ上） ──
  const migrated = applyPlanToRows(rows, plan.items);
  const verdictsAfter = [...verdictRows, ...plan.verdictInserts.map(({ fromProductId: _f, ...v }) => { void _f; return v; })];
  check('S5 移行後も公開中の商品が完全に同じ（消えない・入れ替わらない）', eqSet(before, publishedSet(migrated, vmap(verdictsAfter))), `${before.size} 件`);
  const changedOnlyId = rows.every((r, i) => r.items.every((it, j) => { const a = migrated[i].items[j]; const { id: _a, ...ra } = a; const { id: _b, ...rb } = it; void _a; void _b; return stable(ra) === stable(rb); }));
  check('S5 変わるのは商品IDだけ（他のフィールド・順序・件数は不変）', changedOnlyId);
  const idChanged = rows.reduce((n, r, i) => n + r.items.filter((it, j) => it.id !== migrated[i].items[j].id).length, 0);
  check('S5 IDを書き換える件数がシミュレーションどおり', idChanged === plan.summary.migrateItems, `${idChanged} 件`);
  const carriedOk = plan.verdictInserts.every((v) => {
    const legacy = verdictRows.find((x) => x.personName === v.personName && x.productId === v.fromProductId)!;
    const pages = new Set(rows.filter((r) => r.personName === v.personName).flatMap((r) => r.items.filter((it) => it.id === v.fromProductId).map((it) => ichibaItemIdFromStoredItem(it))));
    return pages.size === 1 && pages.has(v.productId) && legacy.verdict === v.verdict && legacy.source === v.source && String(legacy.score) === String(v.score);
  });
  check('S5 引き継ぐ判定は、旧IDに対応する商品がちょうど1つで、その商品の新IDにだけ同じ値で付く', carriedOk, `${plan.verdictInserts.length} 行`);
  check('S5 移行後の各行で商品IDの重複なし', migrated.every((r) => new Set(r.items.map((i) => i.id)).size === r.items.length));

  // ── S6：復元 ──
  const rb = rollbackPlan(rows, verdictsAfter, plan.verdictInserts);
  check('S6 復元後の商品データが移行前と完全に一致', stable(rb.rows) === stable(rows));
  check('S6 復元後の判定が移行前と完全に一致（旧ID判定は削除していないため）', stable([...rb.verdicts].sort((a, b) => k(a.personName, a.productId).localeCompare(k(b.personName, b.productId)))) === stable([...verdictRows].sort((a, b) => k(a.personName, a.productId).localeCompare(k(b.personName, b.productId)))));

  // ── S7：コード公開後・移行前に定期取得が入った場合の移行 ──
  const vIdsS3 = new Set([...allVerdictIds]);
  void vIdsS3;
  const plan7 = planMigration(s3, verdictRows.filter((v) => isLegacyIchibaId(v.productId)), verdictRows.filter((v) => v.productId.startsWith('ich-')));
  check('S7 公開後に取得が入っても、移行で新ID同士・既存IDと衝突しない', plan7.summary.collisionInRow === 0 && plan7.summary.collisionWithExistingId === 0 && plan7.summary.conflictExistingNewVerdict === 0, JSON.stringify({ migrate: plan7.summary.migrateItems, deferred: plan7.summary.deferredShared }));
  const migrated7 = applyPlanToRows(s3, plan7.items);
  const va7 = [...verdictRows, ...plan7.verdictInserts.map(({ fromProductId: _f, ...v }) => { void _f; return v; })];
  check('S7 その場合も移行後の公開中の商品は変わらない', eqSet(before, publishedSet(migrated7, vmap(va7))));

  // ── S8：移行後に定期取得が入った場合 ──
  const s8 = refetchAll(migrated, new Set(verdictsAfter.map((v) => v.productId)));
  check('S8 移行後の再取得でもIDが変わらず、公開中の商品も変わらない', eqSet(new Set(migrated.flatMap((r) => r.items.map((i) => k(r.personName, r.category, i.id)))), new Set(s8.flatMap((r) => r.items.map((i) => k(r.personName, r.category, i.id))))) && eqSet(before, publishedSet(s8, vmap(verdictsAfter))));

  const ng = results.filter((r) => !r.ok);
  console.log(ng.length === 0 ? `\n全 ${results.length} 項目 OK` : `\nNG ${ng.length} 項目`);
  void verdictIdsOf;
  if (ng.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
