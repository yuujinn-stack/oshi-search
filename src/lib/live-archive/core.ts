// 過去のライブ映像発掘特集の純粋関数（DB・API・React 非依存）。
// 掲載リスト（catalog.ts）と既存の商品データ（products.items の RakutenItem）を楽天ブックスの商品番号で結びつける。
// 商品名からライブ映像かどうかを推測することはしない（掲載リストにある商品番号だけ）。
import { productKeyOfLink } from '@/lib/rakuten-affiliate-link';
import type { RakutenItem } from '@/types/rakuten';
import {
  LIVE_ARCHIVE_GROUPS, LIVE_PERFORMANCES,
  type LiveArchiveGroup, type LiveEdition, type LiveFormat, type LivePerformance,
} from './catalog';

export type LiveSort = 'old' | 'new';
export type LiveFormatFilter = 'all' | LiveFormat;

/** 表示用の商品（クライアントに渡す最小限の値。価格は price-freshness で古さを付けた後の値） */
export interface LiveArchiveItem {
  productId: string;
  productNumber: string;
  format: LiveFormat;
  edition: LiveEdition;
  spec?: string;
  /** 楽天アフィリエイトURL（無ければ商品ページURL）。既存の商品データの値 */
  href: string;
  imageUrl: string;
  /** 価格が表示できる（取得日時が分かり古くない）ときだけ。それ以外は null（「価格は楽天で確認」）。在庫は扱わない */
  price: number | null;
  priceDateLabel: string | null;
}

export interface LiveArchiveEntry {
  id: string;
  title: string;
  releaseDate: string;
  releaseYear: number;
  recorded?: string;
  sourceUrl: string;
  imageUrl: string;
  items: LiveArchiveItem[];
}

export function liveArchiveGroupOf(groupName: string): LiveArchiveGroup | null {
  return LIVE_ARCHIVE_GROUPS.find((g) => g.groupName === groupName) ?? null;
}

export function isLiveArchiveGroup(groupName: string): boolean {
  return liveArchiveGroupOf(groupName) !== null;
}

/**
 * 人物ページの導線を出すグループ。現在の所属グループ（src/lib/group-membership.ts currentMemberships の結果）のうち
 * 特集の対象だけを、渡された順・重複なしで返す。過去の所属（卒業・脱退・formerGroupNames）は渡さない前提
 * （在籍していない時期の公演を本人に結びつけないため）。
 */
export function liveArchiveGroupsForPerson(currentGroupNames: string[]): string[] {
  const out: string[] = [];
  for (const g of currentGroupNames) {
    if (isLiveArchiveGroup(g) && !out.includes(g)) out.push(g);
  }
  return out;
}

export function performancesOf(groupName: string): LivePerformance[] {
  return LIVE_PERFORMANCES.filter((p) => p.groupName === groupName);
}

/** 楽天ブックスの商品番号（商品URL → アフィリエイトURLの遷移先 の順）。分からなければ null */
export function booksProductNumberOf(item: Pick<RakutenItem, 'itemUrl' | 'affiliateUrl'>): string | null {
  for (const url of [item.itemUrl, item.affiliateUrl]) {
    const key = productKeyOfLink(url);
    if (key?.source === 'books') return key.productNumber;
  }
  return null;
}

/** 商品データを楽天ブックスの商品番号で引けるようにする（同じ番号は最初の1件。中古・楽天市場の商品は対象外） */
export function indexByBooksNumber(items: Iterable<RakutenItem>): Map<string, RakutenItem> {
  const map = new Map<string, RakutenItem>();
  for (const item of items) {
    if (!item || item.isUsed) continue;
    const n = booksProductNumberOf(item);
    if (n && !map.has(n)) map.set(n, item);
  }
  return map;
}

const EDITION_ORDER: Record<LiveEdition, number> = { 初回限定盤: 0, 初回盤: 0, 通常盤: 1 };
const FORMAT_ORDER: Record<LiveFormat, number> = { 'Blu-ray': 0, DVD: 1 };

/**
 * グループの掲載作品を作る。掲載リストの商品番号のうち、商品データにある商品だけを使う
 * （商品データに無い盤は出さない。1つも無い公演は出さない）。並びは発売日の古い順。
 */
