import type { ProductCategory } from './person';

export type { ProductCategory };

// ---- 楽天市場商品検索API ----
export interface RakutenIchibaItem {
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
  // AI判定に渡す追加フィールド（取得できた場合のみ）
  author?: string;       // Books: 著者名
  artistName?: string;   // DVD: アーティスト名
  catchcopy?: string;    // Ichiba: キャッチコピー
  description?: string;  // Ichiba: 商品説明（先頭200文字）
}

export interface ProductCardProps {
  product: RakutenItem;
}

export type ApiResult =
  | { status: 'ok'; products: RakutenItem[] }
  | { status: 'empty' }     // バッチ済みだが関連商品なし
  | { status: 'no_data' }   // バッチ未実行（初回セットアップ中）
  | { status: 'error' };
