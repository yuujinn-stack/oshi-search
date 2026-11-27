import { describe, it, expect, beforeAll } from 'vitest';
import { STOCK_GUARD_FUNCTION_SQL, STOCK_GUARD_UNDO_SQL, stockGuardApplied } from '@/lib/price-refresh-stock-guard-sql';

// 保護トリガーの関数の更新（販売状況の項目の許可）を、隔離した Postgres（PGlite・メモリ上）で実際に確かめる。本番DBには接続しない。
let hasPglite = false;
try { require.resolve('@electric-sql/pglite'); hasPglite = true; } catch { /* 未導入 */ }

type Pg = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown> };
let pg: Pg;

const base = [
  { id: 'bk-1', title: '写真集A', price: 1000, priceFetchedAt: 1, itemUrl: 'https://books.rakuten.co.jp/rb/1/' },
  { id: 'bk-2', title: '写真集B', price: 2000, itemUrl: 'https://books.rakuten.co.jp/rb/2/' },
];

async function reset() {
  await pg.exec(`RESET ROLE; DELETE FROM products; INSERT INTO products VALUES ('p', '写真集', '${JSON.stringify(base)}'::jsonb);`);
}
/** price_refresher として items を書き換える（成功なら null、拒否ならエラー文） */
async function asRefresher(mut: (items: Record<string, unknown>[]) => unknown[]): Promise<string | null> {
  const items = mut(structuredClone(base) as Record<string, unknown>[]);
  try {
    await pg.exec('SET ROLE price_refresher');
    await pg.query(`UPDATE products SET items = $1::jsonb WHERE person_name = 'p'`, [JSON.stringify(items)]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    await pg.exec('RESET ROLE');
  }
}

describe.skipIf(!hasPglite)('保護トリガー: 販売状況の項目の許可（stock-guard）', () => {
  beforeAll(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    pg = new PGlite() as unknown as Pg;
    await pg.exec(`
      CREATE TABLE products (person_name text, category text, items jsonb, PRIMARY KEY (person_name, category));
      CREATE ROLE price_refresher;
      GRANT SELECT ON products TO price_refresher;
      GRANT UPDATE (items) ON products TO price_refresher;
    `);
    // 本番と同じ「更新前」の関数とトリガー
    await pg.exec(STOCK_GUARD_UNDO_SQL);
    await pg.exec(`CREATE TRIGGER products_price_refresher_guard BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_price_refresher_guard();`);
  });

  it('更新前: 販売状況の項目は拒否（PRICE_REFRESH_STOCK_FIELDS を有効にする前にこの関数の更新が必要）・価格は従来どおり', async () => {
    await reset();
    expect(await asRefresher((xs) => { xs[0].stockStatus = 'available'; xs[0].stockCheckedAt = 5; return xs; })).toMatch(/価格の項目以外/);
    expect(await asRefresher((xs) => { xs[0].price = 1100; xs[0].priceFetchedAt = 5; return xs; })).toBeNull();
  });

  it('更新後: 販売状況の7つの値と正の確認日時は許可。価格と同時の更新・価格なしの販売状況だけの更新も可', async () => {
    await pg.exec(STOCK_GUARD_FUNCTION_SQL);
    const def = (await pg.query(`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE proname = 'products_price_refresher_guard'`)).rows[0].d as string;
    expect(stockGuardApplied(def)).toBe(true);
    for (const st of ['available', 'backorder', 'preorder', 'unavailable', 'unknown', 'not_found', 'mismatched']) {
      await reset();
      expect(await asRefresher((xs) => { xs[1].stockStatus = st; xs[1].stockCheckedAt = 1764200000000; return xs; })).toBeNull();
    }
    await reset();
    expect(await asRefresher((xs) => { xs[0].price = 1100; xs[0].priceFetchedAt = 9; xs[0].stockStatus = 'available'; xs[0].stockCheckedAt = 9; return xs; })).toBeNull();
  });

  it('更新後: 不正な値・販売状況の削除・価格以外の項目・件数の変更は拒否', async () => {
    await reset();
    // 一度記録した販売状況（オーナーの接続で用意）
    await pg.exec(`UPDATE products SET items = jsonb_set(items, '{0,stockStatus}', '"available"') || '[]'::jsonb`);
    await pg.exec(`UPDATE products SET items = jsonb_set(items, '{0,stockCheckedAt}', '5')`);
    const cur = (await pg.query(`SELECT items FROM products`)).rows[0].items as Record<string, unknown>[];
    const run = async (mut: (xs: Record<string, unknown>[]) => unknown[]) => {
      const items = mut(structuredClone(cur));
      try { await pg.exec('SET ROLE price_refresher'); await pg.query(`UPDATE products SET items = $1::jsonb`, [JSON.stringify(items)]); return null; }
      catch (e) { return e instanceof Error ? e.message : String(e); }
      finally { await pg.exec('RESET ROLE'); }
    };
    expect(await run((xs) => { xs[0].stockStatus = 'maybe'; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { xs[0].stockStatus = 1; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { xs[0].stockCheckedAt = 0; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { xs[0].stockCheckedAt = '5'; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { delete xs[0].stockStatus; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { delete xs[0].stockCheckedAt; return xs; })).toMatch(/販売状況/);
    expect(await run((xs) => { xs[0].title = '別の商品'; return xs; })).toMatch(/価格の項目以外/);
    expect(await run((xs) => { xs[0].price = 0; return xs; })).toMatch(/価格は正の数値/);
    expect(await run((xs) => xs.slice(0, 1))).toMatch(/件数/);
    expect(await run((xs) => { xs[0].stockStatus = 'unavailable'; xs[0].stockCheckedAt = 6; return xs; })).toBeNull();
  });

  it('オーナー（サイト・既存の自動更新・管理画面）の更新は従来どおり妨げない', async () => {
    await reset();
    await pg.exec(`UPDATE products SET items = '[]'::jsonb`);
    expect((await pg.query(`SELECT jsonb_array_length(items) AS n FROM products`)).rows[0].n).toBe(0);
  });

  it('取り消し: 更新前の関数に戻すと販売状況の項目は再び拒否', async () => {
    await pg.exec(STOCK_GUARD_UNDO_SQL);
    await reset();
    expect(await asRefresher((xs) => { xs[0].stockStatus = 'available'; xs[0].stockCheckedAt = 5; return xs; })).toMatch(/価格の項目以外/);
    await pg.exec(STOCK_GUARD_FUNCTION_SQL);
  });
});
