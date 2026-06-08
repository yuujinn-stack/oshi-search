import type {
  ProductCategory,
  RakutenItem,
  RakutenIchibaResponse,
  RakutenBooksResponse,
  RakutenDvdResponse,
  ApiResult,
} from '@/types/rakuten';
import type { PersonConfig } from '@/types/person';
import { calcScore } from './scoring';

const APP_ID = process.env.RAKUTEN_APP_ID ?? '';
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? '';
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID ?? '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const REVALIDATE = 86400; // 24h

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

// 楽天URLから安定したプロダクトIDを生成（インデックスではなくURLベース）
// これにより同じ商品は常に同じIDを持ち、AI判定結果が再利用できる
function stableId(prefix: string, itemUrl: string): string {
  try {
    const url = new URL(itemUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    if (last.length >= 4) return `${prefix}-${last.slice(0, 24)}`;
  } catch { /* fall through */ }
  // フォールバック: URLの末尾を使用
  return `${prefix}-${itemUrl.replace(/\W/g, '').slice(-16)}`;
}

// ---------------------------------------------------------------
// 写真集・本・雑誌: author パラメータで人物名を厳密指定
//   sort:'standard' が最安定（reviewCountは0レビュー作品を除外する）
//   写真集: page=1 / 本・雑誌: page=2 で重複回避
// ---------------------------------------------------------------
async function fetchBooksByAuthor(
  name: string,
  group: string,
  config: PersonConfig,
  category: ProductCategory,
  page: string,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  async function fetchPage(authorName: string, p: string): Promise<RakutenItem[]> {
    const res = await fetch(
      booksUrl('BooksBook/Search/20170404', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        author: authorName,
        hits: '10',
        sort: 'standard',
        outOfStockFlag: '1',
        page: p,
      }),
      {
        cache: cacheMode,
        next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined,
        headers: AUTH_HEADERS,
      }
    );
    if (!res.ok) return [];
    const data: RakutenBooksResponse = await res.json();
    if (data.error || !data.Items?.length) return [];

    return data.Items.map(({ Item }) => ({
      id: stableId('bk', Item.itemUrl ?? ''),
      title: Item.title ?? '',
      price: Number(Item.itemPrice ?? 0),
      reviewCount: Number(Item.reviewCount ?? 0),
      reviewAverage: Number(Item.reviewAverage ?? 0),
      imageUrl: Item.largeImageUrl ?? '',
      itemUrl: Item.itemUrl ?? '',
      affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
      category,
      relevanceScore: calcScore(
        { title: Item.title ?? '', author: Item.author ?? '' },
        { name, group, excludeKeywords }
      ),
    }));
  }

  // メイン検索
  const mainResults = await fetchPage(name, page);

  // customKeywords による追加検索（補助的、置き換えではない）
  const extra: RakutenItem[] = [];
  if (config.customKeywords?.length && page === '1') {
    for (const kw of config.customKeywords) {
      const r = await fetchPage(kw, '1');
      extra.push(...r);
    }
  }

  // 重複を除去（IDが同じものは最初のものを優先）
  const seen = new Set<string>();
  return [...mainResults, ...extra].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------
// Blu-ray・DVD: artistName で人物名指定
// ---------------------------------------------------------------
async function fetchDvd(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  const res = await fetch(
    booksUrl('BooksDVD/Search/20130522', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      artistName: name,
      hits: '20',
      sort: 'reviewCount',
      outOfStockFlag: '1',
    } as Record<string, string>),
    {
      cache: cacheMode,
      next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined,
      headers: AUTH_HEADERS,
    }
  );
  if (!res.ok) return [];
  const data: RakutenDvdResponse = await res.json();
  if (data.error || !data.Items?.length) return [];

  return data.Items.map(({ Item }) => ({
    id: stableId('dv', Item.itemUrl ?? ''),
    title: Item.title ?? '',
    price: Number(Item.itemPrice ?? 0),
    reviewCount: Number(Item.reviewCount ?? 0),
    reviewAverage: Number(Item.reviewAverage ?? 0),
    imageUrl: Item.largeImageUrl ?? '',
    itemUrl: Item.itemUrl ?? '',
    affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
    category: 'Blu-ray・DVD' as const,
    relevanceScore: calcScore(
      { title: Item.title ?? '', artistName: Item.artistName ?? '' },
      { name, group, excludeKeywords }
    ),
  }));
}

// ---------------------------------------------------------------
// グッズ: keyword に '${name} グッズ' を指定
// ---------------------------------------------------------------
async function fetchIchiba(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];
  const kw = `${name} グッズ`;

  async function fetchKw(keyword: string): Promise<RakutenItem[]> {
    const res = await fetch(
      ichibaUrl('IchibaItem/Search/20260401', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        keyword,
        hits: '20',
        sort: '-reviewCount',
      }),
      {
        cache: cacheMode,
        next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined,
        headers: AUTH_HEADERS,
      }
    );
    if (!res.ok) return [];
    const data: RakutenIchibaResponse = await res.json();
    if (data.error || !data.Items?.length) return [];

    return data.Items.map(({ Item }) => ({
      id: stableId('ic', Item.itemUrl ?? ''),
      title: Item.itemName ?? '',
      price: Number(Item.itemPrice ?? 0),
      reviewCount: Number(Item.reviewCount ?? 0),
      reviewAverage: Number(Item.reviewAverage ?? 0),
      imageUrl: Item.mediumImageUrls?.[0]?.imageUrl ?? '',
      itemUrl: Item.itemUrl ?? '',
      affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
      shopName: Item.shopName ?? '',
      category: 'グッズ' as const,
      relevanceScore: calcScore(
        { title: Item.itemName ?? '' },
        { name, group, excludeKeywords }
      ),
    }));
  }

  const mainResults = await fetchKw(kw);

  // customKeywords による追加検索（例: 'あのちゃん グッズ'）
  const extra: RakutenItem[] = [];
  if (config.customKeywords?.length) {
    for (const ckw of config.customKeywords) {
      const r = await fetchKw(`${ckw} グッズ`);
      extra.push(...r);
    }
  }

  const seen = new Set<string>();
  return [...mainResults, ...extra].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------
// 公開API: カテゴリ別商品取得
// cacheMode='no-store' は管理画面専用（常に最新を取得）
// ---------------------------------------------------------------
export async function getProductsByCategory(
  name: string,
  group: string,
  category: ProductCategory,
  config: PersonConfig = {},
  cacheMode: RequestCache = 'default',
): Promise<ApiResult> {
  if (!APP_ID || !ACCESS_KEY) return { status: 'empty' };

  try {
    let products: RakutenItem[];
    switch (category) {
      case '写真集':
        products = await fetchBooksByAuthor(name, group, config, category, '1', cacheMode);
        break;
      case '本・雑誌':
        products = await fetchBooksByAuthor(name, group, config, category, '2', cacheMode);
        break;
      case 'Blu-ray・DVD':
        products = await fetchDvd(name, group, config, cacheMode);
        break;
      case 'グッズ':
        products = await fetchIchiba(name, group, config, cacheMode);
        break;
    }
    // スコアで降順ソートして返す（フィルタリングは呼び出し元で行う）
    const sorted = products.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return sorted.length > 0 ? { status: 'ok', products: sorted } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
