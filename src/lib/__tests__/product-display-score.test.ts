import { describe, test, expect } from 'vitest';
import {
  isUsedByTitle,
  calcDisplayTier,
  calcDisplayScore,
  sortProductsByPerson,
  type PersonDisplayContext,
} from '../product-display-score';
import type { RakutenItem } from '@/types/rakuten';

// ── テスト用ヘルパー ────────────────────────────────────────────────────────
function makeProduct(overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    id: overrides.id ?? 'p1',
    title: overrides.title ?? 'テスト商品',
    price: overrides.price ?? 1000,
    itemUrl: overrides.itemUrl ?? 'https://example.com',
    affiliateUrl: overrides.affiliateUrl ?? 'https://example.com',
    imageUrl: overrides.imageUrl ?? 'https://example.com/img.jpg',
    shopName: overrides.shopName ?? 'テストショップ',
    reviewCount: overrides.reviewCount ?? 0,
    reviewAverage: overrides.reviewAverage ?? 0,
    relevanceScore: overrides.relevanceScore ?? 0,
    category: overrides.category ?? 'グッズ',
    isUsed: overrides.isUsed ?? false,
    description: overrides.description ?? '',
    catchcopy: overrides.catchcopy ?? '',
  };
}

const CTX: PersonDisplayContext = {
  name: '賀喜遥香',
  groupName: '乃木坂46',
  aliases: [],
  generation: '4期生',
};

// ─── isUsedByTitle ─────────────────────────────────────────────────────────
describe('isUsedByTitle', () => {
  test('「中古」を含むタイトルは true', () => {
    expect(isUsedByTitle('中古 賀喜遥香 写真集')).toBe(true);
    expect(isUsedByTitle('【中古】賀喜遥香')).toBe(true);
    expect(isUsedByTitle('中古DVD')).toBe(true);
    expect(isUsedByTitle('中古Blu-ray')).toBe(true);
    expect(isUsedByTitle('中古本')).toBe(true);
    expect(isUsedByTitle('中古雑誌')).toBe(true);
  });

  test('USED（大文字・小文字）を含むタイトルは true', () => {
    expect(isUsedByTitle('USED 乃木坂46 写真集')).toBe(true);
    expect(isUsedByTitle('used CD')).toBe(true);
  });

  test('「古本」「中古品」を含むタイトルは true', () => {
    expect(isUsedByTitle('古本 賀喜遥香')).toBe(true);
    expect(isUsedByTitle('中古品 乃木坂46')).toBe(true);
  });

  test('傷・汚れ系キーワードを含むタイトルは true', () => {
    expect(isUsedByTitle('目立った傷や汚れあり')).toBe(true);
    expect(isUsedByTitle('やや傷や汚れあり')).toBe(true);
    expect(isUsedByTitle('傷や汚れあり')).toBe(true);
  });

  test('中古キーワードを含まないタイトルは false', () => {
    expect(isUsedByTitle('賀喜遥香 写真集')).toBe(false);
    expect(isUsedByTitle('乃木坂46 Blu-ray')).toBe(false);
    expect(isUsedByTitle('CD シングル')).toBe(false);
  });

  test('空文字は false', () => {
    expect(isUsedByTitle('')).toBe(false);
  });
});

