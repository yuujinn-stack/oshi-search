import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ProductCard from '@/components/ProductCard';
import type { RakutenItem } from '@/types/rakuten';
import {
  PRICE_FRESH_DAYS,
  STALE_PRICE_LABEL,
  formatPriceAsOf,
  formatPriceDate,
  isPriceStale,
  withPriceFreshness,
} from '../price-freshness';

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-20 12:00 JST
const NOW = Date.UTC(2026, 9, 20, 3, 0);

const product: RakutenItem = {
  id: 'cd-15830647',
  title: '今が思い出になるまで (通常盤)',
  price: 1650,
  reviewCount: 3,
  reviewAverage: 4.5,
  imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg',
  itemUrl: 'https://books.rakuten.co.jp/rb/15830647/',
  affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F15830647%2F',
  category: 'CD',
  relevanceScore: 0,
};

describe('価格の取得日と古さ（price-freshness）', () => {
  test(`取得から${PRICE_FRESH_DAYS}日以内は新しい、それを超えると古い`, () => {
    expect(isPriceStale(NOW - PRICE_FRESH_DAYS * DAY, NOW)).toBe(false);
    expect(isPriceStale(NOW - PRICE_FRESH_DAYS * DAY - 1, NOW)).toBe(true);
  });

  test('日付は日本時間で表示する（UTC では前日でも日本時間の日付）', () => {
    const utcLateNight = Date.UTC(2026, 9, 18, 16, 30); // JST 10/19 01:30
    expect(formatPriceDate(utcLateNight)).toBe('2026/10/19');
    expect(formatPriceAsOf(utcLateNight, NOW)).toBe('10/19時点');
    expect(formatPriceAsOf(Date.UTC(2025, 11, 31, 3), Date.UTC(2026, 0, 5, 3))).toBe('2025/12/31時点');
  });

  test('商品ごとの価格の取得日時（priceFetchedAt）だけを使い、表示用のコピーに付ける（元の商品データ・リンクは変えない）', () => {
    const fresh = withPriceFreshness({ ...product, priceFetchedAt: NOW - 2 * DAY }, NOW);
    expect(fresh).toMatchObject({ priceStale: false, priceDateLabel: '10/18時点', price: 1650, affiliateUrl: product.affiliateUrl, itemUrl: product.itemUrl });
    expect(product).not.toHaveProperty('priceStale');
    const stale = withPriceFreshness({ ...product, priceFetchedAt: NOW - 100 * DAY }, NOW);
    expect(stale).toMatchObject({ priceStale: true, priceDateLabel: '2026/7/12' });
  });

  test('価格の取得日時が無い商品（既存データ）は、日付を推測せず、strict モードでは価格を出さない扱いにする', () => {
    const unknown = withPriceFreshness(product, NOW, 'strict');
    expect(unknown.priceStale).toBe(true);
    expect(unknown.priceDateLabel).toBeUndefined();
    expect(unknown.priceFetchedAt).toBeUndefined();
  });
});
