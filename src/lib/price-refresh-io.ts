// 価格更新の実行で使った量（楽天APIの呼び出し回数・DB から読んだ行数と量）を数える（管理画面・ログの表示用）。
// プロセス内の数え上げだけで、DB・Redis には何も書かない。runner が人物ごと・実行ごとの差分を記録する。
export interface PriceRefreshIo {
  /** DB から読んだ商品の行（カテゴリ）の数 */
  dbRowsRead: number;
  /** DB から読んだデータの量の目安（バイト。商品の JSON の長さ） */
  dbBytesRead: number;
}

export const priceRefreshIo: PriceRefreshIo = { dbRowsRead: 0, dbBytesRead: 0 };

/** 読んだ行と量を足す（量は JSON の長さで数える） */
export function countDbRead(rows: number, data: unknown): void {
  priceRefreshIo.dbRowsRead += rows;
  try { priceRefreshIo.dbBytesRead += JSON.stringify(data ?? null).length; } catch { /* 数えられなくても処理は続ける */ }
}

export function snapshotIo(): PriceRefreshIo { return { ...priceRefreshIo }; }
