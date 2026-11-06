import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { OSHIKATSU_CATEGORIES, OSHIKATSU_PATH, isCategoryLinkable } from '@/lib/oshikatsu-services/categories';
import { GOODS_MAKING_PATH } from '@/lib/oshikatsu-services/goods-making';
import { GOODS_BUYBACK_PATH } from '@/lib/oshikatsu-services/goods-buyback';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('推し活サービスのジャンル', () => {
  test('3ジャンル（グッズ制作・グッズ買取・ファッションレンタル）。リンクできるのはグッズ制作とグッズ買取', () => {
    expect(OSHIKATSU_CATEGORIES.map((c) => c.id)).toEqual(['goods_making', 'goods_buyback', 'fashion_rental']);
    expect(OSHIKATSU_CATEGORIES.filter(isCategoryLinkable).map((c) => c.href)).toEqual([GOODS_MAKING_PATH, GOODS_BUYBACK_PATH]);
  });

  test('準備中のジャンルはリンク先を持たない（存在しないページへのリンクを作らない）', () => {
    for (const c of OSHIKATSU_CATEGORIES.filter((x) => x.status === 'coming_soon')) {
      expect(c.href).toBeNull();
      expect(isCategoryLinkable(c)).toBe(false);
    }
  });

  test('リンクできるジャンルのページが実在する', () => {
    expect(existsSync(path.join(root, 'src/app', OSHIKATSU_PATH, 'page.tsx'))).toBe(true);
    for (const c of OSHIKATSU_CATEGORIES.filter(isCategoryLinkable)) {
      expect(existsSync(path.join(root, 'src/app', c.href, 'page.tsx')), c.href).toBe(true);
    }
  });

  test('status が available でも href がなければリンクにしない', () => {
    const c = { ...OSHIKATSU_CATEGORIES[1], status: 'available' as const, href: null };
    expect(isCategoryLinkable(c)).toBe(false);
  });
});

describe('導線', () => {
  test('ホームに推し活サービスのコーナーがあり、3つの機能カードの後・「ジャンルで探す」の前に置く', () => {
    const home = read('src/app/page.tsx');
    const card = home.indexOf('<OshiCardEntryCta');
    const section = home.indexOf('<OshikatsuServicesHomeSection');
    const genre = home.indexOf('ジャンルで探す</h2>');
    expect(card).toBeGreaterThan(0);
    expect(section).toBeGreaterThan(card);
    expect(genre).toBeGreaterThan(section);
  });

  test('ホームのコーナーは <aside> で描画し、セクション番号CSSの対象（section・.section-heading）にしない', () => {
    const src = read('src/components/oshikatsu/OshikatsuServicesHomeSection.tsx');
    expect(src).toContain('<aside');
    expect(src).not.toContain('<section');
    expect(src).not.toMatch(/className="[^"]*section-heading/);
  });

  test('推し活お買い物診断からグッズ制作比較への導線は削除済み', () => {
    const shopping = read('src/app/oshi-shopping/page.tsx');
    expect(shopping).not.toContain('GOODS_MAKING_PATH');
    expect(shopping).not.toContain('/oshikatsu');
  });

  test('サイトマップに総合ページとグッズ制作比較がある', () => {
    const sitemap = read('src/app/sitemap.ts');
    expect(sitemap).toContain('${BASE_URL}/oshikatsu`');
    expect(sitemap).toContain('${BASE_URL}/oshikatsu/goods-making`');
  });
});
