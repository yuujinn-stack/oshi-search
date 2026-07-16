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

const APP_ID = (process.env.RAKUTEN_APP_ID ?? '').trim();
const ACCESS_KEY = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
const AFFILIATE_ID = (process.env.RAKUTEN_AFFILIATE_ID ?? '').trim();

// 楽天APIが 4xx/5xx を返した場合に throw して getProductsByCategory の catch で捕捉する
class RakutenApiError extends Error {
  constructor(public readonly httpStatus: number) {
    super(`楽天API HTTP ${httpStatus}`);
  }
}
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const REVALIDATE = 86400; // 24h

const BASE_ICHIBA = 'https://openapi.rakuten.co.jp/ichibams/api';
const BASE_BOOKS = 'https://openapi.rakuten.co.jp/services/api';
// Origin: 楽天APIのアプリ登録ドメイン検証用, accessKey: ヘッダー名を正確に "accessKey" で送信（クエリパラメータと併用）
const AUTH_HEADERS = { Origin: SITE_URL, accessKey: ACCESS_KEY };

// 診断用メタ情報: 秘密値を一切含まない（文字数と送信有無のみ）
const AUTH_DIAG = Object.freeze({
  hasApplicationId: APP_ID.length > 0,
  applicationIdLength: APP_ID.length,
  hasAccessKey: ACCESS_KEY.length > 0,
  accessKeyLength: ACCESS_KEY.length,
  applicationIdQuerySent: APP_ID.length > 0,
  accessKeyHeaderSent: ('accessKey' in AUTH_HEADERS) && ACCESS_KEY.length > 0,
  accessKeyQuerySent: ACCESS_KEY.length > 0,
});

/**
 * 楽天APIが非2xxを返したとき、秘密値を一切含まない構造化ログを1件 console.error で出力する。
 * pathname のみ記録しクエリ文字列（applicationId・accessKey の値）はログに含めない。
 */
