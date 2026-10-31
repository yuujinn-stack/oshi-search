import type {
  ProductCategory,
  RakutenItem,
  RakutenIchibaResponse,
  RakutenBooksResponse,
  RakutenDvdResponse,
  ApiResult,
} from '@/types/rakuten';
import { ichibaItemIdFromApi, type IchibaIdStatus } from '@/lib/rakuten-item-id';
import type { PersonConfig } from '@/types/person';
import { calcScore } from './scoring';
import { RakutenApiCooldownError, currentRakutenApiSession, rakutenApiFetch } from './rakuten-api-gate';

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

// ── 楽天APIへのリクエストペーシング・429対策 ──────────────────────────────────
// 同時実行数は常に1（全呼び出しは逐次await）。ここでは呼び出し間隔と429時の
// 待機・再試行のみを制御する。無限リトライはしない（最大1回）。
const REQUEST_INTERVAL_MS = 400;
const MIN_RETRY_WAIT_MS = 1000;
let lastRakutenRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceRakutenRequest(): Promise<void> {
  const wait = lastRakutenRequestAt + REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRakutenRequestAt = Date.now();
}

// Retry-Afterヘッダーを優先し、無ければ本文の「Try again in N seconds」を安全に解釈する。
// どちらも得られない場合は最低1秒。本文の内容自体はログへ出さない（待機時間の算出のみに使う）。
function resolveRetryWaitMs(res: Response, bodyExcerpt: string): number {
  const headerVal = res.headers.get('retry-after');
  if (headerVal) {
    const asSeconds = Number(headerVal);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return Math.max(MIN_RETRY_WAIT_MS, asSeconds * 1000);
    }
  }
  const m = bodyExcerpt.match(/try again in\s+(\d+)\s+second/i);
  if (m) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec) && sec >= 0) return Math.max(MIN_RETRY_WAIT_MS, sec * 1000);
  }
  return MIN_RETRY_WAIT_MS;
}

// 楽天APIへのGETリクエストの共通実行関数。
//  - 呼び出し間隔をペーシング（同時実行数1・連続呼び出し防止）
//  - 429を受けた場合のみ、Retry-Afterを優先した待機後に1回だけ再試行する
//  - 2回目も429（またはそれ以外の非2xx）ならそのレスポンスをそのまま返し、
//    呼び出し元（各fetch関数の `!res.ok` チェック）に処理を委ねる。
//    そのカテゴリ内の以降の検索・他カテゴリの処理は呼び出し元の既存の分離構造により継続される。
//
// 価格更新（src/lib/price-refresh.ts）が楽天APIの共通の使用権（src/lib/rakuten-api-gate.ts）の中で呼んだときだけ、
// その使用権を通して送る（1.1秒以上の間隔・2回目も 429 なら全経路共通の停止を記録）。
// それ以外（既存の商品の自動更新・管理画面）は従来どおりこのプロセス内の間隔制御で送る（動作は変えない）。
async function rakutenFetch(reqUrl: string, cacheMode: RequestCache): Promise<Response> {
  const init = {
    cache: cacheMode,
    next: cacheMode === 'default' ? { revalidate: REVALIDATE } : undefined,
    headers: AUTH_HEADERS,
  } as RequestInit;
  const session = currentRakutenApiSession();
  if (!session) await paceRakutenRequest();
  const doFetch = session
    ? () => rakutenApiFetch(reqUrl, init, { label: 'rakuten', maxWaitMs: 60_000, onUnavailable: 'local' })
    : () => fetch(reqUrl, init);

  let res = await doFetch();
  if (res.status === 429) {
    let bodyExcerpt = '';
    try { bodyExcerpt = (session ? await res.clone().text() : await res.text()).slice(0, 200); } catch { /* ignore */ }
    const waitMs = resolveRetryWaitMs(res, bodyExcerpt);
    console.log(`[rakuten] 429受信、${waitMs}ms待機後に1回だけ再試行します`);
    await sleep(waitMs);
    if (!session) lastRakutenRequestAt = Date.now();
    res = await doFetch();
    // 共通の使用権の中で2回目も 429 なら、全経路共通の停止を記録する（以後この使用権では送らない）
    if (session && res.status === 429) await session.reportRateLimited(res);
  }
  return res;
}

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
  // どの検索条件で失敗したかを特定するための情報（カテゴリ・キーワード・ページ等。認証情報は入れない）
  searchCondition?: Record<string, string | number>,
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
    ...(searchCondition ? { searchCondition } : {}),
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

// 楽天市場の商品ID（Phase 4）：店舗単位だった旧ID（stableId('ic', itemUrl)）の代わりに、公式の itemCode から作る。
// itemCode が無い・不正・商品URLの店舗と一致しない商品は推測でIDを作らず、保存しない（理由ごとに件数をログ）。
function ichibaItemsWithId<T>(
  label: string,
  items: { Item: { itemCode?: string; itemUrl?: string } & T }[],
  build: (Item: { itemCode?: string; itemUrl?: string } & T, id: string) => RakutenItem,
): RakutenItem[] {
  const skipped: Partial<Record<IchibaIdStatus, number>> = {};
  let urlDiffers = 0;
  const out: RakutenItem[] = [];
  for (const { Item } of items) {
    const r = ichibaItemIdFromApi({ itemCode: Item.itemCode, itemUrl: Item.itemUrl });
    if (!r.id) { skipped[r.status] = (skipped[r.status] ?? 0) + 1; continue; }
    if (r.status === 'ok_url_differs') urlDiffers++;
    out.push(build(Item, r.id));
  }
  if (Object.keys(skipped).length || urlDiffers) {
    console.warn(`[rakuten] ${label}: 商品IDを確認できず保存しない ${JSON.stringify(skipped)} / itemCode と商品URLの商品コードが異なる ${urlDiffers}件（itemCode を使用）`);
  }
  return out;
}

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
    const res = await rakutenFetch(reqUrl, cacheMode);
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
      const res = await rakutenFetch(reqUrl, cacheMode);
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
      const res = await rakutenFetch(reqUrl, cacheMode);
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

