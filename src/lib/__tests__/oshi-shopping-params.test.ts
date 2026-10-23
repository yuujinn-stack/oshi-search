import { describe, test, expect } from 'vitest';
import {
  buildOshiShoppingResultPath,
  buildOshiShoppingStartPath,
  budgetMax,
  nextBudget,
  parseOshiShoppingParams,
} from '../oshi-shopping/params';
import { decodeGeneralItemsValue, parseGeneralItemEntries } from '../oshi-shopping/general-items';
import { toGeneralItemData } from '../oshi-shopping/rakuten-lookup';

describe('params', () => {
  test('結果URLの組み立てと読み取りが往復する（日本語・記号の人物名）', () => {
    const path = buildOshiShoppingResultPath('＝LOVE 野口衣織', 'live', '3000');
    const sp = Object.fromEntries(new URL(`https://x${path}`).searchParams);
    expect(parseOshiShoppingParams(sp)).toEqual({ person: '＝LOVE 野口衣織', use: 'live', budget: '3000' });
  });

  test('不正な値は null（推測で補わない）', () => {
    expect(parseOshiShoppingParams({ p: '目黒蓮', use: 'xxx', budget: '999' })).toEqual({ person: '目黒蓮', use: null, budget: null });
    expect(parseOshiShoppingParams({})).toEqual({ person: '', use: null, budget: null });
  });

  test('予算の上限と1段階上の予算', () => {
    expect(budgetMax('3000')).toBe(3000);
    expect(budgetMax('any')).toBe(Number.POSITIVE_INFINITY);
    expect(nextBudget('1000')).toBe('3000');
    expect(nextBudget('any')).toBeNull();
  });
});

describe('一般商品の選定リスト（環境変数の JSON）', () => {
  const valid = [
    { itemCode: 'sample-shop:10000001', use: 'live', label: 'コンサート向けの双眼鏡' },
    { itemCode: 'Sample-Shop2:abc-1', use: 'gift', label: 'ラッピング袋' },
  ];

  test('itemCode・用途・説明だけを読み、itemCode は小文字にそろえる', () => {
    expect(parseGeneralItemEntries(JSON.stringify(valid))).toEqual([
      { itemCode: 'sample-shop:10000001', use: 'live', label: 'コンサート向けの双眼鏡' },
      { itemCode: 'sample-shop2:abc-1', use: 'gift', label: 'ラッピング袋' },
    ]);
  });

  test('商品名・価格など余計な項目は持たない', () => {
    const [e] = parseGeneralItemEntries(JSON.stringify([{ ...valid[0], itemName: 'x', price: 100, imageUrl: 'y' }]));
    expect(Object.keys(e).sort()).toEqual(['itemCode', 'label', 'use']);
  });

  test('未設定・壊れたJSON・配列以外は空（準備中表示）', () => {
    expect(parseGeneralItemEntries(undefined)).toEqual([]);
    expect(parseGeneralItemEntries('')).toEqual([]);
    expect(parseGeneralItemEntries('{oops')).toEqual([]);
    expect(parseGeneralItemEntries('{"itemCode":"a:1"}')).toEqual([]);
  });

  test('不正な要素（形式違いの itemCode・未知の用途・重複・公式や本人を示す説明）は捨てる', () => {
    const r = parseGeneralItemEntries(JSON.stringify([
      valid[0],
      { ...valid[0] },
      { itemCode: 'no-colon', use: 'live', label: 'x' },
      { itemCode: 'a:1', use: 'unknown', label: 'x' },
      { itemCode: 'b:2', use: 'live', label: '公式ペンライト' },
      { itemCode: 'c:3', use: 'live', label: '本人着用' },
      { itemCode: 'd:4', use: 'live', label: '' },
      null,
    ]));
    expect(r.map((e) => e.itemCode)).toEqual(['sample-shop:10000001']);
  });
});

describe('toGeneralItemData', () => {
  const raw = {
    itemCode: 'sample-shop:10000001',
    itemName: '【雑誌掲載】推し活 双眼鏡 コンサート',
    itemPrice: 2680,
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fsample-shop%2Fx%2F',
    mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/sample-shop/a.jpg?_ex=128x128' }],
    shopName: 'サンプルショップ',
    reviewCount: 7273,
    availability: 1,
  };

  test('商品名は改変せず、アフィリエイトURLはAPIの値をそのまま使う', () => {
    const d = toGeneralItemData('sample-shop:10000001', raw, 123)!;
    expect(d.itemName).toBe(raw.itemName);
    expect(d.affiliateUrl).toBe(raw.affiliateUrl);
    expect(d.imageUrl).toBe('https://thumbnail.image.rakuten.co.jp/@0_mall/sample-shop/a.jpg?_ex=300x300');
    expect(d.fetchedAt).toBe(123);
  });

  test('itemCode 不一致・在庫なし・必須項目なしは null', () => {
    expect(toGeneralItemData('other:1', raw, 0)).toBeNull();
    expect(toGeneralItemData('sample-shop:10000001', { ...raw, availability: 0 }, 0)).toBeNull();
    expect(toGeneralItemData('sample-shop:10000001', { ...raw, affiliateUrl: '' }, 0)).toBeNull();
    expect(toGeneralItemData('sample-shop:10000001', { ...raw, itemPrice: 0 }, 0)).toBeNull();
    expect(toGeneralItemData('sample-shop:10000001', undefined, 0)).toBeNull();
  });
});

describe('一般商品の選定リスト（環境変数の値の形）', () => {
  const list = [
    { itemCode: 'sample-shop:10000001', use: 'live', label: 'ライブで使う双眼鏡' },
    { itemCode: 'sample-shop:10000002', use: 'display', label: '飾る棚' },
  ];
  const json = JSON.stringify(list);
  test('JSON のまま・前後の空白・値全体を囲む引用符（.env の書き方のまま貼った場合）を受け付ける', () => {
    for (const v of [json, `  ${json}\n`, `'${json}'`, `"${json}"`]) expect(parseGeneralItemEntries(v)).toHaveLength(2);
  });
  test('base64: 形式（Vercel の画面・シェルで引用符が崩れない形）を受け付ける', () => {
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    expect(parseGeneralItemEntries(`base64:${b64}`).map((e) => e.itemCode)).toEqual(['sample-shop:10000001', 'sample-shop:10000002']);
    expect(decodeGeneralItemsValue(`'base64:${b64}'`)).toBe(json);
  });
  test('壊れた base64・ファイルのパス・空は「準備中」（空配列）', () => {
    expect(parseGeneralItemEntries('base64:!!!')).toEqual([]);
    expect(parseGeneralItemEntries('tmp/oshi-shopping-general/general-items.json')).toEqual([]);
    expect(parseGeneralItemEntries('')).toEqual([]);
    expect(parseGeneralItemEntries(undefined)).toEqual([]);
  });
});

describe('人物を選択済みで始めるURL', () => {
  test('人物だけを渡す（用途・予算は利用者が選ぶ）', () => {
    expect(buildOshiShoppingStartPath('上白石萌歌')).toBe(`/oshi-shopping?p=${encodeURIComponent('上白石萌歌')}`);
    expect(parseOshiShoppingParams({ p: '上白石萌歌' })).toMatchObject({ person: '上白石萌歌', use: null, budget: null });
  });
});
