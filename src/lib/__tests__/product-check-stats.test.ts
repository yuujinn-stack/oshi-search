import { describe, it, expect } from 'vitest';
import { computePersonProductStats } from '@/lib/product-check-stats';
import type { StoredCategoryData } from '@/lib/product-store';
import type { JudgmentRecord } from '@/lib/judgment-store';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';

function makeItem(id: string): RakutenItem {
  return {
    id, title: `商品${id}`, price: 1000, reviewCount: 0, reviewAverage: 0,
    imageUrl: '', itemUrl: '', affiliateUrl: '', category: '写真集', relevanceScore: 50,
  };
}

function storedData(ids: string[]): Partial<Record<ProductCategory, StoredCategoryData>> {
  return { '写真集': { products: ids.map(makeItem), fetchedAt: Date.now() } };
}

function verdict(v: JudgmentRecord['verdict'], source: JudgmentRecord['source'] = 'ai'): JudgmentRecord {
  return { verdict: v, score: 80, source, timestamp: Date.now() };
}

describe('computePersonProductStats()', () => {
  it('商品0件: 全項目0', () => {
    const s = computePersonProductStats({}, {});
    expect(s).toEqual({ total: 0, activeTotal: 0, deleted: 0, related: 0, uncertain: 0, unrelated: 0, unclassified: 0 });
  });

  it('全件未判定: totalとunclassifiedが一致する', () => {
    const s = computePersonProductStats(storedData(['a', 'b', 'c']), {});
    expect(s.total).toBe(3);
    expect(s.activeTotal).toBe(3);
    expect(s.unclassified).toBe(3);
  });

  it('related/uncertain/unrelatedが混在する場合: activeTotal = 内訳合計', () => {
    const data = storedData(['a', 'b', 'c', 'd']);
    const verdicts = {
      a: verdict('related'),
      b: verdict('uncertain'),
      c: verdict('unrelated'),
    };
    const s = computePersonProductStats(data, verdicts);
    expect(s.total).toBe(4);
    expect(s.activeTotal).toBe(4);
    expect(s.related).toBe(1);
    expect(s.uncertain).toBe(1);
    expect(s.unrelated).toBe(1);
    expect(s.unclassified).toBe(1); // d が未判定
    expect(s.activeTotal).toBe(s.related + s.uncertain + s.unrelated + s.unclassified);
  });

  it('deletedがある人物: totalには残るがrelated/uncertain/unrelated/unclassifiedのどれにも入らず、activeTotalから除かれる', () => {
    // 削除済み商品は products.items からは物理削除されない（非破壊マージのため）
    const data = storedData(['a', 'b', 'c']);
    const verdicts = {
      a: verdict('related'),
      b: verdict('deleted', 'manual'),
    };
    const s = computePersonProductStats(data, verdicts);
    expect(s.total).toBe(3);        // 削除済みもproducts.itemsには残っている
    expect(s.deleted).toBe(1);
    expect(s.activeTotal).toBe(2);  // total - deleted
    expect(s.related).toBe(1);
    expect(s.unclassified).toBe(1); // c のみ
    // 不変条件: activeTotal は必ず内訳4項目の合計と一致する
    expect(s.activeTotal).toBe(s.related + s.uncertain + s.unrelated + s.unclassified);
  });

  it('全件deleted: activeTotal=0、内訳もすべて0', () => {
    const data = storedData(['a', 'b']);
    const verdicts = { a: verdict('deleted', 'manual'), b: verdict('deleted', 'manual') };
    const s = computePersonProductStats(data, verdicts);
    expect(s.total).toBe(2);
    expect(s.deleted).toBe(2);
    expect(s.activeTotal).toBe(0);
    expect(s.unclassified).toBe(0);
    expect(s.activeTotal).toBe(s.related + s.uncertain + s.unrelated + s.unclassified);
  });

  it('manual verdictの商品も通常どおり内訳に反映される', () => {
    const data = storedData(['a']);
    const verdicts = { a: verdict('related', 'manual') };
    const s = computePersonProductStats(data, verdicts);
    expect(s.related).toBe(1);
    expect(s.unclassified).toBe(0);
  });

  it('1件のAI判定成功で未判定が1件減り、relatedが1件増える（保存前後の差分）', () => {
    // saveVerdict('ai', 'related', ...) が1件書き込まれた前後を比較する。
    // 実際のsaveVerdictはverdictsテーブルへの単純なupsertであり、ここではその結果として
    // getAllVerdicts()が返すマップに1行増えた状態を模している。
    const data = storedData(['a', 'b', 'c']);
    const before = computePersonProductStats(data, {});
    const after = computePersonProductStats(data, { a: verdict('related') });

    expect(before.unclassified).toBe(3);
    expect(before.related).toBe(0);
    expect(after.unclassified).toBe(2);
    expect(after.related).toBe(1);
    expect(after.unclassified).toBe(before.unclassified - 1);
    expect(after.related).toBe(before.related + 1);
    // 総数(activeTotal)自体は変化しない
    expect(after.activeTotal).toBe(before.activeTotal);
  });

  // 本番DBに残存する旧verdict値（'relevant'|'maybe'、2026-06-10のAI判定システム移行前の
  // 名残、DB未更新）が、この集計関数の不変条件を壊さないことを再確認する。
  // このテストではDBの値そのものは一切変更していない（読み取り専用のロジック検証のみ）。
  describe('旧verdict値(relevant/maybe)が混入していても集計が破綻しない', () => {
    it('未知のverdict値はどのバケットにも入らないが、unclassifiedへ吸収されnegativeにならない', () => {
      const data = storedData(['a', 'b', 'c']);
      const verdicts = {
        a: { verdict: 'relevant' as never, score: 80, source: 'auto' as const, timestamp: Date.now() },
        b: { verdict: 'maybe' as never, score: 50, source: 'ai' as const, timestamp: Date.now() },
      };
      const s = computePersonProductStats(data, verdicts);
      expect(s.related).toBe(0);
      expect(s.uncertain).toBe(0);
      expect(s.unrelated).toBe(0);
      expect(s.deleted).toBe(0);
      expect(s.unclassified).toBeGreaterThanOrEqual(0);
      expect(s.unclassified).toBe(3); // a, b, c いずれもrelated/uncertain/unrelated/deletedに一致せず未判定扱い
    });

    it('旧verdict値が混在していてもactiveTotal不変条件は成立する', () => {
      const data = storedData(['a', 'b', 'c', 'd']);
      const verdicts = {
        a: { verdict: 'relevant' as never, score: 80, source: 'manual' as const, timestamp: Date.now() },
        b: verdict('related'),
        c: verdict('deleted', 'manual'),
      };
      const s = computePersonProductStats(data, verdicts);
      expect(s.activeTotal).toBe(s.related + s.uncertain + s.unrelated + s.unclassified);
      expect(s.unclassified).toBeGreaterThanOrEqual(0);
    });
  });

  it('複数カテゴリにまたがる商品を合算する', () => {
    const data: Partial<Record<ProductCategory, StoredCategoryData>> = {
      '写真集': { products: [makeItem('a')], fetchedAt: Date.now() },
      'CD': { products: [makeItem('b'), makeItem('c')], fetchedAt: Date.now() },
    };
    const s = computePersonProductStats(data, {});
    expect(s.total).toBe(3);
  });
});
