import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RakutenItem } from '@/types/rakuten';
import { CATEGORY_TABS, countProductsByTab, productTabAnchorId, productTabFromHash } from '../product-tabs';
import FeaturedProductsSection from '@/components/site/FeaturedProductsSection';
import ProductTabList from '@/components/ProductTabList';

const product = (id: string, o: Partial<RakutenItem> = {}): RakutenItem => ({
  id, title: `商品${id}`, itemUrl: `https://item.rakuten.co.jp/shop/${id}/`, affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/x/?pc=${id}`,
  imageUrl: '', price: 1000, reviewCount: 0, reviewAverage: 0, relevanceScore: 0, category: 'CD', ...o,
} as RakutenItem);

describe('カテゴリタブとページ内リンク（#products-<slug>）の対応', () => {
  it('全カテゴリタブが往復で一致する（既存のタブ名をそのまま使う）', () => {
    for (const tab of CATEGORY_TABS) {
      const id = productTabAnchorId(tab);
      expect(id).toMatch(/^products-[a-z]+$/);
      expect(productTabFromHash(`#${id}`)).toBe(tab);
    }
    expect(productTabFromHash('#products-cd')).toBe('CD');
    expect(productTabFromHash('#products-photobook')).toBe('写真集・書籍');
    expect(productTabFromHash('#products-bluray')).toBe('Blu-ray・DVD');
  });

  it('カテゴリ以外のハッシュ・未知の値は null（既存の #products・#vod 等はタブを変えない）', () => {
    for (const h of ['', '#', '#products', '#vod', '#featured-products', '#products-unknown', null, undefined]) {
      expect(productTabFromHash(h)).toBeNull();
    }
    expect(productTabAnchorId('すべて')).toBeNull();
    expect(productTabAnchorId('存在しない')).toBeNull();
  });

  it('タブ別件数は一覧と同じ数え方（中古は「中古」にまとめる）', () => {
    const counts = countProductsByTab([
      { sectionLabel: 'CD', isUsed: false }, { sectionLabel: 'CD', isUsed: false },
      { sectionLabel: 'CD', isUsed: true }, { sectionLabel: 'グッズ', isUsed: false },
    ]);
    expect(counts).toEqual({ すべて: 4, CD: 2, 中古: 1, グッズ: 1 });
  });
});

describe('関連商品ピックアップのカテゴリ別「もっと見る」', () => {
  const section = (label: string, n: number) => ({
    label, icon: '', usedProducts: [],
    newResult: n > 0 ? { status: 'ok' as const, products: Array.from({ length: n }, (_, i) => product(`${label}-${i}`)) } : { status: 'empty' as const },
  });
  const render = (sections: ReturnType<typeof section>[], categoryCounts?: Record<string, number>) =>
    renderToStaticMarkup(createElement(FeaturedProductsSection, { sectionResults: sections as never, personSlug: 'P', totalProductCount: 99, categoryCounts }));

  it('5件以上：ピックアップは4件、リンクは件数付きでそのカテゴリの一覧へ', () => {
    const html = render([section('CD', 7), section('写真集・書籍', 6)], { CD: 7, '写真集・書籍': 6 });
    expect(html).toContain('href="#products-cd"');
    expect(html).toContain('CDをもっと見る（全7件）');
    expect(html).toContain('href="#products-photobook"');
    expect(html).toContain('写真集・書籍をもっと見る（全6件）');
    expect(html.match(/楽天で見る/g)).toHaveLength(8); // 各4件（表示件数は従来どおり）
  });

  it('4件以下でピックアップに全部出ている場合はリンクを出さない／0件のカテゴリは表示しない', () => {
    const html = render([section('CD', 3), section('グッズ', 4), section('Blu-ray・DVD', 0)], { CD: 3, グッズ: 4 });
    expect(html).not.toContain('もっと見る（全');
    expect(html).not.toContain('#products-cd');
    expect(html).not.toContain('#products-goods');
    expect(html).not.toContain('Blu-ray・DVD');
  });

  it('ピックアップ外の商品（まとめ売り除外分など）が一覧にあればリンクを出す', () => {
    expect(render([section('グッズ', 3)], { グッズ: 5 })).toContain('グッズをもっと見る（全5件）');
  });

  it('件数が分からない場合は数字を出さない', () => {
    const html = render([section('CD', 4)]);
    expect(html).toContain('CDをもっと見る →');
    expect(html).not.toContain('（全');
  });

  it('楽天リンク（アフィリエイトURL・sponsored）は従来どおりで、「もっと見る」は楽天リンクではない', () => {
    const html = render([section('CD', 5)], { CD: 5 });
    expect(html).toContain('href="https://hb.afl.rakuten.co.jp/hgc/x/?pc=CD-0"');
    const more = html.match(/<a[^>]*href="#products-cd"[^>]*>/)?.[0] ?? '';
    expect(more).not.toContain('sponsored');
    expect(more).not.toContain('target');
  });
});

describe('関連商品一覧の着地点', () => {
  it('商品があるカテゴリだけ #products-<slug> の着地点を描画する（JSなしでもスクロールできる）', () => {
    const items = [
      { product: product('a'), sectionLabel: 'CD', isUsed: false },
      { product: product('b'), sectionLabel: '写真集・書籍', isUsed: false },
      { product: product('c'), sectionLabel: 'CD', isUsed: true },
    ];
    const html = renderToStaticMarkup(createElement(ProductTabList, { items, personSlug: 'P' }));
    expect(html).toContain('id="products-cd"');
    expect(html).toContain('id="products-photobook"');
    expect(html).toContain('id="products-used"');
    expect(html).not.toContain('id="products-goods"');
  });
});