// 楽天市場APIの keyword は「各単語が半角2文字以上、または全角1文字以上（ひらがな・カタカナ・記号は2文字以上）」
// でないと 400 wrong_parameter（keyword parameter is not valid）になる。
// グループ名「King & Prince」の「&」のような条件を満たさない単語だけを取り除く（残りの単語の AND 検索になる）。
const ICHIBA_SINGLE_CHAR_WORD_OK = /^[\p{Script=Han}Ａ-Ｚａ-ｚ０-９]$/u;
export function toIchibaKeyword(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((w) => w !== '' && ([...w].length >= 2 || ICHIBA_SINGLE_CHAR_WORD_OK.test(w)))
    .join(' ');
}

// 楽天市場のキーワードを順に検索する。1キーワードの失敗（429以外の 4xx/5xx）は、そのキーワードだけ飛ばして
// 他のキーワードで取得できた商品は捨てない。全キーワードが失敗した場合だけ最初のエラーを投げる（従来どおり upstream_error）。
// 429 は全経路共通の停止に関わるため、従来どおりその場で打ち切る。
async function collectIchibaKeywords(
  label: string,
  keywords: Iterable<string>,
  fetchKw: (keyword: string) => Promise<RakutenItem[]>,
): Promise<RakutenItem[]> {
  const all: RakutenItem[] = [];
  let firstError: RakutenApiError | undefined;
  let succeeded = 0;
  for (const keyword of keywords) {
    try {
      all.push(...await fetchKw(keyword));
      succeeded++;
    } catch (err) {
      if (!(err instanceof RakutenApiError) || err.httpStatus === 429) throw err;
      console.error(`[rakuten] ${label}: キーワード検索失敗のためスキップ keyword="${keyword}" httpStatus=${err.httpStatus}`);
      firstError ??= err;
    }
  }
  if (firstError && succeeded === 0) throw firstError;
  if (firstError) console.log(`[rakuten] ${label}: 一部のキーワードが失敗したため、成功したキーワードの${all.length}件のみ返します`);
  return all;
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

  // 検索キーワード一覧（楽天市場APIで無効な単語を除いた上で重複除去）
  const kwSet = new Set<string>();
  const addKw = (kw: string) => { const k = toIchibaKeyword(kw); if (k) kwSet.add(k); };
  addKw(`${name} グッズ`);
  if (group) addKw(`${group} グッズ`);
  for (const alias of config.aliases ?? []) addKw(`${alias} グッズ`);
  for (const ckw of config.customKeywords ?? []) addKw(`${ckw} グッズ`);

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
      const res = await rakutenFetch(reqUrl, cacheMode);
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG, { category: 'グッズ', keyword, page });
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

      items.push(...ichibaItemsWithId('Ichiba', data.Items, (Item, id) => {
        const title = Item.itemName ?? '';
        return {
          id,
          itemCode: Item.itemCode,
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

  const all = await collectIchibaKeywords('グッズ', kwSet, fetchKw);

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
  const addKw = (kw: string) => { const k = toIchibaKeyword(kw); if (k) kwSet.add(k); };
  // 人物名を含むキーワードのみ（グループ単独キーワードは取得量が膨大になるため省略）
  addKw(`${name} 写真集 中古`);
  addKw(`${name} CD 中古`);
  if (group) {
    addKw(`${group} ${name} 写真集 中古`);
  }
  for (const alias of config.aliases ?? []) {
    addKw(`${alias} 中古`);
  }
  for (const ckw of config.customKeywords ?? []) {
    addKw(`${ckw} 中古`);
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
      const res = await rakutenFetch(reqUrl, cacheMode);
      if (!res.ok) {
        await logRakutenUpstreamError(res, reqUrl, AUTH_DIAG, { category: '中古', keyword, page });
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

      items.push(...ichibaItemsWithId('中古', data.Items, (Item, id) => ({
        id,
        itemCode: Item.itemCode,
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

  const all = await collectIchibaKeywords('中古', kwSet, fetchKw);

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
    // 価格更新の使用権の中で、全経路共通の停止中（直前に 429）だった場合は、楽天へ送らずに 429 と同じ扱いにする
    if (err instanceof RakutenApiCooldownError) {
      console.log(`[rakuten] 楽天APIの呼び出し停止中のため取得しませんでした: category=${category} name=${name}`);
      return { status: 'upstream_error', httpStatus: 429 };
    }
    // RakutenApiError以外（ネットワーク断・タイムアウト等、fetch自体が失敗したケース）は
    // これまで内容が一切ログに残らず、Vercel Logsから原因確認ができなかった。
    // 戻り値（{status:'error'}）は変更せず、ログ出力のみ追加する。
    console.error(`[rakuten] getProductsByCategory failed (non-HTTP error): category=${category} name=${name} error=${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    return { status: 'error' };
  }
}
