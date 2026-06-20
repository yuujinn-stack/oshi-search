import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfigMerged } from '@/lib/persons';

// GET /api/admin/search-test?person=筒井あやめ
// 実際の楽天API検索を複数キーワードで実行し、取得漏れの診断に使用
// Redisへの保存は一切行わない（読み取り専用）

const APP_ID = process.env.RAKUTEN_APP_ID ?? '';
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? '';
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID ?? '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const BASE_BOOKS = 'https://openapi.rakuten.co.jp/services/api';
const BASE_ICHIBA = 'https://openapi.rakuten.co.jp/ichibams/api';
const AUTH_HEADERS = { Origin: SITE_URL };

function booksUrl(endpoint: string, params: Record<string, string>): string {
  return `${BASE_BOOKS}/${endpoint}?${new URLSearchParams(params)}`;
}
function ichibaUrl(endpoint: string, params: Record<string, string>): string {
  return `${BASE_ICHIBA}/${endpoint}?${new URLSearchParams(params)}`;
}

interface SearchResult {
  keyword: string;
  paramType: string;
  api: string;
  count: number;
  items: Array<{ title: string; author?: string; artistName?: string; itemUrl: string; price: number }>;
  error?: string;
}

async function searchBooks(paramType: 'author' | 'title' | 'keyword', value: string, hits = 10): Promise<SearchResult> {
  const label = `${paramType}: "${value}"`;
  try {
    const res = await fetch(
      booksUrl('BooksBook/Search/20170404', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        [paramType]: value,
        hits: String(hits),
        sort: 'standard',
        outOfStockFlag: '1',
      }),
      { cache: 'no-store', headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      return { keyword: value, paramType: label, api: 'BooksBook', count: 0, items: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.error) {
      return { keyword: value, paramType: label, api: 'BooksBook', count: 0, items: [], error: JSON.stringify(data.error) };
    }
    const items = (data.Items ?? []).map(({ Item }: { Item: Record<string, string | number> }) => ({
      title: String(Item.title ?? ''),
      author: String(Item.author ?? ''),
      itemUrl: String(Item.itemUrl ?? ''),
      price: Number(Item.itemPrice ?? 0),
    }));
    return { keyword: value, paramType: label, api: 'BooksBook', count: data.count ?? items.length, items };
  } catch (err) {
    return { keyword: value, paramType: label, api: 'BooksBook', count: 0, items: [], error: String(err) };
  }
}

async function searchCd(artistName: string, hits = 10): Promise<SearchResult> {
  const label = `CD artistName: "${artistName}"`;
  try {
    const res = await fetch(
      booksUrl('BooksCD/Search/20130522', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName,
        hits: String(hits),
        sort: 'standard',
        outOfStockFlag: '1',
      } as Record<string, string>),
      { cache: 'no-store', headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      return { keyword: artistName, paramType: label, api: 'BooksCD', count: 0, items: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.error) {
      return { keyword: artistName, paramType: label, api: 'BooksCD', count: 0, items: [], error: JSON.stringify(data.error) };
    }
    const items = (data.Items ?? []).map(({ Item }: { Item: Record<string, string | number> }) => ({
      title: String(Item.title ?? ''),
      artistName: String(Item.artistName ?? ''),
      itemUrl: String(Item.itemUrl ?? ''),
      price: Number(Item.itemPrice ?? 0),
    }));
    return { keyword: artistName, paramType: label, api: 'BooksCD', count: data.count ?? items.length, items };
  } catch (err) {
    return { keyword: artistName, paramType: label, api: 'BooksCD', count: 0, items: [], error: String(err) };
  }
}

async function searchDvd(artistName: string, hits = 10): Promise<SearchResult> {
  const label = `artistName: "${artistName}"`;
  try {
    const res = await fetch(
      booksUrl('BooksDVD/Search/20130522', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName,
        hits: String(hits),
        sort: 'standard',
        outOfStockFlag: '1',
      } as Record<string, string>),
      { cache: 'no-store', headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      return { keyword: artistName, paramType: label, api: 'BooksDVD', count: 0, items: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.error) {
      return { keyword: artistName, paramType: label, api: 'BooksDVD', count: 0, items: [], error: JSON.stringify(data.error) };
    }
    const items = (data.Items ?? []).map(({ Item }: { Item: Record<string, string | number> }) => ({
      title: String(Item.title ?? ''),
      artistName: String(Item.artistName ?? ''),
      itemUrl: String(Item.itemUrl ?? ''),
      price: Number(Item.itemPrice ?? 0),
    }));
    return { keyword: artistName, paramType: label, api: 'BooksDVD', count: data.count ?? items.length, items };
  } catch (err) {
    return { keyword: artistName, paramType: label, api: 'BooksDVD', count: 0, items: [], error: String(err) };
  }
}

async function searchIchiba(keyword: string, hits = 10): Promise<SearchResult> {
  const label = `keyword: "${keyword}"`;
  try {
    const res = await fetch(
      ichibaUrl('IchibaItem/Search/20260401', {
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        keyword,
        hits: String(hits),
        sort: '-reviewCount',
      }),
      { cache: 'no-store', headers: AUTH_HEADERS }
    );
    if (!res.ok) {
      return { keyword, paramType: label, api: 'Ichiba', count: 0, items: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.error) {
      return { keyword, paramType: label, api: 'Ichiba', count: 0, items: [], error: JSON.stringify(data.error) };
    }
    const items = (data.Items ?? []).map(({ Item }: { Item: Record<string, string | number | Array<{imageUrl: string}>> }) => ({
      title: String(Item.itemName ?? ''),
      itemUrl: String(Item.itemUrl ?? ''),
      price: Number(Item.itemPrice ?? 0),
    }));
    return { keyword, paramType: label, api: 'Ichiba', count: data.count ?? items.length, items };
  } catch (err) {
    return { keyword, paramType: label, api: 'Ichiba', count: 0, items: [], error: String(err) };
  }
}

export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('person');
  if (!personName) {
    return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });
  }
  if (!APP_ID || !ACCESS_KEY) {
    return NextResponse.json({ error: '楽天APIキーが設定されていません' }, { status: 503 });
  }

  const person = await getPersonWithConfigMerged(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const name = person.name;
  const group = person.group ?? '';

  const searches: SearchResult[] = [];

  // ===== 写真集・書籍系 =====
  // 1. author 検索（著者名として登録されている場合）
  searches.push(await searchBooks('author', name));

  // 2. title 検索（タイトルに名前が含まれる場合）
  searches.push(await searchBooks('title', name));

  // 3. keyword: 名前 写真集（著者名が異なる場合でも写真集を捕捉）
  searches.push(await searchBooks('keyword', `${name} 写真集`));

  // 4. keyword: 名前 カレンダー
  searches.push(await searchBooks('keyword', `${name} カレンダー`));

  // 5. keyword: 名前 雑誌
  searches.push(await searchBooks('keyword', `${name} 雑誌`));

  // 6. keyword: 名前 グループ名
  if (group) {
    searches.push(await searchBooks('keyword', `${name} ${group}`));
  }

  // グループ名での author 検索（グループ名が著者として登録されている場合）
  if (group) {
    searches.push(await searchBooks('author', group, 10));
  }

  // ===== CD =====
  searches.push(await searchCd(name));
  if (group) {
    searches.push(await searchCd(group));
  }

  // ===== DVD =====
  searches.push(await searchDvd(name));
  if (group) {
    searches.push(await searchDvd(group));
  }

  // ===== グッズ（楽天市場）=====
  searches.push(await searchIchiba(`${name} グッズ`));
  if (group) {
    searches.push(await searchIchiba(`${group} グッズ`));
  }

  // config の aliases/customKeywords でも検索
  const extraKeys = [
    ...(person.config.aliases ?? []),
    ...(person.config.customKeywords ?? []),
  ];
  for (const kw of extraKeys) {
    searches.push(await searchBooks('author', kw));
    searches.push(await searchBooks('keyword', `${kw} 写真集`));
  }

  return NextResponse.json({
    person: { name, group, config: person.config },
    searches,
    summary: {
      totalSearches: searches.length,
      withResults: searches.filter((s) => s.count > 0).length,
      apiErrors: searches.filter((s) => s.error).length,
    },
  });
}
