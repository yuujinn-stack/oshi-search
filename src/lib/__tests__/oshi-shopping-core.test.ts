import { describe, test, expect } from 'vitest';
import type { ProductCategory, RakutenItem } from '@/types/rakuten';
import type { PersonDisplayContext } from '@/lib/product-display-score';
import {
  MAX_ITEMS_PER_BLOCK,
  isRakutenLink,
  personItemExcludeReason,
  selectGeneralItems,
  selectPersonItems,
  type GeneralItemData,
} from '../oshi-shopping/core';
import type { GeneralItemEntry } from '../oshi-shopping/general-items';

const ctx: PersonDisplayContext = { name: '梅澤美波', groupName: '乃木坂46', aliases: [], generation: '3期生' };

let seq = 0;
function item(category: ProductCategory, title: string, price: number, extra: Partial<RakutenItem> = {}): RakutenItem {
  seq++;
  const id = extra.id ?? `${category === 'CD' ? 'cd' : category === 'Blu-ray・DVD' ? 'dv' : category === 'グッズ' ? 'ich' : 'bk'}-${seq}`;
  return {
    id,
    title,
    price,
    reviewCount: 0,
    reviewAverage: 0,
    imageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg',
    itemUrl: `https://books.rakuten.co.jp/rb/${seq}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F${seq}%2F`,
    category,
    relevanceScore: 0,
    ...extra,
  };
}

function input(items: RakutenItem[], verdict: (p: RakutenItem) => string = () => 'related') {
  const storedData: Partial<Record<ProductCategory, { products: RakutenItem[] }>> = {};
  for (const p of items) (storedData[p.category] ??= { products: [] }).products.push(p);
  return { storedData, verdicts: Object.fromEntries(items.map((p) => [p.id, { verdict: verdict(p) }])) };
}

describe('selectPersonItems', () => {
  test('verdict=related 以外は出さない（人物ページと同じ公開条件）', () => {
    const a = item('写真集', '梅澤美波 1st写真集 透明な覚悟', 2000);
    const b = item('写真集', '梅澤美波 2nd写真集', 2200);
    const r = selectPersonItems(input([a, b], (p) => (p === a ? 'related' : 'unrelated')), ctx, 'gift', 'any');
    expect(r.items.map((x) => x.product.id)).toEqual([a.id]);
  });

  test('中古・まとめ買い・公式を名乗る商品名・手作り品・楽天以外のリンクは出さない', () => {
    const ok = item('グッズ', '乃木坂46 梅澤美波 アクリルスタンド', 1500, { shopName: 'あるショップ' });
    const used = item('グッズ', '【中古】梅澤美波 アクリルスタンド', 800, { shopName: 'あるショップ' });
    const official = item('グッズ', '乃木坂46 公式グッズ 梅澤美波 アクリルスタンド', 1600, { shopName: 'あるショップ' });
    const fan = item('グッズ', '梅澤美波 手作り うちわ文字 アクリルスタンド', 1200, { shopName: 'あるショップ' });
    const bulk = item('グッズ', '【10枚セット】梅澤美波 アクリルスタンド', 1300, { shopName: 'あるショップ' });
    const other = item('グッズ', '梅澤美波 アクリルスタンド', 1400, { affiliateUrl: 'https://example.com/a', itemUrl: 'https://example.com/a', shopName: 'あるショップ' });
    const r = selectPersonItems(input([ok, used, official, fan, bulk, other]), ctx, 'display', 'any');
    expect(r.items.map((x) => x.product.id)).toEqual([ok.id]);
    expect(r.eligibleCount).toBe(1);
  });

  test('用途に合うセクション・商品名の商品だけ（ライブ：ライブ映像とライブ用グッズ）', () => {
    const live = item('Blu-ray・DVD', '乃木坂46 真夏の全国ツアー2025 LIVE Blu-ray', 6000);
    const mv = item('Blu-ray・DVD', '乃木坂46 ALL MV COLLECTION', 5000);
    const cd = item('CD', '乃木坂46 シングル', 1500);
    const towel = item('グッズ', '乃木坂46 梅澤美波 推しメンタオル', 2500, { shopName: 'あるショップ' });
    const r = selectPersonItems(input([live, mv, cd, towel]), ctx, 'live', 'any');
    expect(r.items.map((x) => x.product.id).sort()).toEqual([live.id, towel.id].sort());
  });

  test('予算を超える商品は返さず件数だけ数える（予算内の商品と混ぜない）', () => {
    const cheap = item('CD', '乃木坂46 シングル 通常盤', 1200);
    const pricey = item('Blu-ray・DVD', '乃木坂46 LIVE Blu-ray 完全生産限定盤', 9800);
    const r = selectPersonItems(input([cheap, pricey]), ctx, 'gift', '3000');
    expect(r.items.map((x) => x.product.id)).toEqual([cheap.id]);
    expect(r.matchedCount).toBe(1);
    expect(r.overBudgetCount).toBe(1);
  });

  test('条件に合う商品が無いときは0件（条件外の商品で埋めない）', () => {
    const pricey = item('写真集', '梅澤美波 写真集', 2500);
    const r = selectPersonItems(input([pricey]), ctx, 'gift', '1000');
    expect(r.items).toEqual([]);
    expect(r.overBudgetCount).toBe(1);
    expect(r.hasData).toBe(true);
  });

  test('最大4件・同じセクションは最大2件・本人名入りを優先し、ラベルを付ける', () => {
    const items = [
      item('CD', '乃木坂46 シングルA', 1500),
      item('CD', '乃木坂46 シングルB', 1500),
      item('CD', '乃木坂46 シングルC', 1500),
      item('写真集', '梅澤美波 1st写真集', 2000),
      item('写真集', '乃木坂46 3期生 写真集', 2000),
      item('写真集', '乃木坂46 写真集', 2000),
      item('Blu-ray・DVD', '乃木坂46 LIVE', 5000),
    ];
    const r = selectPersonItems(input(items), ctx, 'gift', 'any');
    expect(r.items).toHaveLength(MAX_ITEMS_PER_BLOCK);
    const bySection = r.items.reduce<Record<string, number>>((m, x) => ({ ...m, [x.section]: (m[x.section] ?? 0) + 1 }), {});
    expect(Math.max(...Object.values(bySection))).toBeLessThanOrEqual(2);
    const photobooks = r.items.filter((x) => x.section === '写真集・書籍');
    expect(photobooks[0].label).toBe('本人名入り');
    expect(photobooks[1].label).toBe('期別の作品');
    expect(r.items.find((x) => x.section === 'CD')?.label).toBe('グループの作品');
    // 楽天ブックスの商品は販売元が楽天ブックス
    expect(r.items.find((x) => x.section === 'CD')?.seller).toEqual({ kind: 'books' });
  });

  test('「公式」というラベルは付けない', () => {
    const r = selectPersonItems(input([item('写真集', '梅澤美波 写真集', 2000)]), ctx, 'gift', 'any');
    expect(JSON.stringify(r.items.map((x) => x.label))).not.toContain('公式');
  });

  test('商品データが無い人物は hasData=false', () => {
    const r = selectPersonItems({ storedData: {}, verdicts: {} }, ctx, 'collection', 'any');
    expect(r).toMatchObject({ hasData: false, eligibleCount: 0, items: [] });
  });
});

