import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import {
  classifyOrphanVerdicts,
  legacyIchibaIdFromItemUrl,
  recoveryConflict,
  type VerdictLike,
} from '../legacy-ichiba-verdict';

const HGC = 'ssss0000.tttt1111.ssss0000.uuuu2222'; // 店舗単位の識別部分（架空）
const LEGACY = 'ic-' + HGC.slice(0, 24);
const aff = (shop: string, code: string) => `https://hb.afl.rakuten.co.jp/hgc/${HGC}/?pc=${encodeURIComponent(`https://item.rakuten.co.jp/${shop}/${code}/`)}`;
const v = (productId: string, o: Partial<VerdictLike> = {}): VerdictLike => ({ productId, verdict: 'related', source: 'ai', score: 80, reason: 'r', ...o });

describe('旧ID（ic-）の再計算', () => {
  it('アフィリエイトURLの識別部分の先頭24文字（stableId と同じ規則）', () => {
    expect(legacyIchibaIdFromItemUrl(aff('shop1', 'a'))).toBe(LEGACY);
    expect(legacyIchibaIdFromItemUrl(aff('shop1', 'b'))).toBe(LEGACY); // 同じ店舗の別商品は同じ旧ID
    expect(legacyIchibaIdFromItemUrl('https://item.rakuten.co.jp/shop1/abcdef/')).toBe('ic-abcdef');
  });
});

describe('孤立判定の分類（移行後に残る旧IDの判定）', () => {
  const migratedItem = { id: 'ich-shop1:a', itemUrl: aff('shop1', 'a') };

  it('新ID商品に同じ内容の判定が引き継がれていれば「移行済み」（孤立ではない）', () => {
    const r = classifyOrphanVerdicts([v(LEGACY)], [migratedItem], new Map([['ich-shop1:a', v('ich-shop1:a')]]));
    expect(r.get(LEGACY)).toBe('migrated');
  });

  it('旧IDに対応する新ID商品はあるが判定が引き継がれていない／内容が違う → 要確認（同じ店舗の別商品の可能性）', () => {
    expect(classifyOrphanVerdicts([v(LEGACY)], [migratedItem], new Map()).get(LEGACY)).toBe('same_shop_new_id');
    expect(classifyOrphanVerdicts([v(LEGACY)], [migratedItem], new Map([['ich-shop1:a', v('ich-shop1:a', { verdict: 'unrelated' })]])).get(LEGACY)).toBe('same_shop_new_id');
  });

  it('対応する新ID商品が無い旧ID判定・楽天ブックス等の判定は、従来どおり孤立', () => {
    const r = classifyOrphanVerdicts([v(LEGACY), v('bk-1')], [{ id: 'bk-2', itemUrl: 'https://books.rakuten.co.jp/rb/2/' }], new Map());
    expect(r.get(LEGACY)).toBe('orphan');
    expect(r.get('bk-1')).toBe('orphan');
  });
});

describe('復旧候補の二重登録チェック', () => {
  const migrated = [{ id: 'ich-shop1:a', itemUrl: aff('shop1', 'a') }];

  it('同じIDがあれば already_in_db', () => {
    expect(recoveryConflict({ id: 'ich-shop1:a', itemUrl: aff('shop1', 'a') }, migrated)).toBe('already_in_db');
  });

  it('移行済みの商品を旧IDで復旧しようとしたら same_product_exists（旧IDと新IDの二重登録防止）', () => {
    expect(recoveryConflict({ id: LEGACY, itemUrl: aff('shop1', 'a') }, migrated)).toBe('same_product_exists');
    // 手動登録の通常URLの商品とも同じ商品ページとして扱う
    expect(recoveryConflict({ id: LEGACY, itemUrl: aff('shop1', 'x') }, [{ id: 'mn-1', itemUrl: 'https://item.rakuten.co.jp/shop1/x/' }])).toBe('same_product_exists');
  });

  it('同じ店舗の別商品（旧IDが新ID商品と対応）は判定の付け違いを防ぐため復旧しない', () => {
    expect(recoveryConflict({ id: LEGACY, itemUrl: aff('shop1', 'b') }, migrated)).toBe('legacy_id_has_new_id_item');
  });

  it('対応する商品が無ければ復旧できる', () => {
    expect(recoveryConflict({ id: LEGACY, itemUrl: aff('shop1', 'b') }, [{ id: 'bk-1', itemUrl: 'https://books.rakuten.co.jp/rb/1/' }])).toBeNull();
    expect(recoveryConflict({ id: 'bk-9', itemUrl: 'https://books.rakuten.co.jp/rb/9/' }, migrated)).toBeNull();
  });
});

describe('定期取得・手動登録での二重登録防止（product-store）', () => {
  afterEach(() => {
    vi.doUnmock('@/db/write');
    vi.doUnmock('@/db/client');
    vi.resetModules();
  });
  const base = { price: 1, imageUrl: '', reviewCount: 0, reviewAverage: 0, relevanceScore: 0, category: 'グッズ' };

  it('定期取得の商品が手動登録（mn-）と同じ商品ページなら、手動登録の商品をそのまま残し取得分は追加しない', async () => {
    vi.doMock('@/db/write', () => ({ upsertProduct: vi.fn() }));
    vi.doMock('@/db/client', () => ({ db: {}, neonSql: vi.fn() }));
    const { mergeProductItems } = await import('@/lib/product-store');
    const manual = { ...base, id: 'mn-1', title: '手動のタイトル', itemUrl: 'https://item.rakuten.co.jp/shop1/a/', affiliateUrl: '' } as RakutenItem;
    const fetched = { ...base, id: 'ich-shop1:a', itemCode: 'shop1:a', title: 'APIのタイトル', itemUrl: aff('shop1', 'a'), affiliateUrl: aff('shop1', 'a') } as RakutenItem;
    const { items } = mergeProductItems([fetched], [manual], new Set(['mn-1']));
    expect(items).toEqual([manual]);
  });

  it('手動登録：同じ商品ページの商品（アフィリエイトURLの取得済み商品）が同じカテゴリにあれば duplicate', async () => {
    const upsertProduct = vi.fn();
    const existing = [{ ...base, id: 'ich-shop1:a', title: 'A', itemUrl: aff('shop1', 'a'), affiliateUrl: aff('shop1', 'a') }];
    const where = vi.fn().mockResolvedValue([{ personName: 'P', category: 'グッズ', items: existing, fetchedAt: new Date(0) }]);
    vi.doMock('@/db/write', () => ({ upsertProduct }));
    vi.doMock('@/db/client', () => ({ db: { select: () => ({ from: () => ({ where }) }) }, neonSql: vi.fn() }));
    const { appendProductToCategory } = await import('@/lib/product-store');
    const manual = { ...base, id: 'mn-2', title: 'A', itemUrl: 'https://item.rakuten.co.jp/shop1/a/', affiliateUrl: '' } as RakutenItem;
    expect(await appendProductToCategory('P', 'グッズ', manual)).toBe('duplicate');
    const other = { ...manual, id: 'mn-3', itemUrl: 'https://item.rakuten.co.jp/shop1/b/' } as RakutenItem;
    expect(await appendProductToCategory('P', 'グッズ', other)).toBe('created');
    expect(upsertProduct).toHaveBeenCalledTimes(1);
  });
});
