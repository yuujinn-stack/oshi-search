// 手動登録の楽天商品で、アフィリエイトURLになっていない affiliateUrl の修正（2026-10・1回限り）の判定ロジック
// （純粋関数・DB非依存）。実行スクリプト本体は ./run.ts。
//
// 対象：管理画面の手動追加（/api/admin/product-manual）で登録された商品（ID が mn-）のうち、
//       affiliateUrl が通常の楽天ブックスURL（https?://books.rakuten.co.jp/rb/<商品番号>/）のもの。
// 修正：同じ商品番号について楽天API（affiliateId 付き）がすでに発行して DB に保存しているアフィリエイトURL
//       （hb.afl.rakuten.co.jp/hgc/…/?pc=<books.rakuten.co.jp/rb/<商品番号>/>）を、affiliateUrl にだけ設定する。
//       新しいURLを推測で組み立てることはしない（流用元が無い商品は no_source として変更しない）。
// 変更しないもの：商品ID・itemUrl（元の商品URL・商品番号）・商品名・価格・その他のフィールド・AI判定（verdicts）。
// 短縮URL（a.r10.to 等）や楽天ブックス以外のURLは、発行元・成果対象を確認できないため変更しない（展開もしない）。
//
// 商品ID重複問題（src/lib/rakuten.ts の stableId。楽天市場の同一ショップの別商品が同じIDになる）による誤更新を防ぐため、
// 更新対象は (人物, カテゴリ, 配列内の位置, 商品ID, 現在の affiliateUrl, itemUrl) がすべて一致する要素だけにする。
// 同じ行に同じ商品IDが複数ある場合は、その商品は変更しない。

export const FIX_ID = 'manual-rakuten-affiliate-url-fix-2026-10';

export interface ProductItem {
  id: string;
  title?: string;
  price?: number;
  itemUrl?: string;
  affiliateUrl?: string;
  [key: string]: unknown;
}

export interface ProductRow {
  personName: string;
  category: string;
  items: ProductItem[];
}

/** 流用元：楽天API（手動登録以外）が発行した楽天ブックス商品のアフィリエイトURL */
export interface SourceLink {
  id: string;
  title: string;
  url: string;
}

export type ItemStatus =
  | 'pending'              // 変更予定
  | 'already_applied'      // 既に修正後の状態
  | 'no_source'            // 同じ商品番号のアフィリエイトURLがDB内に無い（変更しない）
  | 'ambiguous_source'     // 同じ商品番号に異なるアフィリエイトURLが複数ある（変更しない）
  | 'title_mismatch'       // 流用元と商品名が一致しない（変更しない）
  | 'invalid_source'       // 流用元のURLが想定形式でない（変更しない）
  | 'duplicate_id_in_row'  // 同じ行に同じ商品IDが複数ある（誤更新防止のため変更しない）
  | 'skip_unverified';     // 短縮URL等。発行元・成果対象を確認できないため変更しない

export interface ItemResult {
  status: ItemStatus;
  personName: string;
  category: string;
  index: number;
  id: string;
  title: string;
  itemUrl: string;
  before: string;
  after?: string;
  productNumber?: string;
  source?: SourceLink;
  message?: string;
}

