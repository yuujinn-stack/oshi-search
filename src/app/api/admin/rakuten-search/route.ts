import { NextRequest, NextResponse } from 'next/server';
import type { ProductCategory } from '@/types/person';

const APP_ID = process.env.RAKUTEN_APP_ID ?? '';
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? '';
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID ?? '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const BASE_BOOKS = 'https://openapi.rakuten.co.jp/services/api';
const BASE_ICHIBA = 'https://openapi.rakuten.co.jp/ichibams/api';
const AUTH_HEADERS = { Origin: SITE_URL };

export interface RakutenSearchItem {
  title: string;
  imageUrl: string;
  itemUrl: string;
  price: number;
  reviewCount: number;
  shopName?: string;
  author?: string;
  artistName?: string;
  isUsed: boolean;
  suggestedCategory: ProductCategory;
}

type ApiType = 'books_kw' | 'books_author' | 'books_title' | 'cd' | 'dvd' | 'ichiba';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') ?? '';
  const type = (searchParams.get('type') ?? 'books_kw') as ApiType;
  const hits = Math.min(Number(searchParams.get('hits') ?? '20'), 30);
  const sort = searchParams.get('sort') ?? 'standard';

  if (!APP_ID || !ACCESS_KEY) {
    return NextResponse.json({ error: '楽天APIキーが設定されていません', items: [], count: 0 }, { status: 503 });
  }
  if (!q.trim()) {
    return NextResponse.json({ items: [], count: 0 });
  }

  try {
    if (type === 'books_kw' || type === 'books_author' || type === 'books_title') {
      const paramKey = type === 'books_kw' ? 'keyword' : type === 'books_author' ? 'author' : 'title';
      const params = new URLSearchParams({
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        [paramKey]: q,
        hits: String(hits),
        sort,
        outOfStockFlag: '1',
      });
      const res = await fetch(`${BASE_BOOKS}/BooksBook/Search/20170404?${params}`, {
        cache: 'no-store',
        headers: AUTH_HEADERS,
      });
      const data = await res.json() as { Items?: { Item: Record<string, string | number> }[]; count?: number; error?: unknown };
      if (data.error) return NextResponse.json({ error: JSON.stringify(data.error), items: [], count: 0 });
      const items: RakutenSearchItem[] = (data.Items ?? []).map(({ Item }) => ({
        title: String(Item.title ?? ''),
        imageUrl: String(Item.largeImageUrl ?? Item.mediumImageUrl ?? ''),
        itemUrl: String(Item.itemUrl ?? ''),
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        author: String(Item.author ?? '') || undefined,
        isUsed: false,
        suggestedCategory: '本・雑誌',
      }));
      return NextResponse.json({ items, count: data.count ?? items.length });
    }

    if (type === 'cd') {
      const params = new URLSearchParams({
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName: q,
        hits: String(hits),
        sort,
        outOfStockFlag: '1',
      });
      const res = await fetch(`${BASE_BOOKS}/BooksCD/Search/20130522?${params}`, {
        cache: 'no-store',
        headers: AUTH_HEADERS,
      });
      const data = await res.json() as { Items?: { Item: Record<string, string | number> }[]; count?: number; error?: unknown };
      if (data.error) return NextResponse.json({ error: JSON.stringify(data.error), items: [], count: 0 });
      const items: RakutenSearchItem[] = (data.Items ?? []).map(({ Item }) => ({
        title: String(Item.title ?? ''),
        imageUrl: String(Item.largeImageUrl ?? Item.mediumImageUrl ?? ''),
        itemUrl: String(Item.itemUrl ?? ''),
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        artistName: String(Item.artistName ?? '') || undefined,
        isUsed: false,
        suggestedCategory: 'CD',
      }));
      return NextResponse.json({ items, count: data.count ?? items.length });
    }

    if (type === 'dvd') {
      const params = new URLSearchParams({
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        artistName: q,
        hits: String(hits),
        sort,
        outOfStockFlag: '1',
      });
      const res = await fetch(`${BASE_BOOKS}/BooksDVD/Search/20130522?${params}`, {
        cache: 'no-store',
        headers: AUTH_HEADERS,
      });
      const data = await res.json() as { Items?: { Item: Record<string, string | number> }[]; count?: number; error?: unknown };
      if (data.error) return NextResponse.json({ error: JSON.stringify(data.error), items: [], count: 0 });
      const items: RakutenSearchItem[] = (data.Items ?? []).map(({ Item }) => ({
        title: String(Item.title ?? ''),
        imageUrl: String(Item.largeImageUrl ?? Item.mediumImageUrl ?? ''),
        itemUrl: String(Item.itemUrl ?? ''),
        price: Number(Item.itemPrice ?? 0),
        reviewCount: Number(Item.reviewCount ?? 0),
        artistName: String(Item.artistName ?? '') || undefined,
        isUsed: false,
        suggestedCategory: 'Blu-ray・DVD',
      }));
      return NextResponse.json({ items, count: data.count ?? items.length });
    }

    if (type === 'ichiba') {
      const params = new URLSearchParams({
        applicationId: APP_ID,
        accessKey: ACCESS_KEY,
        affiliateId: AFFILIATE_ID,
        keyword: q,
        hits: String(hits),
        sort,
      });
      const res = await fetch(`${BASE_ICHIBA}/IchibaItem/Search/20260401?${params}`, {
        cache: 'no-store',
        headers: AUTH_HEADERS,
      });
      const data = await res.json() as {
        Items?: { Item: Record<string, unknown> }[];
        count?: number;
        error?: unknown;
      };
      if (data.error) return NextResponse.json({ error: JSON.stringify(data.error), items: [], count: 0 });
      const items: RakutenSearchItem[] = (data.Items ?? []).map(({ Item }) => {
        const imgs = (Item.mediumImageUrls as { imageUrl: string }[] | undefined) ?? [];
        return {
          title: String(Item.itemName ?? ''),
          imageUrl: imgs[0]?.imageUrl ?? '',
          itemUrl: String(Item.itemUrl ?? ''),
          price: Number(Item.itemPrice ?? 0),
          reviewCount: Number(Item.reviewCount ?? 0),
          shopName: String(Item.shopName ?? '') || undefined,
          isUsed: false,
          suggestedCategory: 'グッズ' as ProductCategory,
        };
      });
      return NextResponse.json({ items, count: data.count ?? items.length });
    }

    return NextResponse.json({ error: '不明なAPIタイプです', items: [], count: 0 }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err), items: [], count: 0 }, { status: 500 });
  }
}
