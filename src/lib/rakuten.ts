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

// 問題商品追跡キーワード（Vercelログで取得漏れ商品を全ステップ追跡する）
const TRACK_TITLE_TERMS = ['感情の隙間', '1st写真集', '2nd写真集', '3rd写真集'];

function logTrackedItem(foundBySearch: string, id: string, title: string, itemUrl: string): void {
  const matched = TRACK_TITLE_TERMS.filter((t) => title.includes(t));
  if (matched.length === 0) return;
  console.log(`[rakuten:TRACK] 📌 発見: search="${foundBySearch}" | id=${id}`);
  console.log(`[rakuten:TRACK]   title="${title}"`);
  console.log(`[rakuten:TRACK]   url=${itemUrl}`);
}

// Books API 汎用ページ取得（author / title / keyword パラメータに対応）
async function fetchBooksPages(
  paramKey: 'author' | 'title' | 'keyword',
  paramValue: string,
  maxPages: number,
  mapCtx: { name: string; group: string; excludeKeywords: string[]; category: ProductCategory; cacheMode: RequestCache },
): Promise<RakutenItem[]> {
  const { name, group, excludeKeywords, category, cacheMode } = mapCtx;
  const results: RakutenItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    console.log(`[rakuten] Books(${paramKey})検索: ${paramKey}="${paramValue}" page=${page}`);
    const res = await fetch(
      booksUrl('BooksBook/Search/20170404', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        [paramKey]: paramValue,
        hits: '30',
        sort: 'standard',
        outOfStockFlag: '1',
        page: String(page),
      }),
      { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      console.log(`[rakuten] Books(${paramKey})エラー: HTTP ${res.status} ${paramKey}="${paramValue}" page=${page}`);
      break;
    }
    const data: RakutenBooksResponse = await res.json();
    if (data.error) {
      console.log(`[rakuten] Books(${paramKey})エラー: ${JSON.stringify(data.error)} ${paramKey}="${paramValue}"`);
      break;
    }
    if (!data.Items?.length) break;

    const returned = data.Items.length;
    const total = data.count ?? 0;
    console.log(`[rakuten] Books(${paramKey})取得: ${returned}件 (総数=${total}) ${paramKey}="${paramValue}" page=${page}`);

    for (const { Item } of data.Items) {
      const id = stableId('bk', Item.itemUrl ?? '');
      const title = Item.title ?? '';
      const itemUrl = Item.itemUrl ?? '';
      logTrackedItem(`${paramKey}:${paramValue}`, id, title, itemUrl);
      results.push({
        id,
        title,
        author: Item.author ?? '',
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        reviewAverage: Number(Item.reviewAverage ?? 0),
        imageUrl: Item.largeImageUrl ?? '',
        itemUrl,
        affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', itemUrl),
        category,
        relevanceScore: calcScore(
          { title, author: Item.author ?? '' },
          { name, group, excludeKeywords }
        ),
      });
    }

    if (returned < 30) break;
  }
  return results;
}

// ---------------------------------------------------------------
// 写真集: author / keyword パラメータで人物名（全名義）を検索
//   hits=30 (max), 1キーワードあたり最大3ページ (90件)
//   realName/reading/aliases/customKeywords も著者名として検索
//   さらに keyword: name 写真集 / keyword: name カレンダー で補完
//   （著者名が「グループ名 個人名」形式等でも捕捉するため）
// ---------------------------------------------------------------
async function fetchBooksAuthor(
  name: string,
  group: string,
  config: PersonConfig,
  category: ProductCategory,
  cacheMode: RequestCache,
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];
  const ctx = { name, group, excludeKeywords, category, cacheMode };

  const authorKeys: string[] = [name];
  if (config.realName && config.realName !== name) authorKeys.push(config.realName);
  if (config.reading) authorKeys.push(config.reading);
  if (config.aliases?.length) authorKeys.push(...config.aliases);
  if (config.customKeywords?.length) authorKeys.push(...config.customKeywords);

  const all: RakutenItem[] = [];

  // 1. author 検索: 著者名として人物名が登録されている書籍
  for (const authorName of authorKeys) {
    all.push(...await fetchBooksPages('author', authorName, 3, ctx));
  }

  // 2. keyword 補完検索: 著者名の書き方が「グループ名 個人名」等でも捕捉
  //    英題写真集（タイトルに日本語名がない場合）・別名義作品・カレンダーもカバー
  //    「乃木坂46 筒井あやめ 写真集」のようにグループ+名前+カテゴリで検索することで
  //    著者がグループ名名義でも取得可能にする
  const keywordSupplements = [
    `${name} 写真集`,         // 筒井あやめ 写真集
    `${name} 1st写真集`,      // 筒井あやめ 1st写真集（デビュー写真集の定型キーワード）
    `${name} カレンダー`,     // 筒井あやめ カレンダー
  ];
  if (group) {
    keywordSupplements.push(`${group} ${name} 写真集`);    // 乃木坂46 筒井あやめ 写真集
    keywordSupplements.push(`${group} ${name} 1st写真集`); // 乃木坂46 筒井あやめ 1st写真集
  }
  if (config.realName && config.realName !== name) {
    keywordSupplements.push(`${config.realName} 写真集`);
  }
  for (const alias of config.aliases ?? []) keywordSupplements.push(`${alias} 写真集`);

  for (const kw of keywordSupplements) {
    all.push(...await fetchBooksPages('keyword', kw, 2, ctx));
  }

  const seen = new Set<string>();
  return all.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
}