const BOOKS_PLAIN_RE = /^https?:\/\/books\.rakuten\.co\.jp\/rb\/(\d+)\/?(?:[?#].*)?$/;
// 楽天ブックスCD・DVD検索APIは http:// で返すため http/https の両方を受け付ける
const AFFILIATE_RE = /^https?:\/\/hb\.afl\.rakuten\.co\.jp\/hgc\/([^/?#]+)\/\?pc=([^&#]+)/;

/** 通常の楽天ブックス商品URLから商品番号を取り出す（それ以外は null） */
export function booksProductNumber(url: string | undefined): string | null {
  const m = BOOKS_PLAIN_RE.exec(url ?? '');
  return m ? m[1] : null;
}

/** 楽天アフィリエイトURL（hb.afl…/hgc/…/?pc=…）の識別部分と遷移先（pc）を取り出す */
export function parseAffiliateUrl(url: string | undefined): { hgc: string; pc: string } | null {
  const m = AFFILIATE_RE.exec(url ?? '');
  if (!m) return null;
  try {
    return { hgc: m[1], pc: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/** アフィリエイトURLの遷移先が楽天ブックスの商品ページなら商品番号を返す */
export function affiliateBooksProductNumber(url: string | undefined): string | null {
  const p = parseAffiliateUrl(url);
  return p ? booksProductNumber(p.pc) : null;
}

export function isAffiliateUrl(url: string | undefined): boolean {
  return /^https?:\/\/hb\.afl\.rakuten\.co\.jp\//.test(url ?? '');
}

/** 商品名の比較用正規化（全半角・空白・【…】の付記の違いだけを吸収） */
export function normalizeTitle(s: string | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/【[^】]*】/g, '').replace(/\s+/g, '').toLowerCase();
}

export function titlesMatch(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (x.length < 4 || y.length < 4) return x === y && x.length > 0;
  return x === y || x.includes(y) || y.includes(x);
}

/** 商品番号ごとの流用元。異なるURLが複数ある場合は ambiguous として扱う */
export function buildSourceIndex(sources: SourceLink[]): Map<string, { links: SourceLink[]; urls: Set<string> }> {
  const index = new Map<string, { links: SourceLink[]; urls: Set<string> }>();
  for (const s of sources) {
    const n = affiliateBooksProductNumber(s.url);
    if (!n) continue;
    const e = index.get(n) ?? { links: [], urls: new Set<string>() };
    e.links.push(s);
    e.urls.add(s.url);
    index.set(n, e);
  }
  return index;
}

/**
 * 流用するURLを1つに決める。URLが1種類ならそれ。http/https の違いだけなら既存の https のもの。
 * それ以外（別の識別部分・別の遷移先など）は決められないので null。新しいURLは組み立てない。
 */
export function pickSourceUrl(urls: Set<string>): string | null {
  const list = [...urls];
  if (list.length === 1) return list[0];
  // 楽天ブックスCD・DVD検索APIは外側も遷移先（pc）も http:// で返す。識別部分と商品番号が同じなら同じリンクとみなす
  const keys = new Set(list.map((u) => {
    const p = parseAffiliateUrl(u);
    const n = p ? booksProductNumber(p.pc) : null;
    return p && n ? `${p.hgc}|${n}` : `raw|${u}`;
  }));
  if (keys.size !== 1 || [...keys][0].startsWith('raw|')) return null;
  return list.find((u) => u.startsWith('https:')) ?? null;
}

/**
 * 1件ごとの判定。
 * @param booksHgc 楽天APIが楽天ブックス商品に発行するアフィリエイトURLの識別部分（DB全体で1種類であることを run.ts で確認済みの値）
 */
export function evaluateRows(
  rows: ProductRow[],
  sourceIndex: ReturnType<typeof buildSourceIndex>,
  booksHgc: string,
): ItemResult[] {
  const results: ItemResult[] = [];
  for (const row of rows) {
    const idCounts = new Map<string, number>();
    for (const it of row.items) idCounts.set(it.id, (idCounts.get(it.id) ?? 0) + 1);

    row.items.forEach((it, index) => {
      if (!it.id?.startsWith('mn-')) return;
      const before = it.affiliateUrl ?? '';
      const itemUrl = it.itemUrl ?? '';
      const base = { personName: row.personName, category: row.category, index, id: it.id, title: it.title ?? '', itemUrl, before };

      if (isAffiliateUrl(before)) {
        // 修正後の状態（itemUrl は通常の楽天ブックスURLのまま、affiliateUrl が同じ商品番号の流用元URL）なら適用済み
        const n = booksProductNumber(itemUrl);
        if (n && affiliateBooksProductNumber(before) === n) {
          const src = sourceIndex.get(n);
          if (src && pickSourceUrl(src.urls) === before) {
            results.push({ ...base, status: 'already_applied', after: before, productNumber: n, source: src.links[0] });
          }
        }
        return; // もともとアフィリエイトURLの商品は対象外
      }

      const n = booksProductNumber(before);
      if (!n) {
        results.push({ ...base, status: 'skip_unverified', message: '楽天ブックスの通常URLではない（短縮URL等）。発行元・成果対象を確認できないため変更しない' });
        return;
      }
      if ((idCounts.get(it.id) ?? 0) > 1) {
        results.push({ ...base, status: 'duplicate_id_in_row', productNumber: n, message: '同じ行に同じ商品IDが複数ある' });
        return;
      }
      if (booksProductNumber(itemUrl) !== n) {
        results.push({ ...base, status: 'invalid_source', productNumber: n, message: 'itemUrl と affiliateUrl の商品番号が一致しない' });
        return;
      }
      const src = sourceIndex.get(n);
      if (!src) {
        results.push({ ...base, status: 'no_source', productNumber: n, message: '同じ商品番号のアフィリエイトURLがDB内に無い' });
        return;
      }
      const url = pickSourceUrl(src.urls);
      if (!url) {
        results.push({ ...base, status: 'ambiguous_source', productNumber: n, message: `同じ商品番号に異なるURLが ${src.urls.size} 種類ある` });
        return;
      }
      const parsed = parseAffiliateUrl(url);
      if (!parsed || parsed.hgc !== booksHgc || booksProductNumber(parsed.pc) !== n || new URL(parsed.pc).hostname !== 'books.rakuten.co.jp') {
        results.push({ ...base, status: 'invalid_source', productNumber: n, source: src.links[0], message: '流用元URLの形式・遷移先が想定と異なる' });
        return;
      }
      const titled = src.links.find((l) => titlesMatch(l.title, it.title));
      if (!titled) {
        results.push({ ...base, status: 'title_mismatch', productNumber: n, source: src.links[0], message: '流用元と商品名が一致しない' });
        return;
      }
      results.push({ ...base, status: 'pending', after: url, productNumber: n, source: titled });
    });
  }
  return results;
}

export interface RowUpdate {
  personName: string;
  category: string;
  beforeItems: ProductItem[];
  afterItems: ProductItem[];
  changes: ItemResult[];
}

/**
 * 変更予定を行ごとにまとめ、affiliateUrl だけを差し替えた items を作る。
 * 対象要素の id・affiliateUrl・itemUrl が判定時と一致しない場合は例外（誤更新防止）。
 */
export function buildRowUpdates(rows: ProductRow[], results: ItemResult[]): RowUpdate[] {
  const byRow = new Map<string, ItemResult[]>();
  for (const r of results.filter((x) => x.status === 'pending')) {
    const k = `${r.personName}\u0000${r.category}`;
    byRow.set(k, [...(byRow.get(k) ?? []), r]);
  }
  const updates: RowUpdate[] = [];
  for (const row of rows) {
    const changes = byRow.get(`${row.personName}\u0000${row.category}`);
    if (!changes) continue;
    const afterItems = row.items.map((it) => ({ ...it }));
    for (const c of changes) {
      const cur = row.items[c.index];
      if (!cur || cur.id !== c.id || (cur.affiliateUrl ?? '') !== c.before || (cur.itemUrl ?? '') !== c.itemUrl) {
        throw new Error(`判定時と状態が異なります: ${c.personName} / ${c.category} / ${c.index} / ${c.id}`);
      }
      afterItems[c.index] = { ...cur, affiliateUrl: c.after! };
    }
    assertOnlyAffiliateUrlChanged(row.items, afterItems);
    updates.push({ personName: row.personName, category: row.category, beforeItems: row.items, afterItems, changes });
  }
  return updates;
}

/** affiliateUrl 以外のフィールド・要素数・並び順が変わっていないことを確認する */
export function assertOnlyAffiliateUrlChanged(before: ProductItem[], after: ProductItem[]): void {
  if (before.length !== after.length) throw new Error('要素数が変わっています');
  before.forEach((b, i) => {
    const a = after[i];
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const k of keys) {
      if (k === 'affiliateUrl') continue;
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) throw new Error(`affiliateUrl 以外が変わっています: ${b.id} の ${k}`);
    }
  });
}

export function summarize(results: ItemResult[]) {
  const byStatus: Record<ItemStatus, number> = {
    pending: 0, already_applied: 0, no_source: 0, ambiguous_source: 0, title_mismatch: 0,
    invalid_source: 0, duplicate_id_in_row: 0, skip_unverified: 0,
  };
  for (const r of results) byStatus[r.status]++;
  return { total: results.length, byStatus };
}

/** 表示用：アフィリエイトURLの識別部分を伏せる */
export function maskAffiliateUrl(url: string | undefined): string {
  return (url ?? '').replace(/\/hgc\/[^/]+\//, '/hgc/***/');
}
