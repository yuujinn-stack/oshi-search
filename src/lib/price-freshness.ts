// 楽天商品の価格の「取得日」と「古さ」の表示用ヘルパー（純粋関数）。
//
// 価格の取得日時は商品ごとの priceFetchedAt（楽天の検索結果に含まれて価格を更新したときだけ保存。
// src/lib/product-store.ts）。カテゴリ行の fetched_at は「カテゴリを再検索した日時」で、検索結果に出ず
// 価格が更新されなかった商品も含むため、価格の取得日時としては使わない。
// 表示時に
//   - priceFetchedAt があり、取得から PRICE_FRESH_DAYS 日以内 … 価格＋「M/D時点」
//   - 取得から日数がたった ………………………………………………… 価格は出さず「価格は楽天で確認」＋取得日
//   - priceFetchedAt が無い（取得日時不明。既存データ） ……… 価格は出さず「価格は楽天で確認」（日付は推測しない）
// とする。商品データ・リンクは変更しない（表示用のコピーに priceStale / priceDateLabel を付けるだけ）。
//
// 古いかどうかはサーバー側の描画時に1回だけ判定して値として渡す（クライアントの時計で判定し直さない＝
// サーバーとブラウザで表示が食い違う hydration エラーを避ける）。日付は常に日本時間で表示する。
import type { RakutenItem } from '@/types/rakuten';

export const PRICE_FRESH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isPriceStale(fetchedAtMs: number, nowMs: number): boolean {
  return nowMs - fetchedAtMs > PRICE_FRESH_DAYS * DAY_MS;
}

/**
 * 価格の表示モード（サーバーの環境変数 PRICE_DISPLAY_MODE）。
 *   legacy（既定）… 取得日時が不明な商品は従来どおり価格を表示（日付なし）。取得日時が分かる商品は「M/D時点」、
 *                   取得から日数がたった商品は価格を出さない。公開直後に大量の価格が消えないための移行期間用。
 *   strict ………… 取得日時が不明な商品も価格を出さない（価格の取得日時がほぼ埋まってから切り替える）。
 */
export type PriceDisplayMode = 'legacy' | 'strict';
export function priceDisplayMode(): PriceDisplayMode {
  return (process.env.PRICE_DISPLAY_MODE ?? '').trim() === 'strict' ? 'strict' : 'legacy';
}

/**
 * 表示用のコピーに古さ・表示文字列を付ける（商品の priceFetchedAt だけを使う）。
 * priceDateLabel … 新しい価格は「10/19時点」、古い価格は取得日「2026/7/1」、取得日時不明なら無し
 */
export function withPriceFreshness<T extends RakutenItem>(product: T, nowMs: number, mode: PriceDisplayMode = priceDisplayMode()): T {
  const at = product.priceFetchedAt;
  if (!at || !Number.isFinite(at)) return { ...product, priceStale: mode === 'strict', priceDateLabel: undefined };
  const stale = isPriceStale(at, nowMs);
  return { ...product, priceStale: stale, priceDateLabel: stale ? formatPriceDate(at) : formatPriceAsOf(at, nowMs) };
}

const jstParts = (ms: number) => {
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day') };
};

/** 例: 2026/10/19 */
export function formatPriceDate(ms: number): string {
  const { y, m, d } = jstParts(ms);
  return `${y}/${m}/${d}`;
}

/** 例: 10/19時点（年が違えば 2025/10/19時点） */
export function formatPriceAsOf(ms: number, nowMs: number): string {
  const a = jstParts(ms);
  const b = jstParts(nowMs);
  return a.y === b.y ? `${a.m}/${a.d}時点` : `${a.y}/${a.m}/${a.d}時点`;
}

export const STALE_PRICE_LABEL = '価格は楽天で確認';
export function priceNote(mode: PriceDisplayMode = priceDisplayMode()): string {
  return mode === 'strict'
    ? `表示価格は楽天から取得した時点の価格です。取得から${PRICE_FRESH_DAYS}日を超えた商品と取得日が不明な商品は価格を表示していません。最新の価格・在庫は楽天の商品ページでご確認ください。`
    : `表示価格は楽天から取得した時点の価格です。日付のない価格は取得日が確認できていない価格で、現在の価格と異なる場合があります。取得から${PRICE_FRESH_DAYS}日を超えた商品は価格を表示していません。最新の価格・在庫は楽天の商品ページでご確認ください。`;
}
/** 取得日時を商品ごとに出せない一覧（写真集）向けの注記 */
export const PRICE_NOTE_SHORT = '表示価格は楽天から取得した時点の価格です。最新の価格・在庫は楽天の商品ページでご確認ください。';