// ---------------------------------------------------------------
// 本・雑誌: title / keyword パラメータで人物名を含む書籍を検索
//   著者名でなくタイトルに名前が入っている雑誌・ムック等をカバー
//   hits=30, 最大2ページ (60件)
// ---------------------------------------------------------------
async function fetchBooksTitle(
  name: string,
  group: string,
  config: PersonConfig,
  category: ProductCategory,
  cacheMode: RequestCache,
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];
  const ctx = { name, group, excludeKeywords, category, cacheMode };

  const titleKeys: string[] = [name];
  if (config.realName && config.realName !== name) titleKeys.push(config.realName);
  if (config.aliases?.length) titleKeys.push(...config.aliases);

  const all: RakutenItem[] = [];

  for (const keyword of titleKeys) {
    all.push(...await fetchBooksPages('title', keyword, 2, ctx));
  }

  const seen = new Set<string>();
  return all.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
}

// ---------------------------------------------------------------
// Blu-ray・DVD: artistName で検索（個人名 → グループ名 → customKeywords）
//   アイドル等はグループ名でDVD登録されているため group でも検索する
// ---------------------------------------------------------------
async function fetchDvd(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  async function fetchByArtist(artistName: string): Promise<RakutenItem[]> {
    const items: RakutenItem[] = [];
    for (let page = 1; page <= 2; page++) {
      console.log(`[rakuten] DVD検索: artistName="${artistName}" page=${page}`);
      const res = await fetch(
        booksUrl('BooksDVD/Search/20130522', {
          applicationId: APP_ID,
          accessKey: ACCESS_KEY,
          affiliateId: AFFILIATE_ID,
          artistName,
          hits: '30',
          sort: 'standard',
          outOfStockFlag: '1',
          page: String(page),
        } as Record<string, string>),
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        console.log(`[rakuten] DVD APIエラー: HTTP ${res.status} artistName="${artistName}" page=${page}`);
        break;
      }
      const data: RakutenDvdResponse = await res.json();
      if (data.error) {
        console.log(`[rakuten] DVD APIエラー: ${JSON.stringify(data.error)} artistName="${artistName}"`);
        break;
      }
      if (!data.Items?.length) break;

      const returned = data.Items.length;
      const total = data.count ?? 0;
      console.log(`[rakuten] DVD取得: ${returned}件 (総数=${total}) artistName="${artistName}" page=${page}`);

      items.push(...data.Items.map(({ Item }) => ({
        id: stableId('dv', Item.itemUrl ?? ''),
        title: Item.title ?? '',
        artistName: Item.artistName ?? '',
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
      })));

      if (returned < 30) break;
    }
    return items;
  }

  const all: RakutenItem[] = [];

  // 1. 個人名で検索
  all.push(...await fetchByArtist(name));

  // 2. グループ名で検索（グループのDVD = 本人出演の可能性が高い）
  if (group) {
    all.push(...await fetchByArtist(group));
  }

  // 3. aliases/customKeywords でも検索（別名・芸名・旧名等）
  for (const kw of [...(config.aliases ?? []), ...(config.customKeywords ?? [])]) {
    if (kw !== name && kw !== group) {
      all.push(...await fetchByArtist(kw));
    }
  }

  // 重複除去（IDが同じものは最初のものを優先）
  const seen = new Set<string>();
  return all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------
// CD: artistName でアーティスト名（個人名・グループ名）を検索
//   グループCD＝本人出演の可能性が高いため group でも検索
//   hits=30, 個人は最大2ページ / グループは最大3ページ
// ---------------------------------------------------------------
async function fetchCd(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  async function fetchByArtist(artistName: string, maxPages = 2): Promise<RakutenItem[]> {
    const items: RakutenItem[] = [];
    for (let page = 1; page <= maxPages; page++) {
      console.log(`[rakuten] CD検索: artistName="${artistName}" page=${page}`);
      const res = await fetch(
        booksUrl('BooksCD/Search/20130522', {
          applicationId: APP_ID,
          accessKey: ACCESS_KEY,
          affiliateId: AFFILIATE_ID,
          artistName,
          hits: '30',
          sort: 'standard',
          outOfStockFlag: '1',
          page: String(page),
        } as Record<string, string>),
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        console.log(`[rakuten] CD APIエラー: HTTP ${res.status} artistName="${artistName}" page=${page}`);
        break;
      }
      const data: RakutenDvdResponse = await res.json();
      if (data.error) {
        console.log(`[rakuten] CD APIエラー: ${JSON.stringify(data.error)} artistName="${artistName}"`);
        break;
      }
      if (!data.Items?.length) break;

      const returned = data.Items.length;
      const total = data.count ?? 0;
      console.log(`[rakuten] CD取得: ${returned}件 (総数=${total}) artistName="${artistName}" page=${page}`);

      items.push(...data.Items.map(({ Item }) => ({
        id: stableId('cd', Item.itemUrl ?? ''),
        title: Item.title ?? '',
        artistName: Item.artistName ?? '',
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        reviewAverage: Number(Item.reviewAverage ?? 0),
        imageUrl: Item.largeImageUrl ?? '',
        itemUrl: Item.itemUrl ?? '',
        affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
        category: 'CD' as const,
        relevanceScore: calcScore(
          { title: Item.title ?? '', artistName: Item.artistName ?? '' },
          { name, group, excludeKeywords }
        ),
      })));

      if (returned < 30) break;
    }
    return items;
  }

  const all: RakutenItem[] = [];

  // 1. 個人名で検索（ソロ活動CD）
  all.push(...await fetchByArtist(name));

  // 2. グループ名で検索（グループCD = 本人出演の可能性が高い）
  if (group) {
    all.push(...await fetchByArtist(group, 3));
  }

  // 3. aliases/customKeywords でも検索
  for (const kw of [...(config.aliases ?? []), ...(config.customKeywords ?? [])]) {
    if (kw !== name && kw !== group) {
      all.push(...await fetchByArtist(kw));
    }
  }

  const seen = new Set<string>();
  return all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------
// グッズ: keyword に '${name} グッズ' 等を指定
//   グループ名/aliases/customKeywords でも検索、hits=30、最大2ページ
// ---------------------------------------------------------------
async function fetchIchiba(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  // 検索キーワード一覧（重複除去）
  const kwSet = new Set<string>();
  kwSet.add(`${name} グッズ`);
  if (group) kwSet.add(`${group} グッズ`);
  for (const alias of config.aliases ?? []) kwSet.add(`${alias} グッズ`);
  for (const ckw of config.customKeywords ?? []) kwSet.add(`${ckw} グッズ`);

  async function fetchKw(keyword: string): Promise<RakutenItem[]> {
    const items: RakutenItem[] = [];
    for (let page = 1; page <= 2; page++) {
      console.log(`[rakuten] Ichiba検索: keyword="${keyword}" page=${page}`);
      const res = await fetch(
        ichibaUrl('IchibaItem/Search/20260401', {
          applicationId: APP_ID,
          accessKey: ACCESS_KEY,
          affiliateId: AFFILIATE_ID,
          keyword,
          hits: '30',
          sort: '-reviewCount',
          page: String(page),
        }),
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        console.log(`[rakuten] Ichiba APIエラー: HTTP ${res.status} keyword="${keyword}" page=${page}`);
        break;
      }
      const data: RakutenIchibaResponse = await res.json();
      if (data.error) {
        console.log(`[rakuten] Ichiba APIエラー: ${JSON.stringify(data.error)} keyword="${keyword}"`);
        break;
      }
      if (!data.Items?.length) break;

      const returned = data.Items.length;
      const total = data.count ?? 0;
      console.log(`[rakuten] Ichiba取得: ${returned}件 (総数=${total}) keyword="${keyword}" page=${page}`);

      items.push(...data.Items.map(({ Item }) => ({
        id: stableId('ic', Item.itemUrl ?? ''),
        title: Item.itemName ?? '',
        shopName: Item.shopName ?? '',
        catchcopy: Item.catchcopy ?? '',
        description: (Item.itemCaption ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        reviewAverage: Number(Item.reviewAverage ?? 0),
        imageUrl: Item.mediumImageUrls?.[0]?.imageUrl ?? '',
        itemUrl: Item.itemUrl ?? '',
        affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
        category: 'グッズ' as const,
        relevanceScore: calcScore(
          { title: Item.itemName ?? '' },
          { name, group, excludeKeywords }
        ),
      })));

      if (returned < 30) break;
    }
    return items;
  }

  const all: RakutenItem[] = [];
  for (const keyword of kwSet) {
    all.push(...await fetchKw(keyword));
  }

  const seen = new Set<string>();
  return all.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
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
        // author 検索: 人物名が著者として登録されている書籍（写真集・単著等）
        products = await fetchBooksAuthor(name, group, config, category, cacheMode);
        break;
      case '本・雑誌':
        // title 検索: タイトルに人物名が含まれる書籍（雑誌・ムック・共著等）
        products = await fetchBooksTitle(name, group, config, category, cacheMode);
        break;
      case 'Blu-ray・DVD':
        products = await fetchDvd(name, group, config, cacheMode);
        break;
      case 'グッズ':
        products = await fetchIchiba(name, group, config, cacheMode);
        break;
      case 'CD':
        products = await fetchCd(name, group, config, cacheMode);
        break;
    }
    // スコアで降順ソートして返す（フィルタリングは呼び出し元で行う）
    const sorted = products.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return sorted.length > 0 ? { status: 'ok', products: sorted } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
