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
}

export interface ProductCardProps {
  product: RakutenItem;
}

export type ApiResult =
  | { status: 'ok'; products: RakutenItem[] }
  | { status: 'empty' }
  | { status: 'error' };
