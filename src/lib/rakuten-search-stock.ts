// 楽天の検索結果の販売状況（価格更新専用モード src/lib/price-refresh.ts が使う。商品データには入れない＝保存されない）。
// 商品オブジェクトは作り直さない（WeakMap）ため、新商品の発見・保存の処理には一切影響しない。
//
// 楽天ブックス（書籍・DVD・CD・総合検索）の availability（楽天ウェブサービスの仕様。検索は outOfStockFlag=1＝品切れ等の購入不可商品も含む）:
//   1 在庫あり・2 通常3〜7日程度で発送・3 通常3〜9日程度で発送 → available（通常の注文で購入できる）
//   4 メーカー取り寄せ → backorder（購入はできるが在庫ありではない。在庫ありとは区別する）
//   5 予約受付中     → preorder（発売前の予約。在庫ありとは区別する）
//   6 メーカーに在庫確認 → unavailable（購入できると確認できない）
//   空・上記以外・価格なし → unknown（販売状況を確認できない。品切れとは断定しない）
//   項目そのものが無い → 記録しない（undefined）
// 楽天市場の availability（1 販売可能・0 販売不可能）:
//   1かつ価格あり → available・0 → unavailable・1で価格なし → unknown・項目が無い → 記録しない
// API のエラー・429・タイムアウト・通信失敗はここに来ない（呼び出し側が何も記録しない）。
import type { StockStatus } from '@/types/rakuten';

/** 検索・取得の結果から記録する販売状況（見つからない・不一致は呼び出し側が決める） */
export type SearchStock = Exclude<StockStatus, 'not_found' | 'mismatched'>;
const searchStock = new WeakMap<object, SearchStock>();

const hasValue = (v: unknown) => v !== undefined && v !== null;

/** 楽天ブックスの在庫状況と価格から販売状況を決める（純粋関数）。項目が無ければ undefined */
export function booksStockOf(availability: unknown, price: unknown): SearchStock | undefined {
  if (!hasValue(availability)) return undefined;
  const a = String(availability).trim();
  const p = Number(price);
  const priced = Number.isInteger(p) && p > 0;
  switch (a) {
    case '1':
    case '2':
    case '3':
      return priced ? 'available' : 'unknown';
    case '4':
      return 'backorder';
    case '5':
      return 'preorder';
    case '6':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

/** 楽天市場の販売可能フラグと価格から販売状況を決める。フラグが無ければ undefined（不明。推測しない） */
export function ichibaStockOf(availability: unknown, price: unknown): SearchStock | undefined {
  if (!hasValue(availability) || availability === '') return undefined;
  const a = Number(availability);
  if (a === 0) return 'unavailable';
  if (a === 1) return Number(price) > 0 ? 'available' : 'unknown';
  return 'unknown';
}

export function markStock<T extends object>(item: T, stock: SearchStock | undefined): T {
  if (stock) searchStock.set(item, stock);
  return item;
}

/** 検索結果の商品の販売状況（その検索で確認できたものだけ。保存済みの商品・確認できなかったものは undefined） */
export function searchStockOf(item: object): SearchStock | undefined {
  return searchStock.get(item);
}
