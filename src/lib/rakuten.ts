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

// 検索キーワード生成（常に人物名を含む）
function keyword(name: string, category: ProductCategory): string {
  switch (category) {
    case '写真集':   return `${name} 写真集`;
    case '本・雑誌': return `${name} 雑誌`;
    case 'グッズ':   return `${name} グッズ`;
    default:         return name;
  }
}

function affiliateLink(affiliate: string, item: string): string {
  return affiliate && affiliate !== '' ? affiliate : item;
}

// 楽天ブックス書籍検索（写真集・本・雑誌）
// 多めに取得→タイトルに人物名が含まれるものだけ表示（最大6件）
async function fetchBooks(kw: string, name: string, category: ProductCategory): Promise<RakutenItem[]> {
  const res = await fetch(
    booksUrl('BooksBook/Search/20170404', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      keyword: kw,
      hits: '20', // 多めに取得してフィルタ後に6件確保
      sort: 'standard', // 関連性順（reviewCountより正確に該当作品が上位に来る）
      outOfStockFlag: '1',
    }),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) return []; // APIエラーは空配列として扱う（throwしない）
  const data: RakutenBooksResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items
    .map(({ Item }, i) => ({
      id: `books-${kw}-${i}`,
      title: Item.title ?? '',
      price: Number(Item.itemPrice ?? 0),
      reviewCount: Number(Item.reviewCount ?? 0),
      reviewAverage: Number(Item.reviewAverage ?? 0),
      imageUrl: Item.largeImageUrl ?? '',
      itemUrl: Item.itemUrl ?? '',
      affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
      category,
    }))
    .filter((p) => p.title.includes(name)) // タイトルに人物名が含まれるものだけ
    .slice(0, 6); // 最大6件表示
}

// 楽天ブックスDVD/Blu-ray検索
// titleパラメータで人物名を指定→その人物が関わるDVDのみ取得
async function fetchDvd(name: string): Promise<RakutenItem[]> {
  const res = await fetch(
    booksUrl('BooksDVD/Search/20130522', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      title: name, // 人物名でタイトル検索（グループ名は使わない）
      hits: '6',
      sort: 'reviewCount',
      outOfStockFlag: '1',
    } as Record<string, string>),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) return []; // APIエラーは空配列として扱う
  const data: RakutenDvdResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }, i) => ({
    id: `dvd-${name}-${i}`,
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
// キーワードは常に人物名を含む（'${name} グッズ'）
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
  if (!res.ok) return []; // APIエラーは空配列として扱う
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
  _group: string,
  category: ProductCategory
): Promise<ApiResult> {
  if (!APP_ID || !ACCESS_KEY) return { status: 'empty' };

  // 全カテゴリで必ず人物名をキーワードに含める
  const kw = keyword(name, category);

  try {
    let products: RakutenItem[];
    switch (category) {
      case '写真集':
      case '本・雑誌':
        // nameフィルタとsliceはfetchBooks内で実施
        products = await fetchBooks(kw, name, category);
        break;
      case 'Blu-ray・DVD':
        // groupではなくnameでtitle検索
        products = await fetchDvd(name);
        break;
      case 'グッズ':
        // kw = '${name} グッズ'（グループ名は使わない）
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