export function buildLiveArchive(groupName: string, index: Map<string, RakutenItem>): LiveArchiveEntry[] {
  const entries: LiveArchiveEntry[] = [];
  for (const perf of performancesOf(groupName)) {
    const items: LiveArchiveItem[] = [];
    for (const v of perf.variants) {
      const p = index.get(v.productNumber);
      if (!p) continue;
      const href = p.affiliateUrl || p.itemUrl;
      if (!href) continue;
      // 価格は「取得日時が分かり、古くない」ときだけ（取得日時不明の価格は、従来表示の設定でも出さない）
      const showPrice = !p.priceStale && p.price > 0 && !!p.priceDateLabel;
      items.push({
        productId: p.id,
        productNumber: v.productNumber,
        format: v.format,
        edition: v.edition,
        ...(v.spec ? { spec: v.spec } : {}),
        href,
        imageUrl: p.imageUrl ?? '',
        price: showPrice ? p.price : null,
        priceDateLabel: showPrice ? p.priceDateLabel ?? null : null,
      });
    }
    if (!items.length) continue;
    items.sort((a, b) => EDITION_ORDER[a.edition] - EDITION_ORDER[b.edition] || FORMAT_ORDER[a.format] - FORMAT_ORDER[b.format]);
    // 代表画像は通常盤を優先（初回盤の画像は特典の写り込みが多いため）。無ければ最初の画像
    const image = items.find((i) => i.edition === '通常盤' && i.imageUrl)?.imageUrl ?? items.find((i) => i.imageUrl)?.imageUrl ?? '';
    entries.push({
      id: perf.id,
      title: perf.title,
      releaseDate: perf.releaseDate,
      releaseYear: Number(perf.releaseDate.slice(0, 4)),
      ...(perf.recorded ? { recorded: perf.recorded } : {}),
      sourceUrl: perf.sourceUrl,
      imageUrl: image,
      items,
    });
  }
  return sortEntries(entries, 'old');
}

export function sortEntries(entries: LiveArchiveEntry[], sort: LiveSort): LiveArchiveEntry[] {
  const sorted = [...entries].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id));
  return sort === 'new' ? sorted.reverse() : sorted;
}

/** 形式で絞り込む（該当する盤が無い公演は除く） */
export function filterEntries(entries: LiveArchiveEntry[], format: LiveFormatFilter): LiveArchiveEntry[] {
  if (format === 'all') return entries;
  return entries
    .map((e) => ({ ...e, items: e.items.filter((i) => i.format === format) }))
    .filter((e) => e.items.length > 0);
}

/** "2025-06-11" → "2025年6月11日" */
export function formatReleaseDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : '';
}

export function itemLabel(i: Pick<LiveArchiveItem, 'format' | 'edition' | 'spec'>): string {
  return `${i.format} ${i.edition}${i.spec ? `（${i.spec}）` : ''}`;
}

export function countItems(entries: LiveArchiveEntry[]): number {
  return entries.reduce((n, e) => n + e.items.length, 0);
}

/**
 * 人物ページのコーナーに出す公演を選ぶ（発売日の古い順の entries から）。
 * 公演数が上限以下ならすべて。多い場合は最古・最新を含めて発売時期が散らばるよう等間隔に選ぶ
 * （同じ公演の DVD／Blu-ray で枠を埋めない＝1公演1枠）。並びは古い順。
 */
export function pickSpreadPerformances(entries: LiveArchiveEntry[], max = 3): LiveArchiveEntry[] {
  const sorted = sortEntries(entries, 'old');
  if (max <= 0) return [];
  if (sorted.length <= max) return sorted;
  if (max === 1) return [sorted[sorted.length - 1]];
  const picked: LiveArchiveEntry[] = [];
  const used = new Set<number>();
  for (let i = 0; i < max; i++) {
    let idx = Math.round((i * (sorted.length - 1)) / (max - 1));
    while (used.has(idx) && idx < sorted.length - 1) idx++;
    used.add(idx);
    picked.push(sorted[idx]);
  }
  return picked;
}

/** 公演の代表リンク：形式ごとに1つ（通常盤を優先、無ければ初回盤）。Blu-ray → DVD の順 */
export function formatLinksOf(entry: LiveArchiveEntry): LiveArchiveItem[] {
  const out: LiveArchiveItem[] = [];
  for (const format of ['Blu-ray', 'DVD'] as const) {
    const items = entry.items.filter((i) => i.format === format);
    const pick = items.find((i) => i.edition === '通常盤') ?? items[0];
    if (pick) out.push(pick);
  }
  return out;
}