describe('personItemExcludeReason', () => {
  test('分類できない商品（その他）は出さない', () => {
    expect(personItemExcludeReason(item('グッズ', '梅澤美波', 1000, { shopName: 's' }), 'その他')).toBe('unclassified');
  });
});

describe('isRakutenLink', () => {
  test('楽天のドメインだけを許可する', () => {
    expect(isRakutenLink('https://hb.afl.rakuten.co.jp/hgc/x/')).toBe(true);
    expect(isRakutenLink('https://a.r10.to/abc')).toBe(true);
    expect(isRakutenLink('https://item.rakuten.co.jp/shop/1/')).toBe(true);
    expect(isRakutenLink('https://rakuten.co.jp.example.com/')).toBe(false);
    expect(isRakutenLink('https://www.amazon.co.jp/')).toBe(false);
    expect(isRakutenLink('')).toBe(false);
  });
});

describe('selectGeneralItems', () => {
  const entries: GeneralItemEntry[] = [
    { itemCode: 'a:1', use: 'live', label: '双眼鏡' },
    { itemCode: 'b:2', use: 'live', label: 'バッグ' },
    { itemCode: 'c:3', use: 'live', label: 'ポーチ' },
    { itemCode: 'd:4', use: 'gift', label: 'ラッピング' },
    { itemCode: 'e:5', use: 'live', label: '販売終了' },
  ];
  const data = (itemCode: string, price: number, reviewCount: number): GeneralItemData => ({
    itemCode, itemName: `商品 ${itemCode}`, price, imageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg',
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/', shopName: 's', reviewCount, fetchedAt: 0,
  });
  const fetched = new Map<string, GeneralItemData | null>([
    ['a:1', data('a:1', 2680, 7000)],
    ['b:2', data('b:2', 1790, 1400)],
    ['c:3', data('c:3', 9800, 3)],
    ['d:4', data('d:4', 495, 47)],
    ['e:5', null],
  ]);

  test('用途に合う・取得できた・予算以内の商品だけを、レビュー件数の多い順に返す', () => {
    const r = selectGeneralItems(entries, fetched, 'live', '3000');
    expect(r.items.map((g) => g.entry.itemCode)).toEqual(['a:1', 'b:2']);
    expect(r.overBudgetCount).toBe(1);
    expect(r.unavailableCount).toBe(1);
  });

  test('楽天以外のリンクの商品は出さない', () => {
    const f = new Map(fetched);
    f.set('a:1', { ...data('a:1', 2680, 7000), affiliateUrl: 'https://example.com/' });
    const r = selectGeneralItems(entries, f, 'live', 'any');
    expect(r.items.map((g) => g.entry.itemCode)).not.toContain('a:1');
  });

  test('条件に合う商品が無ければ0件', () => {
    expect(selectGeneralItems(entries, fetched, 'gift', '1000').items.map((g) => g.entry.itemCode)).toEqual(['d:4']);
    expect(selectGeneralItems(entries, fetched, 'display', 'any').items).toEqual([]);
  });
});

