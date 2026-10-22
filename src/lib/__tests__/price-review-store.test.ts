import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 価格の確認待ちの取り込み・承認・却下（src/lib/price-review-store.ts）。
// SQL は隔離した Postgres（PGlite・メモリ上）で実際に実行して確かめる。本番DBには接続しない。
// PGlite が入っていない環境では DB のテストを飛ばす（npm i --no-save @electric-sql/pglite で実行できる）。
const redisMock = vi.hoisted(() => ({ client: null as null | Record<string, unknown> }));
vi.mock('@/db/client', () => ({ neonSql: {}, db: {} }));
vi.mock('@/lib/redis', () => ({ getRedis: () => redisMock.client }));
vi.mock('@/lib/price-refresh-runner', () => ({
  REVIEW_INBOX_KEY: 'price-refresh:review-inbox', STATE_KEY: 'price-refresh:state',
  REVIEW_INBOX_DROPPED_KEY: 'price-refresh:review-inbox-dropped', MAX_REVIEW_INBOX: 20000,
}));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'] }));

import {
  PRICE_REVIEW_MAX_AGE_DAYS, buildApproveStatements, buildRejectStatements, decidePriceReview, isPriceReviewExpired, priceReviewCutoffMs, getReviewInboxStatus, listPendingPriceReviews, listPriceReviewLogs,
  parseDecideInput, parseIncomingReview, syncPriceReviews, syncPriceReviewsFromRedis,
  type DecideInput, type IncomingPriceReview, type ReviewDb,
} from '../price-review-store';

