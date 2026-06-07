import type {
  ProductCategory,
  RakutenItem,
  RakutenIchibaResponse,
  RakutenBooksResponse,
  RakutenDvdResponse,
  ApiResult,
} from '@/types/rakuten';

const APP_ID = process.env.RAKUTEN_APP_ID ?? '';
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? '';
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID ?? '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const REVALIDATE = 86400; // 24h cache

// 2026年5月以降の新エンドポイント
const BASE_ICHIBA = 'https://openapi.rakuten.co.jp/ichibams/api';
const BASE_BOOKS = 'https://openapi.rakuten.co.jp/services/api';

const AUTH_HEADERS = { Origin: SITE_URL };

function ichibaUrl(endpoint: string, params: Record<string, string>): string {
  return `${BASE_ICHIBA}/${endpoint}?${new URLSearchParams(params)}`;
}
function booksUrl(endpoint: string, params: Record<string, string>): string {
  return `${BASE_BOOKS}/${endpoint}?${new URLSearchParams(params)}`;
}

// キーワード自動生成
function keyword(name: string, group: string, category: ProductCategory): string {
  switch (category) {
    case '写真集':      return `${name} 写真集`;
    case '本・雑誌':    return `${name} 雑誌`;
    case 'Blu-ray・DVD': return group ? `${group} Blu-ray` : `${name} Blu-ray`;
    case 'グッズ':      return group ? `${group} グッズ` : `${name} グッズ`;
  }
}

function affiliateLink(affiliate: string, item: string): string {
  return affiliate && affiliate !== '' ? affiliate : item;
}

// 楽天ブックス書籍検索（写真集・本・雑誌）
async function fetchBooks(kw: string, category: ProductCategory): Promise<RakutenItem[]> {
  const res = await fetch(
    booksUrl('BooksBook/Search/20170404', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      keyword: kw,
      hits: '6',
      sort: 'reviewCount',
      outOfStockFlag: '1',
    }),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) throw new Error(`Books API error: ${res.status}`);
  const data: RakutenBooksResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }, i) => ({
    id: `books-${kw}-${i}`,
    title: Item.title ?? '',
    price: Number(Item.itemPrice ?? 0),
    reviewCount: Number(Item.reviewCount ?? 0),
    reviewAverage: Number(Item.reviewAverage ?? 0),
    imageUrl: Item.largeImageUrl ?? '',
    itemUrl: Item.itemUrl ?? '',
    affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
    category,
  }));
}

// 楽天ブックスDVD/Blu-ray検索
// DVD APIはkeyword非対応: グループあり→artistName、ソロ→title で検索
async function fetchDvd(name: string, group: string): Promise<RakutenItem[]> {
  const searchKey = group ? 'artistName' : 'title';
  const searchVal = group || name;
  const res = await fetch(
    booksUrl('BooksDVD/Search/20130522', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      [searchKey]: searchVal,
      hits: '6',
      sort: 'reviewCount',
      outOfStockFlag: '1',
    } as Record<string, string>),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) throw new Error(`DVD API error: ${res.status}`);
  const data: RakutenDvdResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }, i) => ({
    id: `dvd-${searchVal}-${i}`,
    title: Item.title ?? '',
    price: Number(Item.itemPrice ?? 0),
    reviewCount: Number(Item.reviewCount ?? 0),
    reviewAverage: Number(Item.reviewAverage ?? 0),
    imageUrl: Item.largeImageUrl ?? '',
    itemUrl: Item.itemUrl ?? '',
    affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
    category: 'Blu-ray・DVD',
  }));
}

// 楽天市場商品検索（グッズ）
async function fetchIchiba(kw: string): Promise<RakutenItem[]> {
  const res = await fetch(
    ichibaUrl('IchibaItem/Search/20260401', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      keyword: kw,
      hits: '6',
      sort: '-reviewCount',
    }),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) throw new Error(`Ichiba API error: ${res.status}`);
  const data: RakutenIchibaResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }, i) => ({
    id: `ichiba-${kw}-${i}`,
    title: Item.itemName ?? '',
    price: Number(Item.itemPrice ?? 0),
    reviewCount: Number(Item.reviewCount ?? 0),
    reviewAverage: Number(Item.reviewAverage ?? 0),
    imageUrl: Item.mediumImageUrls?.[0]?.imageUrl ?? '',
    itemUrl: Item.itemUrl ?? '',
    affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
    shopName: Item.shopName ?? '',
    category: 'グッズ',
  }));
}

export async function getProductsByCategory(
  name: string,
  group: string,
  category: ProductCategory
): Promise<ApiResult> {
  if (!APP_ID || !ACCESS_KEY) return { status: 'empty' };

  const kw = keyword(name, group, category);

  try {
    let products: RakutenItem[];
    switch (category) {
      case '写真集':
      case '本・雑誌':
        products = (await fetchBooks(kw, category)).filter((p) =>
          p.title.includes(name)
        );
        break;
      case 'Blu-ray・DVD':
        products = await fetchDvd(name, group);
        break;
      case 'グッズ':
        products = await fetchIchiba(kw);
        break;
    }
    return products.length > 0
      ? { status: 'ok', products }
      : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
