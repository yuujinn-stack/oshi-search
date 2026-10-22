import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 商品データの同時更新で、他の更新（価格の承認・管理画面の編集・新商品の発見など）を上書きしない
// （src/db/write.ts の guard ＋ src/lib/product-write-guard.ts）。隔離した Postgres（PGlite・メモリ上）で実際に書き込む。本番DBには接続しない。
// 「読んでから書くまでの間」に別の更新を入れるため、書き込み直前に呼ばれる getBatchLockStatus の偽物から別の更新を実行する。
const h = vi.hoisted(() => ({
  pg: null as null | { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown>; transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T> },
  beforeWrite: null as null | (() => Promise<void>),
  writes: 0,
}));
let hasPglite = false;
try { require.resolve('@electric-sql/pglite'); hasPglite = true; } catch { /* 未導入 */ }

vi.mock('@/db/client', async () => {
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const schema = await import('@/db/schema');
    const pg = new PGlite();
    h.pg = pg as never;
    return { db: drizzle(pg, { schema }), neonSql: {} };
  } catch {
    return { db: {}, neonSql: {} };
  }
});
vi.mock('@/lib/batch-lock', () => ({
  PRODUCT_ID_MIGRATION_LOCK_KEY: 'product-id-migration',
  getBatchLockStatus: async () => {
    h.writes++;
    if (h.beforeWrite) await h.beforeWrite();
    return { isLocked: false };
  },
}));
vi.mock('@/lib/public-listing-cache', () => ({ revalidatePublicListings: () => {} }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/price-refresh-runner', () => ({ REVIEW_INBOX_KEY: 'i', STATE_KEY: 's', REVIEW_INBOX_DROPPED_KEY: 'd', MAX_REVIEW_INBOX: 1 }));

import { upsertProduct, updateProductItemsOnly } from '@/db/write';
import { ProductWriteConflictError, retryOnProductWriteConflict } from '../product-write-guard';
import { appendProductToCategory, applyPriceUpdates, productIdentityKey, savePriceOnlyItems, storeProducts, updateProductInCategory } from '../product-store';
import { decidePriceReview, syncPriceReviews, type ReviewDb } from '../price-review-store';
import type { RakutenItem } from '@/types/rakuten';

const P = '推しA', C = '写真集';
const NOW = Date.now();
const item = (id: string, o: Partial<RakutenItem> = {}): RakutenItem => ({
  id, title: `商品${id}`, price: 1000, imageUrl: `https://thumbnail.image.rakuten.co.jp/${id}.jpg`,
  itemUrl: `https://item.rakuten.co.jp/shop/${id}/`, affiliateUrl: '', shopName: '店', itemCode: `shop:${id}`, ...o,
} as RakutenItem);

describe.runIf(hasPglite)('同時更新で他の更新を上書きしない（隔離した Postgres）', () => {
  const pg = () => h.pg!;
  async function items(category = C): Promise<RakutenItem[]> {
    return ((await pg().query(`SELECT items FROM products WHERE person_name = $1 AND category = $2`, [P, category])).rows[0]?.items ?? []) as RakutenItem[];
  }
  const byId = (list: RakutenItem[], id: string) => list.find((i) => i.id === id);
  /** 別の更新：管理画面での商品名の変更（DB の中で直接） */
  const adminRename = (id: string, title: string) => pg().query(
    `UPDATE products SET items = jsonb_set(items, ARRAY[(SELECT (e.ord - 1)::text FROM jsonb_array_elements(items) WITH ORDINALITY e(it, ord) WHERE e.it->>'id' = $3), 'title'], to_jsonb($4::text))
     WHERE person_name = $1 AND category = $2`, [P, C, id, title]);
  /** 別の更新：価格の承認と同じ形（price・priceFetchedAt だけを DB の中で直接） */
  const approvePrice = (id: string, price: number) => pg().query(
    `UPDATE products SET items = jsonb_set(jsonb_set(items, ARRAY[(SELECT (e.ord - 1)::text FROM jsonb_array_elements(items) WITH ORDINALITY e(it, ord) WHERE e.it->>'id' = $3), 'price'], to_jsonb($4::int)),
       ARRAY[(SELECT (e.ord - 1)::text FROM jsonb_array_elements(items) WITH ORDINALITY e(it, ord) WHERE e.it->>'id' = $3), 'priceFetchedAt'], to_jsonb($5::bigint))
     WHERE person_name = $1 AND category = $2`, [P, C, id, price, NOW]);
  /** 1回だけ、書き込みの直前に別の更新を入れる */
  const once = (fn: () => Promise<unknown>) => { let done = false; h.beforeWrite = async () => { if (!done) { done = true; await fn(); } }; };

  beforeEach(async () => {
    await pg().exec(`
      DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS verdicts; DROP TABLE IF EXISTS price_reviews; DROP TABLE IF EXISTS price_review_logs;
      CREATE TABLE products (person_name text NOT NULL, category text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), items jsonb NOT NULL DEFAULT '[]', PRIMARY KEY (person_name, category));
      CREATE TABLE verdicts (person_name text NOT NULL, product_id text NOT NULL, verdict text NOT NULL, PRIMARY KEY (person_name, product_id));`);
    for (const stmt of fs.readFileSync(path.resolve(__dirname, '../../../drizzle/0020_price_reviews.sql'), 'utf8').split('--> statement-breakpoint')) await pg().exec(stmt);
    await pg().query(`INSERT INTO products (person_name, category, fetched_at, items) VALUES ($1, $2, '2026-01-01T00:00:00Z', $3)`,
      [P, C, JSON.stringify([item('a'), item('m', { title: '手動登録', isManual: true } as Partial<RakutenItem>), item('b', { price: 3000 })])]);
    h.beforeWrite = null;
    h.writes = 0;
  });

  describe('書き込みの条件（src/db/write.ts）', () => {
    it('読んだ items と一致すれば保存、違えば何も書かずに ProductWriteConflictError', async () => {
      const read = await items();
      await upsertProduct(P, C, [...read, item('x')], NOW, { expectedItems: read });
      expect((await items()).map((i) => i.id)).toEqual(['a', 'm', 'b', 'x']);
      await expect(upsertProduct(P, C, read, NOW, { expectedItems: read })).rejects.toBeInstanceOf(ProductWriteConflictError);
      expect((await items()).map((i) => i.id)).toEqual(['a', 'm', 'b', 'x']);
    });

    it('「行が無かった」前提の保存は、行が既にあれば書かない（読み取りに失敗した場合に既存の商品を消さない）', async () => {
      await expect(upsertProduct(P, C, [item('z')], NOW, { expectedItems: null })).rejects.toBeInstanceOf(ProductWriteConflictError);
      expect((await items()).map((i) => i.id)).toEqual(['a', 'm', 'b']);
      await upsertProduct(P, 'CD', [item('z')], NOW, { expectedItems: null });
      expect((await items('CD')).map((i) => i.id)).toEqual(['z']);
    });

    it('価格更新の保存（行が無ければ false・INSERT しない／変わっていれば ProductWriteConflictError）', async () => {
      const read = await items();
      expect(await updateProductItemsOnly(P, 'グッズ', read, NOW, { expectedItems: read })).toBe(false);
      await adminRename('a', '変更後');
      await expect(updateProductItemsOnly(P, C, read, NOW, { expectedItems: read })).rejects.toBeInstanceOf(ProductWriteConflictError);
      expect(byId(await items(), 'a')!.title).toBe('変更後');
      expect((await pg().query(`SELECT count(*)::int AS n FROM products`)).rows[0].n).toBe(1);
    });

    it('guard なしの書き込みは従来どおり（scripts の復元など）', async () => {
      await upsertProduct(P, C, [item('only')], NOW);
      expect((await items()).map((i) => i.id)).toEqual(['only']);
    });
  });

  describe('既存の書き込み経路：読んでから書くまでの間に別の更新が入っても失われない', () => {
    it('新商品の発見（storeProducts）× 管理画面の商品名の変更', async () => {
      once(() => adminRename('m', '管理画面で変更'));
      const stats = await storeProducts(P, C, [item('a', { price: 1100 }), item('new')], new Set(['a', 'm', 'b']));
      expect(stats.skippedBecauseError).toBe(false);
      const after = await items();
      expect(byId(after, 'm')!.title).toBe('管理画面で変更'); // 別の更新が残る
      expect(byId(after, 'new')).toBeTruthy(); // 発見した商品も保存
      expect(after.map((i) => i.id).sort()).toEqual(['a', 'b', 'm', 'new']); // 既存の商品は1件も消えない（並びは従来の発見のマージどおり）
      expect(h.writes).toBe(2); // 1回目は読み直してやり直した
    });

    it('新商品の発見（storeProducts）× 価格の承認', async () => {
      once(() => approvePrice('b', 1500));
      await storeProducts(P, C, [item('new')], new Set(['a', 'm', 'b']));
      const after = await items();
      expect(byId(after, 'b')).toMatchObject({ price: 1500, priceFetchedAt: NOW });
      expect(byId(after, 'new')).toBeTruthy();
    });

    it('管理画面の商品の編集（updateProductInCategory）× 価格の承認（同じ商品）', async () => {
      once(() => approvePrice('m', 2222));
      expect(await updateProductInCategory(P, C, 'm', { title: '編集後', shopName: '別の店' } as Partial<RakutenItem>)).toBe(true);
      expect(byId(await items(), 'm')).toMatchObject({ title: '編集後', shopName: '別の店', price: 2222, priceFetchedAt: NOW });
    });

    it('手動登録（appendProductToCategory）× 別の手動登録', async () => {
      once(() => pg().query(`UPDATE products SET items = items || $3::jsonb WHERE person_name = $1 AND category = $2`, [P, C, JSON.stringify([item('other')])]));
      expect(await appendProductToCategory(P, C, item('mine'))).toBe('created');
      expect((await items()).map((i) => i.id)).toEqual(['a', 'm', 'b', 'other', 'mine']);
    });

    it('価格更新のコード指定（applyPriceUpdates）× 管理画面の商品名の変更', async () => {
      once(() => adminRename('a', '管理画面で変更'));
      const r = await applyPriceUpdates(P, C, new Map([['a', { price: 1200, priceFetchedAt: NOW, identityKey: productIdentityKey(item('a')) }]]));
      expect(r.applied).toBe(1);
      expect(byId(await items(), 'a')).toMatchObject({ title: '管理画面で変更', price: 1200, priceFetchedAt: NOW });
    });

    it('価格更新のカテゴリ検索の保存（savePriceOnlyItems）は、読んだ時点から変わっていれば書かない（呼び出し側で読み直す）', async () => {
      const read = await items();
      const next = read.map((i) => (i.id === 'a' ? { ...i, price: 1100, priceFetchedAt: NOW } : i));
      await approvePrice('b', 1500);
      await expect(savePriceOnlyItems(P, C, next, NOW, read)).rejects.toBeInstanceOf(ProductWriteConflictError);
      expect(byId(await items(), 'b')!.price).toBe(1500);
    });

    it('別の更新が何度も入り続けたら、保存をあきらめてエラーにする（別の更新は消さない）', async () => {
      let n = 0;
      h.beforeWrite = async () => { n++; await adminRename('m', `変更${n}`); };
      await expect(storeProducts(P, C, [item('new')], new Set())).rejects.toBeInstanceOf(ProductWriteConflictError);
      const after = await items();
      expect(byId(after, 'm')!.title).toBe(`変更${n}`);
      expect(byId(after, 'new')).toBeUndefined();
      expect(n).toBe(4);
    });
  });

  it('実際の価格の承認（decidePriceReview）が新商品の発見の途中に入っても、承認した価格が残る', async () => {
    const dbx: ReviewDb = {
      query: async (t, p = []) => (await pg().query(t, p)).rows,
      transaction: (stmts, opts) => pg().transaction(async (tx: { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => {
        if (opts?.serializable) await tx.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        const out: Record<string, unknown>[][] = [];
        for (const s of stmts) out.push((await tx.query(s.text, s.params)).rows);
        return out;
      }) as Promise<Record<string, unknown>[][]>,
    };
    await pg().query(`INSERT INTO verdicts VALUES ($1, 'b', 'related')`, [P]);
    await syncPriceReviews(dbx, [{ person: P, category: C, id: 'b', previousPrice: 3000, fetchedPrice: 1500, changeRate: -0.5, reason: 'price_change_30pct', fetchedAt: NOW }]);
    let result: unknown;
    once(async () => { result = await decidePriceReview(dbx, { action: 'approve', id: 1, expectedPreviousPrice: 3000, expectedFetchedPrice: 1500, operator: '管理者A' }, NOW); });
    await storeProducts(P, C, [item('a', { price: 1100 }), item('new')], new Set(['a', 'm', 'b']));
    expect(result).toMatchObject({ ok: true, code: 'approved' });
    const after = await items();
    expect(byId(after, 'b')).toMatchObject({ price: 1500, priceFetchedAt: NOW, title: '商品b' });
    expect(byId(after, 'new')).toBeTruthy();
  });
});

describe('読み直してやり直す回数', () => {
  it('同時更新のエラーだけをやり直し、上限で諦める。それ以外のエラーはそのまま', async () => {
    const sleep = async () => {};
    let n = 0;
    await expect(retryOnProductWriteConflict(async () => { n++; throw new ProductWriteConflictError('p', 'c'); }, { sleep })).rejects.toBeInstanceOf(ProductWriteConflictError);
    expect(n).toBe(4);
    n = 0;
    expect(await retryOnProductWriteConflict(async () => { n++; if (n < 3) throw new ProductWriteConflictError('p', 'c'); return 'ok'; }, { sleep })).toBe('ok');
    n = 0;
    await expect(retryOnProductWriteConflict(async () => { n++; throw new Error('db down'); }, { sleep })).rejects.toThrow('db down');
    expect(n).toBe(1);
  });
});