type PG = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown>; transaction: <T>(fn: (tx: PG) => Promise<T>) => Promise<T> };
let PGliteCtor: (new () => PG) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PGliteCtor = require('@electric-sql/pglite').PGlite;
} catch { /* 未導入 */ }

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../drizzle/0020_price_reviews.sql'), 'utf8');
const NOW = Date.UTC(2026, 9, 22, 3, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const target = {
  id: 'ic-1', title: '写真集 A', itemUrl: 'https://item.rakuten.co.jp/shop/a/', affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=a',
  itemCode: 'shop:a', imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg', shopName: '店', price: 10000, priceFetchedAt: 1_700_000_000_000, isManual: false,
};
const others = [
  { id: 'ic-0', title: '前の商品', itemUrl: 'https://item.rakuten.co.jp/shop/z/', itemCode: 'shop:z', price: 500 },
  { id: 'ic-2', title: '後ろの商品', itemUrl: 'https://item.rakuten.co.jp/shop/b/', itemCode: 'shop:b', price: 3000, priceFetchedAt: 5 },
];

function makeDb(pg: PG, hooks: { mutate?: (stmts: { text: string; params: unknown[] }[]) => { text: string; params: unknown[] }[] } = {}): ReviewDb {
  return {
    query: async (t, p = []) => (await pg.query(t, p)).rows,
    transaction: (stmts, opts) => pg.transaction(async (tx) => {
      if (opts?.serializable) await tx.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const out: Record<string, unknown>[][] = [];
      for (const s of hooks.mutate ? hooks.mutate(stmts) : stmts) out.push((await tx.query(s.text, s.params)).rows);
      return out;
    }),
  };
}

const incoming = (o: Partial<IncomingPriceReview> = {}): IncomingPriceReview => ({
  person: '推しA', category: '写真集', id: 'ic-1', previousPrice: 10000, fetchedPrice: 14000, changeRate: 0.4, reason: 'price_change_30pct', fetchedAt: NOW - DAY, ...o,
});
const decide = (id: number, o: Partial<DecideInput> = {}): DecideInput => ({ action: 'approve', id, expectedPreviousPrice: 10000, expectedFetchedPrice: 14000, operator: '管理者A', ...o });

describe.runIf(!!PGliteCtor)('価格の確認待ち（隔離した Postgres で SQL を実行）', () => {
  let pg: PG;
  let dbx: ReviewDb;

  async function items(category = '写真集'): Promise<Record<string, unknown>[]> {
    return (await pg.query(`SELECT items FROM products WHERE person_name = '推しA' AND category = $1`, [category])).rows[0].items as Record<string, unknown>[];
  }
  async function snapshot() {
    return {
      products: (await pg.query(`SELECT person_name, category, fetched_at, items FROM products ORDER BY person_name, category`)).rows,
      verdicts: (await pg.query(`SELECT * FROM verdicts ORDER BY product_id`)).rows,
    };
  }
  async function reviewRow(id = 1) { return (await pg.query(`SELECT * FROM price_reviews WHERE id = $1`, [id])).rows[0]; }
  async function logs() { return (await pg.query(`SELECT * FROM price_review_logs ORDER BY id`)).rows; }

  beforeAll(() => { expect(PGliteCtor).toBeTruthy(); });
  beforeEach(async () => {
    pg = new PGliteCtor!();
    await pg.exec(`
      CREATE TABLE products (person_name text NOT NULL, category text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), items jsonb NOT NULL DEFAULT '[]', PRIMARY KEY (person_name, category));
      CREATE TABLE verdicts (person_name text NOT NULL, product_id text NOT NULL, verdict text NOT NULL, PRIMARY KEY (person_name, product_id));`);
    for (const stmt of MIGRATION.split('--> statement-breakpoint')) await pg.exec(stmt);
    await pg.query(`INSERT INTO products (person_name, category, fetched_at, items) VALUES ('推しA', '写真集', '2026-01-01T00:00:00Z', $1), ('推しA', 'CD', '2026-01-02T00:00:00Z', $2)`,
      [JSON.stringify([others[0], target, others[1]]), JSON.stringify([{ id: 'cd-1', title: 'CD', price: 2000 }])]);
    await pg.query(`INSERT INTO verdicts VALUES ('推しA', 'ic-0', 'related'), ('推しA', 'ic-1', 'related'), ('推しA', 'ic-2', 'unrelated')`);
    dbx = makeDb(pg);
  });

  describe('取り込み', () => {
    it('確認待ちとして保存し（商品名・URL等を検出時の値として控える）、同じものを何度取り込んでも1件', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      await syncPriceReviews(dbx, [incoming()]);
      const rows = (await pg.query(`SELECT * FROM price_reviews`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending', person_name: '推しA', category: '写真集', item_id: 'ic-1', previous_price: 10000, fetched_price: 14000, item_title: '写真集 A' });
      expect(rows[0].item_identity).toEqual({ itemUrl: target.itemUrl, affiliateUrl: target.affiliateUrl, itemCode: target.itemCode });
      const list = await listPendingPriceReviews(dbx, 1, NOW);
      expect(list.total).toBe(1);
      expect(list.rows[0]).toMatchObject({ itemTitle: '写真集 A', currentPrice: 10000, fetchedPrice: 14000, blocker: null });
    });

    it('保存されていない商品は取り込まない（商品を新規追加しない）・取り込みで商品は変わらない', async () => {
      const before = await snapshot();
      await syncPriceReviews(dbx, [incoming({ id: 'ic-unknown' })]);
      expect((await pg.query(`SELECT * FROM price_reviews`)).rows).toHaveLength(0);
      await syncPriceReviews(dbx, [incoming()]);
      expect(await snapshot()).toEqual(before);
    });

    it('同じ商品で取得した価格が変わったら新しい変更案に置き換え、古い取り込みで戻らない', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      await syncPriceReviews(dbx, [incoming({ fetchedPrice: 15000, changeRate: 0.5, fetchedAt: NOW - DAY / 2 })]);
      await syncPriceReviews(dbx, [incoming()]); // 古い取得（Redis に残っていた分）を再度取り込んでも
      const rows = (await pg.query(`SELECT fetched_price, status FROM price_reviews ORDER BY id`)).rows;
      expect(rows).toEqual([{ fetched_price: 14000, status: 'superseded' }, { fetched_price: 15000, status: 'pending' }]);
    });

    /** Redis の偽物（ハッシュ。EVAL は「値が同じなら HDEL」のスクリプトだけを実行） */
    function fakeRedis(inbox: Record<string, unknown>, states: Record<string, unknown> = {}, hooks: { beforeEval?: () => void } = {}) {
      const asStored = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
      return {
        inbox,
        hgetall: async (k: string) => (k === 'price-refresh:review-inbox' ? { ...inbox } : states),
        eval: async (_script: string, _keys: string[], args: string[]) => {
          hooks.beforeEval?.();
          let n = 0;
          for (let i = 0; i < args.length; i += 2) if (inbox[args[i]] != null && asStored(inbox[args[i]]) === args[i + 1]) { delete inbox[args[i]]; n++; }
          return n;
        },
      };
    }

    it('Redis の受け取り箱と人物の直近の結果から取り込み、取り込んだ受け取り箱の項目だけを消す。不正な値は取り込まない', async () => {
      const inbox: Record<string, unknown> = {
        f1: JSON.stringify(incoming()),
        f2: JSON.stringify({ ...incoming(), fetchedPrice: -5 }), // 不正
        f3: { ...incoming({ category: 'CD', id: 'cd-1', previousPrice: 2000, fetchedPrice: 900, changeRate: -0.55 }) },
      };
      const states = { 推しA: JSON.stringify({ last: { at: NOW - DAY, priceReviews: [{ category: '写真集', id: 'ic-1', previousPrice: 10000, fetchedPrice: 14000, changeRate: 0.4, reason: 'price_change_30pct' }] } }) };
      const fake = fakeRedis(inbox, states);
      redisMock.client = fake;
      const r = await syncPriceReviewsFromRedis(dbx);
      expect(r).toMatchObject({ received: 4, valid: 3, synced: true });
      expect(fake.inbox).toEqual({});
      expect((await pg.query(`SELECT item_id FROM price_reviews ORDER BY item_id`)).rows.map((x) => x.item_id)).toEqual(['cd-1', 'ic-1']);
      redisMock.client = null;
    });

    it('取り込みの間に価格更新が同じ項目を書き直したら、その項目は消さない（次回に取り込む＝失われない）', async () => {
      const inbox: Record<string, unknown> = { f1: JSON.stringify(incoming()) };
      const newer = JSON.stringify(incoming({ fetchedAt: NOW }));
      redisMock.client = fakeRedis(inbox, {}, { beforeEval: () => { inbox.f1 = newer; } });
      await syncPriceReviewsFromRedis(dbx);
      expect(inbox).toEqual({ f1: newer });
      redisMock.client = fakeRedis(inbox);
      await syncPriceReviewsFromRedis(dbx);
      expect(inbox).toEqual({});
      expect(Number((await reviewRow()).fetched_at_ms)).toBe(NOW);
      redisMock.client = null;
    });

    it('DB の取り込みに失敗したら受け取り箱は消さない', async () => {
      const inbox: Record<string, unknown> = { f1: JSON.stringify(incoming()) };
      redisMock.client = fakeRedis(inbox);
      const broken: ReviewDb = { ...dbx, transaction: async () => { throw new Error('db down'); } };
      await expect(syncPriceReviewsFromRedis(broken)).rejects.toThrow('db down');
      expect(Object.keys(inbox)).toEqual(['f1']);
      redisMock.client = null;
    });

    it('受け取り箱の状況（読み取りのみ）', async () => {
      const calls: string[] = [];
      redisMock.client = {
        hlen: async (k: string) => { calls.push(`hlen ${k}`); return 12; },
        get: async (k: string) => { calls.push(`get ${k}`); return '3'; },
      };
      expect(await getReviewInboxStatus()).toEqual({ waiting: 12, capacity: 20000, dropped: 3 });
      expect(calls.sort()).toEqual(['get price-refresh:review-inbox-dropped', 'hlen price-refresh:review-inbox']);
      redisMock.client = null;
    });

    it('一覧・履歴の表示は読み取りのみ（読み取り専用のトランザクションの中でも動く）', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      await decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW);
      await syncPriceReviews(dbx, [incoming({ fetchedPrice: 16000, fetchedAt: NOW })]);
      const readOnly: ReviewDb = {
        query: (t, p = []) => pg.transaction(async (tx) => { await tx.query('SET TRANSACTION READ ONLY'); return (await tx.query(t, p)).rows; }),
        transaction: async () => { throw new Error('書き込みは不可'); },
      };
      expect((await listPendingPriceReviews(readOnly, 1, NOW)).total).toBe(1);
      expect((await listPriceReviewLogs(readOnly, 1)).total).toBe(1);
      // 読み取り専用のトランザクションで書き込もうとすると失敗する（この確認が有効であること）
      await expect(readOnly.query(`UPDATE price_reviews SET status = status`)).rejects.toThrow(/read-only/);
    });
  });

  describe('承認', () => {
    it('対象商品の price と priceFetchedAt だけを更新する（商品名・URL・画像・並び順・他の商品・判定・カテゴリの再検索日時は変わらない）', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const before = await snapshot();
      const r = await decidePriceReview(dbx, decide(1), NOW);
      expect(r).toMatchObject({ ok: true, code: 'approved' });
      const after = await snapshot();
      const expected = structuredClone(before);
      const row = expected.products.find((p) => p.category === '写真集')!;
      (row.items as Record<string, unknown>[])[1] = { ...target, price: 14000, priceFetchedAt: NOW - DAY };
      expect(after).toEqual(expected);
      expect(Object.keys((await items())[1]).sort()).toEqual(Object.keys(target).sort()); // 項目の種類も同じ（jsonb はキーの順を保持しない）
      expect(await reviewRow()).toMatchObject({ status: 'approved', decided_by: '管理者A' });
      expect(await logs()).toEqual([expect.objectContaining({ review_id: 1, action: 'approved', performed_by: '管理者A', item_id: 'ic-1', person_name: '推しA', previous_price: 10000, fetched_price: 14000 })]);
      expect((await listPendingPriceReviews(dbx, 1, NOW)).total).toBe(0);
    });

    it('同じ承認を繰り返しても二重に更新しない', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      expect((await decidePriceReview(dbx, decide(1), NOW)).code).toBe('approved');
      const once = await snapshot();
      const again = await decidePriceReview(dbx, decide(1), NOW);
      expect(again).toMatchObject({ ok: false, code: 'already_decided', status: 'approved' });
      expect(await snapshot()).toEqual(once);
      expect(await logs()).toHaveLength(1);
    });

    it('同じ承認が同時に2回送られても、更新・履歴は1回だけ', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const rs = await Promise.all([decidePriceReview(dbx, decide(1), NOW), decidePriceReview(dbx, decide(1), NOW)]);
      expect(rs.map((r) => r.code).sort()).toEqual(['already_decided', 'approved']);
      expect((await items())[1]).toMatchObject({ price: 14000, priceFetchedAt: NOW - DAY });
      expect(await logs()).toHaveLength(1);
    });

    it('同時に承認と却下が送られても、どちらか一方だけが成功する', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const [a, b] = await Promise.all([decidePriceReview(dbx, decide(1), NOW), decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW)]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const st = (await reviewRow()).status;
      expect((await items())[1].price).toBe(st === 'approved' ? 14000 : 10000);
      expect(await logs()).toHaveLength(1);
    });

    it('前回の価格が無い商品の変更案も承認できる（価格の項目を追加）', async () => {
      const noPrice = { id: 'ic-1', title: '写真集 A', itemUrl: target.itemUrl, affiliateUrl: target.affiliateUrl, itemCode: target.itemCode };
      await pg.query(`UPDATE products SET items = $1 WHERE category = '写真集'`, [JSON.stringify([others[0], noPrice, others[1]])]);
      await syncPriceReviews(dbx, [incoming({ previousPrice: 0, changeRate: null, reason: 'no_previous_price' })]);
      expect((await decidePriceReview(dbx, decide(1, { expectedPreviousPrice: 0 }), NOW)).code).toBe('approved');
      expect((await items())[1]).toEqual({ ...noPrice, price: 14000, priceFetchedAt: NOW - DAY });
    });
  });

  describe('古い・変わった確認待ちでは更新しない', () => {
    const cases: [string, (pg: PG) => Promise<void>, string][] = [
      ['保存済みの価格が変わった', async (p) => { await p.query(`UPDATE products SET items = jsonb_set(items, '{1,price}', '11000') WHERE category = '写真集'`); }, 'price_changed'],
      ['商品が削除された', async (p) => { await p.query(`UPDATE products SET items = $1 WHERE category = '写真集'`, [JSON.stringify(others)]); }, 'item_missing'],
      ['商品ページURLが変わった', async (p) => { await p.query(`UPDATE products SET items = jsonb_set(items, '{1,itemUrl}', '"https://item.rakuten.co.jp/shop/other/"') WHERE category = '写真集'`); }, 'identity_changed'],
      ['判定が related でなくなった', async (p) => { await p.query(`UPDATE verdicts SET verdict = 'unrelated' WHERE product_id = 'ic-1'`); }, 'not_related'],
    ];
    for (const [label, change, reason] of cases) {
      it(`${label}：何も更新せず、確認待ちから外して履歴に残す`, async () => {
        await syncPriceReviews(dbx, [incoming()]);
        await change(pg);
        expect((await listPendingPriceReviews(dbx, 1, NOW)).rows[0].blocker).toBe(reason);
        const before = await snapshot();
        const r = await decidePriceReview(dbx, decide(1), NOW);
        expect(r).toMatchObject({ ok: false, code: 'stale', detail: reason });
        expect(await snapshot()).toEqual(before);
        expect((await reviewRow()).status).toBe('stale');
        expect(await logs()).toEqual([expect.objectContaining({ action: 'stale', performed_by: '管理者A' })]);
      });
    }

    it('画面の価格と確認待ちの価格が違えば何もしない（確認待ちのまま）', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const before = await snapshot();
      expect((await decidePriceReview(dbx, decide(1, { expectedFetchedPrice: 14001 }), NOW)).code).toBe('price_mismatch');
      expect((await decidePriceReview(dbx, decide(1, { action: 'reject', expectedPreviousPrice: 9999 }), NOW)).code).toBe('price_mismatch');
      expect(await snapshot()).toEqual(before);
      expect((await reviewRow()).status).toBe('pending');
      expect(await logs()).toHaveLength(0);
    });

    it.each([
      ['14日を超えた', PRICE_REVIEW_MAX_AGE_DAYS * DAY + 1, 'expired'],
      ['14日ちょうど', PRICE_REVIEW_MAX_AGE_DAYS * DAY, 'expired'],
      ['14日に1ミリ秒足りない', PRICE_REVIEW_MAX_AGE_DAYS * DAY - 1, null],
    ] as const)('承認できる期限の境目：取得から%s価格（一覧の表示・承認前の確認が同じ判定）', async (_l, age, blocker) => {
      await syncPriceReviews(dbx, [incoming({ fetchedAt: NOW - age })]);
      expect((await listPendingPriceReviews(dbx, 1, NOW)).rows[0].blocker).toBe(blocker);
      const before = await snapshot();
      const r = await decidePriceReview(dbx, decide(1), NOW);
      if (blocker) {
        expect(r.code).toBe('expired');
        expect(await snapshot()).toEqual(before);
        expect((await reviewRow()).status).toBe('pending');
        expect(await logs()).toHaveLength(0);
      } else {
        expect(r.code).toBe('approved');
        expect((await items())[1]).toMatchObject({ price: 14000, priceFetchedAt: NOW - age });
      }
    });

    it('承認の SQL も同じ境目：取得日時が期限ちょうど（14日ちょうど）なら、承認前の確認を通っても更新しない', async () => {
      await syncPriceReviews(dbx, [incoming({ fetchedAt: NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY })]);
      const before = await snapshot();
      // 承認前の確認（JS）を飛ばして SQL だけを実行：期限ちょうどは fetched_at_ms > 期限 を満たさず、何も更新しない
      const res = await dbx.transaction(buildApproveStatements(decide(1), NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY), { serializable: true });
      expect(res[0]).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
      expect((await reviewRow()).status).toBe('pending');
      // 1ミリ秒新しい取得なら SQL でも承認される
      const res2 = await dbx.transaction(buildApproveStatements(decide(1), NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY - 1), { serializable: true });
      expect(res2[0]).toHaveLength(1);
    });

    it('期限の判定（isPriceReviewExpired）', () => {
      expect(isPriceReviewExpired(NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY, NOW)).toBe(true);
      expect(isPriceReviewExpired(NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY - 1, NOW)).toBe(true);
      expect(isPriceReviewExpired(NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY + 1, NOW)).toBe(false);
      expect(priceReviewCutoffMs(NOW)).toBe(NOW - PRICE_REVIEW_MAX_AGE_DAYS * DAY);
    });

    it(`取得から${PRICE_REVIEW_MAX_AGE_DAYS}日以上経った価格は承認できない（却下はできる）`, async () => {
      await syncPriceReviews(dbx, [incoming({ fetchedAt: NOW - (PRICE_REVIEW_MAX_AGE_DAYS + 1) * DAY })]);
      const before = await snapshot();
      expect((await listPendingPriceReviews(dbx, 1, NOW)).rows[0].blocker).toBe('expired');
      expect((await decidePriceReview(dbx, decide(1), NOW)).code).toBe('expired');
      expect(await snapshot()).toEqual(before);
      expect((await decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW)).code).toBe('rejected');
    });

    it('存在しない確認待ち', async () => {
      expect((await decidePriceReview(dbx, decide(99), NOW)).code).toBe('not_found');
    });
  });

  describe('却下', () => {
    it('保存済みの価格は変えず、履歴を残し、同じ変更案は再表示しない。別の変更案なら再び確認待ち', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const before = await snapshot();
      expect(await decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW)).toMatchObject({ ok: true, code: 'rejected' });
      expect(await snapshot()).toEqual(before);
      expect(await logs()).toEqual([expect.objectContaining({ action: 'rejected', performed_by: '管理者A', previous_price: 10000, fetched_price: 14000 })]);
      // 次の価格更新で同じ変更案（より新しい取得）が来ても再表示しない
      await syncPriceReviews(dbx, [incoming({ fetchedAt: NOW })]);
      expect((await listPendingPriceReviews(dbx, 1, NOW)).total).toBe(0);
      expect((await reviewRow()).status).toBe('rejected');
      // 取得した価格が変わった（別の変更案）なら再び確認待ち
      await syncPriceReviews(dbx, [incoming({ fetchedPrice: 16000, changeRate: 0.6, fetchedAt: NOW })]);
      const list = await listPendingPriceReviews(dbx, 1, NOW);
      expect(list.rows.map((r) => r.fetchedPrice)).toEqual([16000]);
      // 再度の却下は二重に記録しない
      expect((await decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW)).code).toBe('already_decided');
      expect(await logs()).toHaveLength(1);
    });
  });

  describe('DB のエラーでもデータが壊れない', () => {
    it('承認の途中でエラーになったら、確認待ち・商品・履歴とも何も変わらない（トランザクション）', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const before = await snapshot();
      const failing = makeDb(pg, { mutate: (stmts) => [...stmts.slice(0, 3), { text: 'SELECT no_such_function()', params: [] }] });
      await expect(decidePriceReview(failing, decide(1), NOW)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect((await reviewRow()).status).toBe('pending');
      expect(await logs()).toHaveLength(0);
    });

    it('承認済みにしたのに商品が更新されなかった場合は、全体を取り消す（承認済みだけが残らない）', async () => {
      await syncPriceReviews(dbx, [incoming()]);
      const before = await snapshot();
      const skipProductUpdate = makeDb(pg, { mutate: (stmts) => stmts.filter((_, i) => i !== 1) });
      await expect(decidePriceReview(skipProductUpdate, decide(1), NOW)).rejects.toThrow(/division by zero/);
      expect(await snapshot()).toEqual(before);
      expect((await reviewRow()).status).toBe('pending');
    });

    it('承認・却下が書き込むテーブルは price_reviews・products（承認のみ）・price_review_logs だけ（判定・手動並び順・表示設定・人物は書かない）', () => {
      const targets = (stmts: { text: string }[]) => stmts.flatMap((s) => [...s.text.matchAll(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(\w+)/gi)].map((m) => m[1])).sort();
      expect(targets(buildApproveStatements(decide(1), NOW - DAY))).toEqual(['price_review_logs', 'price_reviews', 'products']);
      expect(targets(buildRejectStatements(decide(1, { action: 'reject' })))).toEqual(['price_review_logs', 'price_reviews']);
      for (const s of [...buildApproveStatements(decide(1), NOW - DAY), ...buildRejectStatements(decide(1))]) {
        expect(s.text).not.toMatch(/\b(verdicts|product_display_order|photobook_settings|persons)\b\s*(SET|\()/i);
        expect(s.text).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
      }
    });

    it('承認の文は、このトランザクションで承認した確認待ちの商品だけを対象にする', () => {
      const stmts = buildApproveStatements(decide(1), NOW - DAY);
      expect(stmts).toHaveLength(4);
      expect(stmts[1].text).toContain("r.status = 'approved' AND r.decided_at = now()");
      // price と priceFetchedAt 以外の項目は書かない
      expect(stmts[1].text.match(/'(\w+)'\]/g)).toEqual(["'price']", "'priceFetchedAt']"]);
    });
  });

  it('履歴はページ分割して新しい順', async () => {
    await syncPriceReviews(dbx, [incoming(), incoming({ category: 'CD', id: 'cd-1', previousPrice: 2000, fetchedPrice: 900, changeRate: -0.55 })]);
    await pg.query(`INSERT INTO verdicts VALUES ('推しA', 'cd-1', 'related')`);
    await decidePriceReview(dbx, decide(1, { action: 'reject' }), NOW);
    await decidePriceReview(dbx, decide(2, { expectedPreviousPrice: 2000, expectedFetchedPrice: 900 }), NOW);
    const h = await listPriceReviewLogs(dbx, 1);
    expect(h.total).toBe(2);
    expect(h.rows.map((r) => r.action)).toEqual(['approved', 'rejected']);
    expect((await listPriceReviewLogs(dbx, 2)).rows).toHaveLength(0);
  });
});

