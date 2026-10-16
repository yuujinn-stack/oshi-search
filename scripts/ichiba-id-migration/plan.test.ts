import { describe, it, expect } from 'vitest';
import { applyPlanToRows, planMigration, type ProductRow, type VerdictRow } from './plan';
import { classifyOrphanVerdicts, recoveryConflict } from '@/lib/legacy-ichiba-verdict';

const HGC = 'ssss0000.tttt1111.ssss0000.uuuu2222';
const LEGACY = 'ic-' + HGC.slice(0, 24);
const aff = (shop: string, code: string) => `https://hb.afl.rakuten.co.jp/hgc/${HGC}/?pc=${encodeURIComponent(`https://item.rakuten.co.jp/${shop}/${code}/`)}`;
const item = (code: string, o: Record<string, unknown> = {}) => ({ id: LEGACY, title: `商品${code}`, itemUrl: aff('cocohouse', code), affiliateUrl: aff('cocohouse', code), ...o });
const v = (personName: string, productId: string, verdict = 'related', source = 'ai'): VerdictRow => ({ personName, productId, verdict, source, score: 80 });

describe('楽天市場の商品ID移行計画', () => {
  it('旧IDに対応する商品が1つだけなら、判定を新IDへ引き継ぐ', () => {
    const rows: ProductRow[] = [{ personName: 'A', category: 'グッズ', items: [item('x1')] }];
    const { items, summary, verdictInserts } = planMigration(rows, [v('A', LEGACY)]);
    expect(items[0]).toMatchObject({ newId: 'ich-cocohouse:x1', status: 'convertible', verdictPlan: 'carry', hiddenAfterMigration: false });
    expect(verdictInserts).toEqual([expect.objectContaining({ personName: 'A', productId: 'ich-cocohouse:x1', verdict: 'related', source: 'ai', fromProductId: LEGACY })]);
    expect(summary).toMatchObject({ convertible: 1, verdictCarry: 1, verdictRowsToInsert: 1, verdictReviewShared: 0 });
  });

  it('同じ人物で複数の商品が同じ旧IDを共有し判定が付いていたら、判定をコピーせず移行もしない（旧IDのまま・表示は現状維持）', () => {
    const rows: ProductRow[] = [
      { personName: 'A', category: 'グッズ', items: [item('x1')] },
      { personName: 'A', category: '中古', items: [item('x2', { title: '【中古】別商品' })] },
    ];
    const { items, summary, verdictInserts } = planMigration(rows, [v('A', LEGACY)]);
    expect(items.map((i) => [i.verdictPlan, i.status])).toEqual([['review_shared', 'deferred_shared'], ['review_shared', 'deferred_shared']]);
    expect(verdictInserts).toEqual([]);
    expect(summary).toMatchObject({ verdictReviewShared: 2, reviewSharedGroups: 1, deferredShared: 2, migrateItems: 0, hiddenAfterMigration: 0 });
  });

  it('共有グループでも判定が付いていなければ、引き継ぐものが無いので移行する', () => {
    const rows: ProductRow[] = [
      { personName: 'A', category: 'グッズ', items: [item('x1')] },
      { personName: 'A', category: '中古', items: [item('x2')] },
    ];
    const { summary } = planMigration(rows, []);
    expect(summary).toMatchObject({ migrateItems: 2, deferredShared: 0, noVerdict: 2 });
  });

  it('同じ商品が別カテゴリにもある（新IDも同じ）場合は帰属が一意なので引き継ぐ（判定行は1つ）', () => {
    const rows: ProductRow[] = [
      { personName: 'A', category: 'グッズ', items: [item('x1')] },
      { personName: 'A', category: '中古', items: [item('x1')] },
    ];
    const { summary, verdictInserts } = planMigration(rows, [v('A', LEGACY, 'unrelated', 'manual')]);
    expect(summary).toMatchObject({ verdictCarry: 2, verdictRowsToInsert: 1, newIdsSharedAcrossCategories: 1, hiddenAfterMigration: 0 });
    expect(verdictInserts[0]).toMatchObject({ verdict: 'unrelated', source: 'manual' });
  });

  it('人物が違えば別々に判定する（判定は人物単位）', () => {
    const rows: ProductRow[] = [
      { personName: 'A', category: 'グッズ', items: [item('x1')] },
      { personName: 'B', category: 'グッズ', items: [item('x2')] },
    ];
    const { summary } = planMigration(rows, [v('A', LEGACY), v('B', LEGACY, 'unrelated')]);
    expect(summary.verdictCarry).toBe(2);
  });

  it('URLから新IDを作れない商品は移行しない', () => {
    const rows: ProductRow[] = [{ personName: 'A', category: 'グッズ', items: [{ id: LEGACY, itemUrl: 'https://example.com/x', affiliateUrl: '' }] }];
    const { items, summary } = planMigration(rows, [v('A', LEGACY)]);
    expect(items[0]).toMatchObject({ status: 'unconvertible', newId: null, verdictPlan: 'none' });
    expect(summary.unconvertible).toBe(1);
  });

  it('新IDが既存の商品ID・既存の判定と衝突したら検出する', () => {
    const rows: ProductRow[] = [{ personName: 'A', category: 'グッズ', items: [item('x1'), { ...item('x1'), id: 'ich-cocohouse:x1' }] }];
    const r1 = planMigration(rows, [v('A', LEGACY)]);
    expect(r1.items[0].status).toBe('collision_existing_id');
    expect(r1.summary.collisionWithExistingId).toBe(1);
    const rows2: ProductRow[] = [{ personName: 'A', category: 'グッズ', items: [item('x1')] }];
    const r2 = planMigration(rows2, [v('A', LEGACY)], [v('A', 'ich-cocohouse:x1')]);
    expect(r2.items[0].verdictPlan).toBe('conflict_existing_new_verdict');
  });

  it('商品が存在しない旧IDの判定は移行しない（数えるだけ）', () => {
    const { summary } = planMigration([], [v('A', LEGACY)]);
    expect(summary.orphanLegacyVerdicts).toBe(1);
  });

  it('楽天ブックス・手動登録の商品は対象外', () => {
    const rows: ProductRow[] = [{ personName: 'A', category: 'CD', items: [{ id: 'cd-1', itemUrl: 'https://books.rakuten.co.jp/rb/1/' }, { id: 'mn-a', itemUrl: 'https://books.rakuten.co.jp/rb/2/' }] }];
    expect(planMigration(rows, []).summary.items).toBe(0);
  });

  it('移行後：引き継ぎ元の旧ID判定は「移行済み」、保留した商品の判定は孤立にならず、旧データの復旧はすべて止まる', () => {
    const OTHER_HGC = 'zzzz0000.yyyy1111.zzzz0000.xxxx2222';
    const LEGACY2 = 'ic-' + OTHER_HGC.slice(0, 24);
    const aff2 = (code: string) => `https://hb.afl.rakuten.co.jp/hgc/${OTHER_HGC}/?pc=${encodeURIComponent(`https://item.rakuten.co.jp/shop2/${code}/`)}`;
    const rows: ProductRow[] = [
      { personName: 'A', category: 'グッズ', items: [item('x1'), { id: LEGACY2, title: '共有G', itemUrl: aff2('g1'), affiliateUrl: aff2('g1') }] },
      { personName: 'A', category: '中古', items: [{ id: LEGACY2, title: '共有U', itemUrl: aff2('u1'), affiliateUrl: aff2('u1') }] },
    ];
    const verdicts = [v('A', LEGACY), v('A', LEGACY2)];
    const { items, verdictInserts } = planMigration(rows, verdicts);
    const after = applyPlanToRows(rows, items);
    const afterItems = after.flatMap((r) => r.items);
    const present = new Set(afterItems.map((i) => i.id));
    const orphans = verdicts.filter((x) => !present.has(x.productId));
    const newVerdicts = new Map(verdictInserts.map(({ fromProductId: _f, ...x }) => [x.productId, x]));
    const kinds = classifyOrphanVerdicts(orphans, afterItems, newVerdicts);
    expect([...kinds]).toEqual([[LEGACY, 'migrated']]); // 共有（保留）の LEGACY2 は商品が残るので孤立しない
    // 移行前の商品（Redis に残る旧データ相当）を移行後のDBへ復旧しようとしても、すべて追加されない
    for (const it of rows.flatMap((r) => r.items)) expect(recoveryConflict(it, afterItems)).not.toBeNull();
  });
});