describe('判定が不確かな商品・価格の確認待ち・販売終了の確認済みは出さない（Task 132）', () => {
  const shopAff = (shop: string, code: string) => `https://hb.afl.rakuten.co.jp/hgc/abc/?pc=${encodeURIComponent(`https://item.rakuten.co.jp/${shop}/${code}/`)}`;

  test('同じ人物で同じ商品IDが別の商品（グッズと中古）に付いている旧IDの重複は、判定がどちらのものか分からないため出さない', () => {
    const goods = item('グッズ', '乃木坂46 梅澤美波 アクリルスタンド', 1500, { id: 'ic-sharedshopid000000000000', itemUrl: shopAff('shop1', 'a1'), affiliateUrl: shopAff('shop1', 'a1'), shopName: 'shop1' });
    const used = item('中古', '【中古】梅澤美波 生写真', 300, { id: 'ic-sharedshopid000000000000', itemUrl: shopAff('shop1', 'b2'), affiliateUrl: shopAff('shop1', 'b2'), shopName: 'shop1' });
    const ok = item('グッズ', '乃木坂46 梅澤美波 ポスター', 1200, { id: 'ich-shop2:c3', itemUrl: shopAff('shop2', 'c3'), affiliateUrl: shopAff('shop2', 'c3'), shopName: 'shop2' });
    const r = selectPersonItems(input([goods, used, ok]), ctx, 'display', 'any');
    expect(r.items.map((x) => x.product.id)).toEqual([ok.id]);
    expect(r.excluded).toMatchObject({ ambiguousId: 1 });
  });

  test('同じ商品（同じ商品ページ）が複数のカテゴリに保存されているだけなら出す', () => {
    const a = item('写真集', '梅澤美波 1st写真集 透明な覚悟', 2000, { id: 'bk-777', itemUrl: 'https://books.rakuten.co.jp/rb/777/', affiliateUrl: '' });
    const b = { ...a, category: '本・雑誌' as ProductCategory };
    const storedData = { '写真集': { products: [a] }, '本・雑誌': { products: [b] } };
    const r = selectPersonItems({ storedData, verdicts: { 'bk-777': { verdict: 'related' } } }, ctx, 'gift', 'any');
    expect(r.items.map((x) => x.product.id)).toEqual(['bk-777']);
    expect(r.excluded).toMatchObject({ ambiguousId: 0 });
  });

  test('価格の確認待ちの商品・販売終了を確認した商品は出さない（判定・商品データは変えない）', () => {
    const a = item('写真集', '梅澤美波 1st写真集', 2000);
    const b = item('写真集', '梅澤美波 2nd写真集', 2200);
    const c = item('写真集', '梅澤美波 3rd写真集', 2400);
    const r = selectPersonItems({ ...input([a, b, c]), priceReviewIds: new Set([a.id]), unavailableIds: new Set([b.id]) }, ctx, 'gift', 'any');
    expect(r.items.map((x) => x.product.id)).toEqual([c.id]);
    expect(r.excluded).toEqual({ ambiguousId: 0, priceReview: 1, unavailable: 1 });
  });

  test('価格は取得から30日以内のものだけ表示する（取得日時が分からない・古い価格は「価格は楽天で確認」）。予算は保存中の価格で判定する', () => {
    const NOW = Date.UTC(2026, 9, 22);
    const unknown = item('写真集', '梅澤美波 写真集A', 1000);
    const fresh = item('CD', '梅澤美波 ソロ曲 CD', 1100, { priceFetchedAt: NOW - 2 * 86400000 });
    const old = item('Blu-ray・DVD', '梅澤美波 出演 Blu-ray', 1200, { priceFetchedAt: NOW - 40 * 86400000 });
    const r = selectPersonItems(input([unknown, fresh, old]), ctx, 'gift', 'any', NOW);
    const byId = Object.fromEntries(r.items.map((x) => [x.product.id, x.product]));
    expect(byId[unknown.id]).toMatchObject({ priceStale: true, priceDateLabel: undefined });
    expect(byId[fresh.id]).toMatchObject({ priceStale: false, priceDateLabel: '10/20時点' });
    expect(byId[old.id]).toMatchObject({ priceStale: true, priceDateLabel: '2026/9/12' });
    expect(byId[unknown.id].price).toBe(1000); // 保存中の価格（予算の判定に使う）は変えない
  });
});
