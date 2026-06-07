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

function affiliateLink(affiliate: string, item: string): string {
  return affiliate && affiliate !== '' ? affiliate : item;
}

// ---------------------------------------------------------------
// 写真集・本・雑誌: author パラメータで人物名を指定
//   keyword は OR 検索になるため不使用（無関係な数百万件が返るため）。
//   sort:'standard' が最も安定（reviewCount は 0 レビュー作品を除外する）。
//   写真集: page=1（上位6件）、本・雑誌: page=2（次の6件）で重複回避。
// ---------------------------------------------------------------
async function fetchBooksByAuthor(
  name: string,
  category: ProductCategory,
  page: string
): Promise<RakutenItem[]> {
  const res = await fetch(
    booksUrl('BooksBook/Search/20170404', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      author: name,      // keyword ではなく author で人物名を厳密指定
      hits: '6',
      sort: 'standard',  // 関連性順（reviewCountより安定してすべての作品を返す）
      outOfStockFlag: '1',
      page,
    }),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) return [];
  const data: RakutenBooksResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }, i) => ({
    id: `books-${name}-${category}-p${page}-${i}`,
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

// ---------------------------------------------------------------
// Blu-ray・DVD: artistName で人物名を指定 → タイトルにも名前が含まれる作品のみ
//   グループ名は使わない（加入前作品が混入するため）。
//   20件取得 → title.includes(name) フィルタ → 先頭6件表示。
// ---------------------------------------------------------------
async function fetchDvd(name: string): Promise<RakutenItem[]> {
  const res = await fetch(
    booksUrl('BooksDVD/Search/20130522', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      artistName: name,  // 人物名でアーティスト検索（グループ名は使わない）
      hits: '20',
      sort: 'reviewCount',
      outOfStockFlag: '1',
    } as Record<string, string>),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) return [];
  const data: RakutenDvdResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items
    .map(({ Item }, i) => ({
      id: `dvd-${name}-${i}`,
      title: Item.title ?? '',
      price: Number(Item.itemPrice ?? 0),
      reviewCount: Number(Item.reviewCount ?? 0),
      reviewAverage: Number(Item.reviewAverage ?? 0),
      imageUrl: Item.largeImageUrl ?? '',
      itemUrl: Item.itemUrl ?? '',
      affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
      category: 'Blu-ray・DVD' as const,
    }))
    .filter((p) => p.title.includes(name)) // タイトルに人物名が含まれる作品のみ
    .slice(0, 6);
}

// ---------------------------------------------------------------
// グッズ: keyword に '${name} グッズ' を指定 → 商品名フィルタで絞り込み
//   20件取得 → itemName.includes(name) → 先頭6件表示。
// ---------------------------------------------------------------
async function fetchIchiba(name: string): Promise<RakutenItem[]> {
  const kw = `${name} グッズ`;
  const res = await fetch(
    ichibaUrl('IchibaItem/Search/20260401', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      keyword: kw,
      hits: '20',
      sort: '-reviewCount',
    }),
    { next: { revalidate: REVALIDATE }, headers: AUTH_HEADERS }
  );
  if (!res.ok) return [];
  const data: RakutenIchibaResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items
    .map(({ Item }, i) => ({
      id: `ichiba-${name}-${i}`,
      title: Item.itemName ?? '',
      price: Number(Item.itemPrice ?? 0),
      reviewCount: Number(Item.reviewCount ?? 0),
      reviewAverage: Number(Item.reviewAverage ?? 0),
      imageUrl: Item.mediumImageUrls?.[0]?.imageUrl ?? '',
      itemUrl: Item.itemUrl ?? '',
      affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
      shopName: Item.shopName ?? '',
      category: 'グッズ' as const,
    }))
    .filter((p) => p.title.includes(name)) // 商品名に人物名が含まれるものだけ
    .slice(0, 6);
}

export async function getProductsByCategory(
  name: string,
  _group: string,
  category: ProductCategory
): Promise<ApiResult> {
  if (!APP_ID || !ACCESS_KEY) return { status: 'empty' };

  try {
    let products: RakutenItem[];
    switch (category) {
      case '写真集':
        // author:name で著者検索、page=1（1〜6件目）
        products = await fetchBooksByAuthor(name, category, '1');
        break;
      case '本・雑誌':
        // author:name で著者検索、page=2（7〜12件目）で写真集と重複回避
        products = await fetchBooksByAuthor(name, category, '2');
        break;
      case 'Blu-ray・DVD':
        // artistName:name でDVD検索、タイトルフィルタあり
        products = await fetchDvd(name);
        break;
      case 'グッズ':
        // 'name グッズ' で市場検索、商品名フィルタあり
        products = await fetchIchiba(name);
        break;
    }
    return products.length > 0
      ? { status: 'ok', products }
      : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