export async function logRakutenUpstreamError(
  res: Response,
  requestUrl: string,
  authDiag: {
    hasApplicationId: boolean;
    applicationIdLength: number;
    hasAccessKey: boolean;
    accessKeyLength: number;
    applicationIdQuerySent: boolean;
    accessKeyHeaderSent: boolean;
    accessKeyQuerySent: boolean;
  },
): Promise<void> {
  // クエリ文字列を除外した pathname のみ取得（値をログに残さない）
  let pathname = '';
  let apiVersion = '';
  try {
    const u = new URL(requestUrl);
    pathname = u.pathname;
    const m = pathname.match(/\/(\d{8})(\/|$)/);
    if (m?.[1]) apiVersion = m[1];
  } catch { /* ignore invalid URL */ }

  // レスポンスボディを安全に読み取る（失敗しても処理を止めない）
  let rawBody = '';
  try { rawBody = await res.text(); } catch { /* ignore read error */ }

  // 楽天APIのエラーコード・説明文を安全に抽出（値の存在チェックのみ）
  // 優先順: フラット (errorCode/errorMessage) → 入れ子 (errors.errorCode/errorMessage) → 旧Ichiba形式 (error/error_description)
  let upstreamErrorCode: string | null = null;
  let upstreamErrorMessage: string | null = null;
  try {
    const j = JSON.parse(rawBody) as Record<string, unknown>;

    // 1. フラット形式: errorCode / errorMessage（数値・文字列どちらも文字列に変換）
    if (typeof j.errorCode === 'string') upstreamErrorCode = j.errorCode;
    else if (typeof j.errorCode === 'number') upstreamErrorCode = String(j.errorCode);
    if (typeof j.errorMessage === 'string') upstreamErrorMessage = j.errorMessage;

    // 2. 入れ子形式: errors.errorCode / errors.errorMessage（errors がオブジェクトの場合のみ）
    if (upstreamErrorCode === null || upstreamErrorMessage === null) {
      const errors = j.errors;
      if (errors !== null && typeof errors === 'object' && !Array.isArray(errors)) {
        const e = errors as Record<string, unknown>;
        if (upstreamErrorCode === null) {
          if (typeof e.errorCode === 'string') upstreamErrorCode = e.errorCode;
          else if (typeof e.errorCode === 'number') upstreamErrorCode = String(e.errorCode);
        }
        if (upstreamErrorMessage === null && typeof e.errorMessage === 'string') {
          upstreamErrorMessage = e.errorMessage;
        }
      }
    }

    // 3. 旧 Ichiba 形式: error / error_description（後方互換）
    if (upstreamErrorCode === null && typeof j.error === 'string') upstreamErrorCode = j.error;
    if (upstreamErrorMessage === null && typeof j.error_description === 'string') upstreamErrorMessage = j.error_description;
  } catch { /* not JSON */ }

  console.error(JSON.stringify({
    event: 'rakuten_api_upstream_error',
    hostname: 'openapi.rakuten.co.jp',
    pathname,
    apiVersion,
    method: 'GET',
    ...authDiag,
    upstreamStatus: res.status,
    responseContentType: res.headers.get('content-type'),
    upstreamErrorCode,
    upstreamErrorMessage,
    responseExcerpt: rawBody.slice(0, 300),
  }));
}

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
// 楽天市場の画像URLを高解像度版に変換（任意の _ex=NxN → 500x500）
function upgradeIchibaImageUrl(url: string): string {
  if (!url) return '';
  return url.replace(/\?_ex=\d+x\d+/, '?_ex=500x500');
}

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
    const reqUrl = booksUrl('BooksBook/Search/20170404', {
      applicationId: APP_ID,
      accessKey: ACCESS_KEY,
      affiliateId: AFFILIATE_ID,
      [paramKey]: paramValue,
      hits: '30',
      sort: 'standard',
      outOfStockFlag: '1',
      page: String(page),
    });
    const res = await fetch(
      reqUrl,
      { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG);
      throw new RakutenApiError(res.status);
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
  const usedKeywords: string[] = [];

  // 1. author 検索: 著者名として人物名が登録されている書籍
  for (const authorName of authorKeys) {
    usedKeywords.push(`author:${authorName}`);
    all.push(...await fetchBooksPages('author', authorName, 3, ctx));
  }

  // 2. title 検索: タイトルに人物名が含まれる写真集・ムック等をカバー
  //    著者登録が「グループ名 個人名」等の場合でも、タイトルには個人名が入ることが多い
  //    例: "乃木坂46 筒井あやめ1st写真集 感情の隙間" は title:筒井あやめ でヒット
  const titleSearchKeys = [name];
  if (config.realName && config.realName !== name) titleSearchKeys.push(config.realName);
  for (const alias of config.aliases ?? []) titleSearchKeys.push(alias);
  for (const key of titleSearchKeys) {
    usedKeywords.push(`title:${key}`);
    all.push(...await fetchBooksPages('title', key, 2, ctx));
  }

  // 3. author: group 検索: 写真集の著者がグループ名義で登録されているケースに対応
  //    例: author="乃木坂46" として登録されている個人写真集
  if (group) {
    usedKeywords.push(`author:${group}`);
    all.push(...await fetchBooksPages('author', group, 2, ctx));
  }

  // 4. keyword 補完検索: 著者名の書き方が「グループ名 個人名」等でも捕捉
  //    検索テストと同等のカバレッジを確保する
  const keywordSupplements = [
    `${name} 写真集`,         // 筒井あやめ 写真集
    `${name} 1st写真集`,      // 筒井あやめ 1st写真集
    `${name} カレンダー`,     // 筒井あやめ カレンダー
  ];
  if (group) {
    keywordSupplements.push(`${group} ${name}`);           // 乃木坂46 筒井あやめ
    keywordSupplements.push(`${group} ${name} 写真集`);    // 乃木坂46 筒井あやめ 写真集
    keywordSupplements.push(`${group} ${name} 1st写真集`); // 乃木坂46 筒井あやめ 1st写真集
  }
  if (config.realName && config.realName !== name) {
    keywordSupplements.push(`${config.realName} 写真集`);
  }
  for (const alias of config.aliases ?? []) keywordSupplements.push(`${alias} 写真集`);

  for (const kw of keywordSupplements) {
    usedKeywords.push(`keyword:${kw}`);
    all.push(...await fetchBooksPages('keyword', kw, 2, ctx));
  }

  const beforeDedup = all.length;
  const seen = new Set<string>();
  const deduped = all.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  console.log(`[NORMAL_FETCH] category:${category} keywords:${usedKeywords.join(',')} beforeDedupCount:${beforeDedup} afterDedupCount:${deduped.length}`);
  return deduped;
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
      const reqUrl = booksUrl('BooksDVD/Search/20130522', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName,
        hits: '30',
        sort: 'standard',
        outOfStockFlag: '1',
        page: String(page),
      } as Record<string, string>);
      const res = await fetch(
        reqUrl,
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG);
        throw new RakutenApiError(res.status);
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
      const reqUrl = booksUrl('BooksCD/Search/20130522', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName,
        hits: '30',
        sort: 'standard',
        outOfStockFlag: '1',
        page: String(page),
      } as Record<string, string>);
      const res = await fetch(
        reqUrl,
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG);
        throw new RakutenApiError(res.status);
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
      const reqUrl = ichibaUrl('IchibaItem/Search/20260701', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        keyword,
        hits: '30',
        sort: '-reviewCount',
        page: String(page),
      });
      const res = await fetch(
        reqUrl,
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG);
        throw new RakutenApiError(res.status);
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

      items.push(...data.Items.map(({ Item }) => {
        const title = Item.itemName ?? '';
        return {
          id: stableId('ic', Item.itemUrl ?? ''),
          title,
          shopName: Item.shopName ?? '',
          catchcopy: Item.catchcopy ?? '',
          description: (Item.itemCaption ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
          price: Number(Item.itemPrice ?? 0),
          reviewCount: Number(Item.reviewCount ?? 0),
          reviewAverage: Number(Item.reviewAverage ?? 0),
          imageUrl: upgradeIchibaImageUrl(Item.mediumImageUrls?.[0]?.imageUrl ?? ''),
          itemUrl: Item.itemUrl ?? '',
          affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
          category: 'グッズ' as const,
          isUsed: title.includes('中古'),
          relevanceScore: calcScore(
            { title },
            { name, group, excludeKeywords }
          ),
        };
      }));

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
// 中古商品: 楽天市場から「中古」キーワードで検索
//   中古品は【中古】がタイトルに含まれる市場商品として流通している
//   写真集・CD・DVD・グッズの中古をまとめて1カテゴリで取得し、
//   表示時にタイトルキーワードで各セクションに分類する
// ---------------------------------------------------------------
async function fetchUsed(
  name: string,
  group: string,
  config: PersonConfig,
  cacheMode: RequestCache = 'default',
): Promise<RakutenItem[]> {
  const excludeKeywords = config.excludeKeywords ?? [];

  const kwSet = new Set<string>();
  // 人物名を含むキーワードのみ（グループ単独キーワードは取得量が膨大になるため省略）
  kwSet.add(`${name} 写真集 中古`);
  kwSet.add(`${name} CD 中古`);
  if (group) {
    kwSet.add(`${group} ${name} 写真集 中古`);
  }
  for (const alias of config.aliases ?? []) {
    kwSet.add(`${alias} 中古`);
  }
  for (const ckw of config.customKeywords ?? []) {
    kwSet.add(`${ckw} 中古`);
  }

  async function fetchKw(keyword: string): Promise<RakutenItem[]> {
    const items: RakutenItem[] = [];
    for (let page = 1; page <= 1; page++) {
      console.log(`[rakuten] 中古検索: keyword="${keyword}" page=${page}`);
      const reqUrl = ichibaUrl('IchibaItem/Search/20260701', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        keyword,
        hits: '30',
        sort: '-reviewCount',
        page: String(page),
      });
      const res = await fetch(
        reqUrl,
        { cache: cacheMode, next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined, headers: AUTH_HEADERS }
      );
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG);
        throw new RakutenApiError(res.status);
      }
      const data: RakutenIchibaResponse = await res.json();
      if (data.error) {
        console.log(`[rakuten] 中古 APIエラー: ${JSON.stringify(data.error)} keyword="${keyword}"`);
        break;
      }
      if (!data.Items?.length) break;

      const returned = data.Items.length;
      const total = data.count ?? 0;
      console.log(`[rakuten] 中古取得: ${returned}件 (総数=${total}) keyword="${keyword}" page=${page}`);

      items.push(...data.Items.map(({ Item }) => ({
        id: stableId('ic', Item.itemUrl ?? ''),
        title: Item.itemName ?? '',
        shopName: Item.shopName ?? '',
        catchcopy: Item.catchcopy ?? '',
        description: (Item.itemCaption ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        reviewAverage: Number(Item.reviewAverage ?? 0),
        imageUrl: upgradeIchibaImageUrl(Item.mediumImageUrls?.[0]?.imageUrl ?? ''),
        itemUrl: Item.itemUrl ?? '',
        affiliateUrl: affiliateLink(Item.affiliateUrl ?? '', Item.itemUrl ?? ''),
        category: '中古' as const,
        isUsed: true,
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

  // 中古であることを確認（タイトルに「中古」を含むもののみ保持）してデdup
  const seen = new Set<string>();
  return all
    .filter((p) => p.title.includes('中古'))
    .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
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
  // 呼び出し時点の env を参照（module load 後に設定される CI/test 環境でも正しく動作する）
  const appId = (process.env.RAKUTEN_APP_ID ?? '').trim();
  const accessKey = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (!appId || !accessKey) return { status: 'config_missing' };

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
      case '中古':
        products = await fetchUsed(name, group, config, cacheMode);
        break;
    }
    // スコアで降順ソートして返す（フィルタリングは呼び出し元で行う）
    const sorted = products.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return sorted.length > 0 ? { status: 'ok', products: sorted } : { status: 'empty' };
  } catch (err) {
    if (err instanceof RakutenApiError) {
      return { status: 'upstream_error', httpStatus: err.httpStatus };
    }
    return { status: 'error' };
  }
}