// ─── calcDisplayTier ───────────────────────────────────────────────────────
describe('calcDisplayTier', () => {
  test('人物名入り新品は tier 0', () => {
    const p = makeProduct({ title: '賀喜遥香 写真集' });
    expect(calcDisplayTier(p, CTX)).toBe(0);
  });

  test('期別入り（人物名なし）新品は tier 1', () => {
    const p = makeProduct({ title: '乃木坂46 4期生 写真集' });
    expect(calcDisplayTier(p, CTX)).toBe(1);
  });

  test('グループ名入り（人物名・期別なし）新品は tier 2', () => {
    const p = makeProduct({ title: '乃木坂46 Blu-ray BOX' });
    expect(calcDisplayTier(p, CTX)).toBe(2);
  });

  test('人物名入り中古は tier 3', () => {
    const p = makeProduct({ title: '中古 賀喜遥香 写真集' });
    expect(calcDisplayTier(p, CTX)).toBe(3);
  });

  test('期別入り中古（人物名なし）は tier 4', () => {
    const p = makeProduct({ title: '中古 4期生 写真集' });
    expect(calcDisplayTier(p, CTX)).toBe(4);
  });

  test('グループ名入り中古（人物名・期別なし）は tier 5', () => {
    const p = makeProduct({ title: '中古 乃木坂46 DVD' });
    expect(calcDisplayTier(p, CTX)).toBe(5);
  });

  test('その他中古は tier 6', () => {
    const p = makeProduct({ title: '中古 アイドル写真集' });
    expect(calcDisplayTier(p, CTX)).toBe(6);
  });

  test('isUsed フラグが true の商品は中古ティア', () => {
    const p = makeProduct({ title: '賀喜遥香 写真集', isUsed: true });
    expect(calcDisplayTier(p, CTX)).toBe(3); // 人物名あり中古
  });

  test('まとめ売り・ランダム・福袋は tier 6', () => {
    const p1 = makeProduct({ title: '乃木坂46 まとめ売り 写真集' });
    const p2 = makeProduct({ title: '乃木坂46 ランダム グッズ' });
    const p3 = makeProduct({ title: '乃木坂46 福袋 2024' });
    expect(calcDisplayTier(p1, CTX)).toBe(6);
    expect(calcDisplayTier(p2, CTX)).toBe(6);
    expect(calcDisplayTier(p3, CTX)).toBe(6);
  });

  test('その他（グループ名もない）新品は tier 7', () => {
    const p = makeProduct({ title: 'アイドル CD シングル' });
    expect(calcDisplayTier(p, CTX)).toBe(7);
  });

  test('中古ティアは常に新品ティアより高い数値（下位）', () => {
    const newWithName = makeProduct({ title: '賀喜遥香 写真集' });
    const usedWithName = makeProduct({ title: '中古 賀喜遥香 写真集' });
    const newWithGroup = makeProduct({ title: '乃木坂46 Blu-ray' });
    const usedRandom   = makeProduct({ title: '中古 CD' });
    expect(calcDisplayTier(usedWithName, CTX)).toBeGreaterThan(calcDisplayTier(newWithName, CTX));
    expect(calcDisplayTier(usedRandom, CTX)).toBeGreaterThan(calcDisplayTier(newWithGroup, CTX));
  });
});

// ─── calcDisplayScore ──────────────────────────────────────────────────────
describe('calcDisplayScore', () => {
  test('中古商品のスコアは同条件の新品より低い', () => {
    const newP  = makeProduct({ title: '賀喜遥香 写真集' });
    const usedP = makeProduct({ title: '中古 賀喜遥香 写真集' });
    expect(calcDisplayScore(usedP, CTX)).toBeLessThan(calcDisplayScore(newP, CTX));
  });

  test('新品のスコアは常に 0 以上', () => {
    const p = makeProduct({ title: '賀喜遥香 カレンダー' });
    expect(calcDisplayScore(p, CTX)).toBeGreaterThan(0);
  });

  test('中古のスコアは負数', () => {
    const p = makeProduct({ title: '中古 賀喜遥香 写真集' });
    expect(calcDisplayScore(p, CTX)).toBeLessThan(0);
  });

  test('人物名 + 写真集は高スコア', () => {
    const p1 = makeProduct({ title: '賀喜遥香 写真集' });
    const p2 = makeProduct({ title: '乃木坂46 グッズ' });
    expect(calcDisplayScore(p1, CTX)).toBeGreaterThan(calcDisplayScore(p2, CTX));
  });

  test('グループ名だけの商品よりも人物名入り商品が高スコア', () => {
    const withName  = makeProduct({ title: '賀喜遥香 写真集' });
    const groupOnly = makeProduct({ title: '乃木坂46 Blu-ray BOX' });
    expect(calcDisplayScore(withName, CTX)).toBeGreaterThan(calcDisplayScore(groupOnly, CTX));
  });
});

// ─── sortProductsByPerson ──────────────────────────────────────────────────
describe('sortProductsByPerson', () => {
  test('新品が中古より前に来る', () => {
    const usedFirst = makeProduct({ id: 'u1', title: '中古 賀喜遥香 写真集' });
    const newSecond = makeProduct({ id: 'n1', title: '賀喜遥香 写真集' });
    const result = sortProductsByPerson([usedFirst, newSecond], CTX);
    expect(result[0].id).toBe('n1');
    expect(result[1].id).toBe('u1');
  });

  test('全商品が中古の場合は順序変更なし（相対順維持）', () => {
    const u1 = makeProduct({ id: 'u1', title: '中古 賀喜遥香 写真集' });
    const u2 = makeProduct({ id: 'u2', title: '中古 乃木坂46 DVD' });
    const result = sortProductsByPerson([u1, u2], CTX);
    // どちらも中古なので相対順は維持される（tier 3 vs tier 5 なので u1 が先）
    expect(result[0].id).toBe('u1');
    expect(result[1].id).toBe('u2');
  });

  test('全商品が新品の場合は人物名入りが先頭', () => {
    const g1 = makeProduct({ id: 'g1', title: '乃木坂46 グッズ' });
    const g2 = makeProduct({ id: 'g2', title: '賀喜遥香 写真集' });
    const result = sortProductsByPerson([g1, g2], CTX);
    expect(result[0].id).toBe('g2'); // 人物名入りが先
  });

  test('新品のみ・中古のみの場合に元の件数が変わらない', () => {
    const products = [
      makeProduct({ id: 'n1', title: '賀喜遥香 写真集' }),
      makeProduct({ id: 'u1', title: '中古 賀喜遥香 写真集' }),
      makeProduct({ id: 'n2', title: '乃木坂46 Blu-ray' }),
      makeProduct({ id: 'u2', title: '中古 乃木坂46 DVD' }),
    ];
    const result = sortProductsByPerson(products, CTX);
    expect(result.length).toBe(4);
  });

  test('空配列は空配列を返す', () => {
    expect(sortProductsByPerson([], CTX)).toEqual([]);
  });

  test('isUsed フラグによる中古判定', () => {
    const usedByFlag = makeProduct({ id: 'uf', title: '賀喜遥香 写真集', isUsed: true });
    const newProduct = makeProduct({ id: 'np', title: '乃木坂46 グッズ' });
    const result = sortProductsByPerson([usedByFlag, newProduct], CTX);
    // isUsed=true の商品は tier 3、新品グループは tier 2 → 新品が先
    expect(result[0].id).toBe('np');
    expect(result[1].id).toBe('uf');
  });
});

