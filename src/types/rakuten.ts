import type { ProductCategory } from './person';

export type { ProductCategory };

// ---- 楽天市場商品検索API ----
export interface RakutenIchibaItem {
  /** 楽天市場の公式商品識別子（店舗コード:商品コード）。商品IDの生成に使う（src/lib/rakuten-item-id.ts） */
  itemCode?: string;
  shopCode?: string;
  itemName: string;
  itemPrice: number;
  reviewCount: number;
  reviewAverage: number;
  itemUrl: string;
  affiliateUrl: string;
  mediumImageUrls: Array<{ imageUrl: string }>;
  shopName: string;
  catchcopy?: string;
  itemCaption?: string;
}

export interface RakutenIchibaResponse {
  Items?: Array<{ Item: RakutenIchibaItem }>;
  count?: number;
  error?: string;
}

// ---- 楽天ブックス書籍検索API ----
export interface RakutenBooksItem {
  title: string;
  author: string;
  publisherName: string;
  salesDate: string;
  itemPrice: number;
  largeImageUrl: string;
  itemUrl: string;
  affiliateUrl: string;
  reviewCount: number;
  reviewAverage: number;
}

export interface RakutenBooksResponse {
  Items?: Array<{ Item: RakutenBooksItem }>;
  count?: number;
  error?: string;
}

// ---- 楽天ブックスDVD/Blu-ray検索API ----
export interface RakutenDvdItem {
  title: string;
  artistName: string;
  salesDate: string;
  itemPrice: number;
  largeImageUrl: string;
  itemUrl: string;
  affiliateUrl: string;
  reviewCount: number;
  reviewAverage: number;
}

export interface RakutenDvdResponse {
  Items?: Array<{ Item: RakutenDvdItem }>;
  count?: number;
  error?: string;
}

// ---- 統一商品型 ----
export interface RakutenItem {
  id: string;
  title: string;
  price: number;
  reviewCount: number;
  reviewAverage: number;
  imageUrl: string;
  itemUrl: string;
  affiliateUrl: string;
  shopName?: string;
  category: ProductCategory;
  relevanceScore: number;
  isUsed?: boolean;      // 中古商品フラグ（category==='中古' または title に【中古】含む）
  itemCode?: string;     // 楽天市場の公式商品識別子（店舗コード:商品コード）。楽天市場の商品のみ
  // AI判定に渡す追加フィールド（取得できた場合のみ）
  author?: string;       // Books: 著者名
  artistName?: string;   // DVD: アーティスト名
  catchcopy?: string;    // Ichiba: キャッチコピー
  description?: string;  // Ichiba: 商品説明（先頭200文字）
  // 価格を楽天APIから実際に取得した日時（epoch ms）。楽天の検索結果に含まれて価格を更新したときだけ保存する
  // （価格更新専用モード src/lib/price-refresh.ts）。無い商品は取得日時不明（推測で付けない）
  priceFetchedAt?: number;
  // 表示用（src/lib/price-freshness.ts がページ描画時に付ける。DBには保存しない）
  priceStale?: boolean;     // 取得日時不明、または取得から一定日数を超えた価格（価格を表示しない）
  priceDateLabel?: string;  // 「10/19時点」または取得日「2026/7/1」（取得日時不明なら無し）
}

export interface ProductCardProps {
  product: RakutenItem;
}

export type ApiResult =
  | { status: 'ok'; products: RakutenItem[] }
  | { status: 'empty' }                                  // API設定済み・検索結果0件
  | { status: 'config_missing' }                         // RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY 未設定または空
  | { status: 'upstream_error'; httpStatus: number }     // 楽天APIが4xx/5xxを返した
  | { status: 'no_data' }                                // バッチ未実行（初回セットアップ中）
  | { status: 'error' };                                 // ネットワーク障害・タイムアウト等