describe('リクエストの検証（サーバー側）', () => {
  const ok = { action: 'approve', id: 3, expectedPreviousPrice: 10000, expectedFetchedPrice: 14000, operator: ' 管理者A ' };
  it('正しい入力', () => {
    expect(parseDecideInput(ok)).toEqual({ ...ok, operator: '管理者A' });
    expect(parseDecideInput({ ...ok, action: 'reject', expectedPreviousPrice: 0 })).toMatchObject({ action: 'reject' });
  });
  it.each([
    ['不明な操作', { action: 'delete' }],
    ['ID が文字列', { id: '3' }],
    ['ID が小数', { id: 1.5 }],
    ['価格が負', { expectedPreviousPrice: -1 }],
    ['取得価格が0', { expectedFetchedPrice: 0 }],
    ['価格が小数', { expectedFetchedPrice: 100.5 }],
    ['価格が大きすぎる', { expectedFetchedPrice: 1e12 }],
    ['操作者なし', { operator: '  ' }],
    ['操作者が長い', { operator: 'x'.repeat(51) }],
    ['操作者に改行', { operator: 'a\nb' }],
  ])('%s は受け付けない', (_l, patch) => {
    expect(parseDecideInput({ ...ok, ...patch })).toBeNull();
  });
  it('Redis の確認待ちの検証', () => {
    expect(parseIncomingReview(incoming())).toEqual(incoming());
    expect(parseIncomingReview({ ...incoming(), category: '不明' })).toBeNull();
    expect(parseIncomingReview({ ...incoming(), reason: 'x' })).toBeNull();
    expect(parseIncomingReview({ ...incoming(), fetchedPrice: '14000' })).toBeNull();
    expect(parseIncomingReview(null)).toBeNull();
  });
});

describe('30%以上の価格変動は確認待ちになる（既存のルール）', async () => {
  const { priceChangeReview } = await vi.importActual<typeof import('../product-store')>('../product-store');
  it('30%以上は確認待ち・30%未満は自動更新', () => {
    expect(priceChangeReview('x', 10000, 13000)).toMatchObject({ reason: 'price_change_30pct', changeRate: 0.3 });
    expect(priceChangeReview('x', 10000, 7000)).toMatchObject({ reason: 'price_change_30pct', changeRate: -0.3 });
    expect(priceChangeReview('x', 10000, 12999)).toBeNull();
    expect(priceChangeReview('x', 0, 5000)).toMatchObject({ reason: 'no_previous_price' });
  });
});