// ─── ProductTabList のおすすめ順ロジック（純粋関数として検証）────────────────
// ProductWithSection と同等の構造で stable sort を直接テスト
describe('おすすめ順: 新品→中古の安定ソート', () => {
  interface Item { id: string; isUsed: boolean; originalIndex: number }

  function stableUsedSort(items: Item[]): Item[] {
    return [...items].sort((a, b) => (a.isUsed ? 1 : 0) - (b.isUsed ? 1 : 0));
  }

  test('中古が新品の後に来る', () => {
    const items: Item[] = [
      { id: 'new-photo', isUsed: false, originalIndex: 0 },
      { id: 'used-photo', isUsed: true,  originalIndex: 1 },
      { id: 'new-cd',    isUsed: false, originalIndex: 2 },
      { id: 'used-cd',   isUsed: true,  originalIndex: 3 },
    ];
    const result = stableUsedSort(items);
    const newItems  = result.filter((i) => !i.isUsed);
    const usedItems = result.filter((i) => i.isUsed);
    expect(newItems.map((i) => i.id)).toEqual(['new-photo', 'new-cd']);
    expect(usedItems.map((i) => i.id)).toEqual(['used-photo', 'used-cd']);
  });

  test('各グループ内の相対順序が維持される（安定ソート）', () => {
    const items: Item[] = [
      { id: 'new-1', isUsed: false, originalIndex: 0 },
      { id: 'used-1', isUsed: true,  originalIndex: 1 },
      { id: 'new-2', isUsed: false, originalIndex: 2 },
      { id: 'used-2', isUsed: true,  originalIndex: 3 },
      { id: 'new-3', isUsed: false, originalIndex: 4 },
      { id: 'used-3', isUsed: true,  originalIndex: 5 },
    ];
    const result = stableUsedSort(items);
    const newIds  = result.filter((i) => !i.isUsed).map((i) => i.id);
    const usedIds = result.filter((i) => i.isUsed).map((i) => i.id);
    expect(newIds).toEqual(['new-1', 'new-2', 'new-3']);
    expect(usedIds).toEqual(['used-1', 'used-2', 'used-3']);
  });

  test('全商品が中古の場合は順序変更なし', () => {
    const items: Item[] = [
      { id: 'used-1', isUsed: true, originalIndex: 0 },
      { id: 'used-2', isUsed: true, originalIndex: 1 },
      { id: 'used-3', isUsed: true, originalIndex: 2 },
    ];
    const result = stableUsedSort(items);
    expect(result.map((i) => i.id)).toEqual(['used-1', 'used-2', 'used-3']);
  });

  test('全商品が新品の場合は順序変更なし', () => {
    const items: Item[] = [
      { id: 'new-1', isUsed: false, originalIndex: 0 },
      { id: 'new-2', isUsed: false, originalIndex: 1 },
      { id: 'new-3', isUsed: false, originalIndex: 2 },
    ];
    const result = stableUsedSort(items);
    expect(result.map((i) => i.id)).toEqual(['new-1', 'new-2', 'new-3']);
  });

  test('空配列は空配列を返す', () => {
    expect(stableUsedSort([])).toEqual([]);
  });

  test('件数が変わらない', () => {
    const items: Item[] = [
      { id: 'n1', isUsed: false, originalIndex: 0 },
      { id: 'u1', isUsed: true,  originalIndex: 1 },
      { id: 'n2', isUsed: false, originalIndex: 2 },
    ];
    expect(stableUsedSort(items).length).toBe(3);
  });
});
