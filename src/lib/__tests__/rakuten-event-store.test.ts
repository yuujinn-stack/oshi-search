import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 楽天イベント管理の DB 操作（src/lib/rakuten-event/store.ts）と、本番にテーブルを作る手順（scripts/rakuten-events/setup-tables-core.ts）。
// SQL は隔離した Postgres（PGlite・メモリ上）で実際に実行して確かめる。本番DBには接続しない。
// PGlite が入っていない環境では DB のテストを飛ばす（npm i --no-save @electric-sql/pglite で実行できる）。
vi.mock('@/db/client', () => ({ neonSql: {}, db: {} }));

import {
  createEvent, deleteEvent, getEvent, getItemCodesFor, getLinkedItemCode, linkProducts, linkTargetKey, listEventProducts, listEvents, searchProducts, unlinkProduct,
  updateEvent, updateEventProduct, isMissingEventTable, type EventDb,
} from '../rakuten-event/store';
import { parseJstDateTimeLocal, type EventInput } from '../rakuten-event/core';
import { FINGERPRINT_SQL, migrationStatements, readState, undoStatements, verifyProblems, type Db } from '../../../scripts/rakuten-events/setup-tables-core';

type PG = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown>; transaction: <T>(fn: (tx: PG) => Promise<T>) => Promise<T> };
let PGliteCtor: (new () => PG) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PGliteCtor = require('@electric-sql/pglite').PGlite;
} catch { /* 未導入 */ }

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../drizzle/0022_rakuten_events.sql'), 'utf8');
const JST = (s: string) => parseJstDateTimeLocal(s)!;

const BASE_TABLES = `
  CREATE TABLE products (person_name text NOT NULL, category text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), items jsonb NOT NULL DEFAULT '[]', PRIMARY KEY (person_name, category));
  CREATE TABLE verdicts (person_name text NOT NULL, product_id text NOT NULL, verdict text NOT NULL, score numeric NOT NULL DEFAULT 0, source text NOT NULL, reason text, prompt_version text,
    judged_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (person_name, product_id));`;

function makeDb(pg: PG): EventDb {
  return {
    query: async (t, p = []) => (await pg.query(t, p)).rows,
    transaction: (stmts) => pg.transaction(async (tx) => {
      const out: Record<string, unknown>[][] = [];
      for (const s of stmts) out.push((await tx.query(s.text, s.params)).rows);
      return out;
    }),
  };
}

const input = (o: Partial<EventInput> = {}): EventInput => ({
  name: '楽天お買い物マラソン', eventType: 'marathon', startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59'),
  officialUrl: 'https://event.rakuten.co.jp/campaign/', entryRequired: 'required', entryUrl: null, conditions: null, benefit: null,
  benefitConditions: null, lastCheckedAt: null, visibility: 'hidden', note: null, ...o,
});

describe('setup-tables のマイグレーション文', () => {
  it('2テーブル・3インデックスの CREATE IF NOT EXISTS だけ', () => {
    const s = migrationStatements(MIGRATION);
    expect(s).toHaveLength(5);
    expect(s.every((x) => /^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS/.test(x))).toBe(true);
  });
  it('想定外の文は拒否する', () => {
    expect(() => migrationStatements(`${MIGRATION}\n--> statement-breakpoint\nALTER TABLE "products" ADD COLUMN "x" text`)).toThrow();
    expect(() => migrationStatements(MIGRATION.replace('"rakuten_events_ends_at_idx" ON "rakuten_events"', '"x_idx" ON "products"'))).toThrow();
  });
});

describe.runIf(!!PGliteCtor)('楽天イベントの DB 操作（隔離した Postgres で SQL を実行）', () => {
  let pg: PG;
  let db: EventDb;
  const fingerprint = async () => (await pg.query(FINGERPRINT_SQL)).rows[0];

  beforeAll(() => { /* PGlite の読み込み確認のみ */ });
  beforeEach(async () => {
    pg = new PGliteCtor!();
    await pg.exec(BASE_TABLES);
    for (const s of migrationStatements(MIGRATION)) await pg.exec(s);
    db = makeDb(pg);
    const items = (rows: Record<string, unknown>[]) => JSON.stringify(rows);
    await pg.query(`INSERT INTO products (person_name, category, items) VALUES
      ('推しA', '写真集', $1), ('推しA', 'CD', $2), ('推しB', '写真集', $3), ('推しC', 'グッズ', $4)`, [
      items([{ id: 'a1', title: '推しA 1st写真集', itemCode: 'shop:a1', itemUrl: 'https://item.rakuten.co.jp/shop/a1/', price: 3000 },
        { id: 'a2', title: '推しA 2nd写真集 100%_限定', price: 3300 }]),
      items([{ id: 'a3', title: '推しA シングルCD', itemCode: 'shop:a3', price: 1200 }]),
      items([{ id: 'b1', title: '推しB 写真集', price: 2800 }]),
      items([{ id: 'c1', title: '推しC アクスタ', price: 1500 }]),
    ]);
    await pg.query(`INSERT INTO verdicts (person_name, product_id, verdict, source) VALUES
      ('推しA', 'a1', 'related', 'manual'), ('推しA', 'a2', 'uncertain', 'ai'), ('推しA', 'a3', 'related', 'auto'), ('推しB', 'b1', 'related', 'auto')`);
  });

  it('イベントの登録・取得（日本時間で入力した日時が正しく保存される）・一覧（終了したものは後ろ）', async () => {
    const id = await createEvent(db, input(), '管理者A');
    const ended = await createEvent(db, input({ name: '終了したイベント', startsAt: JST('2020-01-01T00:00'), endsAt: JST('2020-01-02T00:00') }), '管理者A');
    const e = await getEvent(db, id);
    expect(e?.endsAt).toBe(JST('2026-11-11T01:59'));
    expect(new Date(e!.startsAt).toISOString()).toBe('2026-11-04T11:00:00.000Z');
    expect(e?.updatedBy).toBe('管理者A');
    const list = await listEvents(db);
    expect(list.map((x) => x.id)).toEqual([id, ended]);
    expect(list[0].counts).toEqual({ confirmed: 0, needs_check: 0, excluded: 0 });
  });

  it('更新は読んだ時点から変わっていないときだけ（同時編集で上書きしない）', async () => {
    const id = await createEvent(db, input(), 'A');
    const e = (await getEvent(db, id))!;
    expect(await updateEvent(db, id, input({ name: '更新後' }), 'B', e.updatedAt)).toBe('updated');
    expect(await updateEvent(db, id, input({ name: '古い画面から' }), 'C', e.updatedAt)).toBe('conflict');
    expect((await getEvent(db, id))?.name).toBe('更新後');
    expect(await updateEvent(db, 9999, input(), 'C', 0)).toBe('not_found');
  });

  it('既存の商品だけを「要確認」で紐付け、二度目は確認状態を戻さない', async () => {
    const id = await createEvent(db, input(), 'A');
    const r = await linkProducts(db, id, [
      { personName: '推しA', category: '写真集', productId: 'a1' },
      { personName: '推しA', category: '写真集', productId: 'nope' },
      { personName: '推しA', category: 'CD', productId: 'a1' }, // カテゴリ違い
    ]);
    expect(r).toEqual({ linked: 1, skipped: 2 });
    const [l] = await listEventProducts(db, id);
    expect(l).toMatchObject({ personName: '推しA', category: '写真集', productId: 'a1', productTitle: '推しA 1st写真集', checkStatus: 'needs_check', benefitScope: 'unknown' });
    expect(await updateEventProduct(db, l.id, id, {
      checkStatus: 'confirmed', benefitScope: 'item', benefitNote: 'ポイント5倍', sourceUrl: 'https://item.rakuten.co.jp/shop/a1/', checkedAt: JST('2026-11-05T10:00'), note: null,
    }, '確認者')).toBe(true);
    expect((await linkProducts(db, id, [{ personName: '推しA', category: '写真集', productId: 'a1' }])).linked).toBe(0);
    const [after] = await listEventProducts(db, id);
    expect(after).toMatchObject({ checkStatus: 'confirmed', benefitScope: 'item', checkedBy: '確認者', checkedAt: JST('2026-11-05T10:00'), sourceUrl: 'https://item.rakuten.co.jp/shop/a1/' });
    expect((await listEvents(db))[0].counts.confirmed).toBe(1);
    // 別のイベントの紐付けとしては更新できない
    const other = await createEvent(db, input(), 'A');
    expect(await updateEventProduct(db, l.id, other, { checkStatus: 'excluded', benefitScope: 'unknown', benefitNote: null, sourceUrl: null, checkedAt: null, note: 'x' }, 'X')).toBe(false);
    expect(await unlinkProduct(db, l.id, other)).toBe(false);
  });

  it('存在しないイベントには紐付けない', async () => {
    expect((await linkProducts(db, 999, [{ personName: '推しA', category: '写真集', productId: 'a1' }])).linked).toBe(0);
  });

  it('商品の検索：人物・カテゴリ・キーワード・公開中だけ／非掲載も・紐付け済みの表示', async () => {
    const id = await createEvent(db, input(), 'A');
    await linkProducts(db, id, [{ personName: '推しA', category: 'CD', productId: 'a3' }]);
    const related = await searchProducts(db, { personNames: ['推しA'], categories: [], keyword: '', includeUnpublished: false, eventId: id });
    expect(related.rows.map((r) => r.productId).sort()).toEqual(['a1', 'a3']);
    expect(related.rows.find((r) => r.productId === 'a3')?.linkedStatus).toBe('needs_check');
    expect(related.rows.find((r) => r.productId === 'a1')).toMatchObject({ itemCode: 'shop:a1', verdict: 'related', linkedStatus: null });
    const all = await searchProducts(db, { personNames: ['推しA'], categories: ['写真集'], keyword: '', includeUnpublished: true });
    expect(all.rows.map((r) => r.productId).sort()).toEqual(['a1', 'a2']);
    // LIKE の記号はそのまま文字として扱う
    expect((await searchProducts(db, { personNames: ['推しA'], categories: [], keyword: '100%_', includeUnpublished: true })).rows.map((r) => r.productId)).toEqual(['a2']);
    expect((await searchProducts(db, { personNames: ['推しA'], categories: [], keyword: '%', includeUnpublished: true })).rows.map((r) => r.productId)).toEqual(['a2']);
    // 複数人物（グループ）
    const group = await searchProducts(db, { personNames: ['推しA', '推しB', '推しC'], categories: ['写真集'], keyword: '写真集', includeUnpublished: false });
    expect(group.rows.map((r) => `${r.personName}:${r.productId}`)).toEqual(['推しA:a1', '推しB:b1']);
    expect((await searchProducts(db, { personNames: [], categories: [], keyword: '', includeUnpublished: true })).rows).toEqual([]);
  });

  it('API確認用の itemCode は商品データから読む', async () => {
    const id = await createEvent(db, input(), 'A');
    await linkProducts(db, id, [{ personName: '推しA', category: '写真集', productId: 'a1' }, { personName: '推しB', category: '写真集', productId: 'b1' }]);
    const links = await listEventProducts(db, id);
    expect(await getLinkedItemCode(db, links.find((l) => l.productId === 'a1')!.id)).toEqual({ itemCode: 'shop:a1', itemUrl: 'https://item.rakuten.co.jp/shop/a1/', affiliateUrl: null, title: '推しA 1st写真集' });
    expect((await getLinkedItemCode(db, links.find((l) => l.productId === 'b1')!.id))?.itemCode).toBeNull();
    expect(await getLinkedItemCode(db, 9999)).toBeNull();
  });

  it('紐付け・確認状態の変更・解除・イベントの削除をしても、products・verdicts は変わらない', async () => {
    const before = await fingerprint();
    const id = await createEvent(db, input(), 'A');
    await linkProducts(db, id, [{ personName: '推しA', category: '写真集', productId: 'a1' }, { personName: '推しA', category: 'CD', productId: 'a3' }]);
    const links = await listEventProducts(db, id);
    await updateEventProduct(db, links[0].id, id, { checkStatus: 'excluded', benefitScope: 'unknown', benefitNote: null, sourceUrl: null, checkedAt: null, note: '理由' }, 'A');
    await unlinkProduct(db, links[1].id, id);
    await searchProducts(db, { personNames: ['推しA'], categories: [], keyword: '', includeUnpublished: true });
    expect(await deleteEvent(db, id)).toBe(true);
    expect(await getEvent(db, id)).toBeNull();
    expect(await listEventProducts(db, id)).toEqual([]);
    expect(await deleteEvent(db, id)).toBe(false);
    expect(await fingerprint()).toEqual(before);
  });

  it('Phase 2：紐付けた商品に itemCode・判定・削除済みを付け、検索結果に紐付けの範囲・確認元・確認日時を付ける', async () => {
    const id = await createEvent(db, input(), 'A');
    await linkProducts(db, id, [{ personName: '推しA', category: '写真集', productId: 'a1' }, { personName: '推しA', category: '写真集', productId: 'a2' }]);
    const links = await listEventProducts(db, id);
    expect(links.find((l) => l.productId === 'a1')).toMatchObject({ itemCode: 'shop:a1', verdict: 'related', missing: false, itemUrl: 'https://item.rakuten.co.jp/shop/a1/' });
    expect(links.find((l) => l.productId === 'a2')).toMatchObject({ itemCode: null, verdict: 'uncertain', missing: false });
    const a1 = links.find((l) => l.productId === 'a1')!;
    await updateEventProduct(db, a1.id, id, { checkStatus: 'confirmed', benefitScope: 'item', benefitNote: null, sourceUrl: 'https://item.rakuten.co.jp/shop/a1/', checkedAt: JST('2026-11-05T10:00'), note: null }, 'A');
    const found = (await searchProducts(db, { personNames: ['推しA'], categories: ['写真集'], keyword: '', includeUnpublished: true, eventId: id })).rows.find((r) => r.productId === 'a1');
    expect(found).toMatchObject({ linkId: a1.id, linkedStatus: 'confirmed', linkedScope: 'item', linkedSourceUrl: 'https://item.rakuten.co.jp/shop/a1/', linkedCheckedAt: JST('2026-11-05T10:00') });
    // 商品データから消えた商品は missing
    await pg.query(`UPDATE products SET items = '[]' WHERE person_name = '推しA' AND category = '写真集'`);
    expect((await listEventProducts(db, id)).every((l) => l.missing)).toBe(true);
  });

  it('Phase 2：API確認用の itemCode は商品データから読む（存在しない商品は含めない）', async () => {
    const t = [{ personName: '推しA', category: '写真集', productId: 'a1' }, { personName: '推しA', category: 'CD', productId: 'a3' }, { personName: '推しB', category: '写真集', productId: 'b1' }, { personName: '推しA', category: '写真集', productId: 'zzz' }];
    const m = await getItemCodesFor(db, t);
    expect(m.get(linkTargetKey(t[0]))).toMatchObject({ itemCode: 'shop:a1', title: '推しA 1st写真集' });
    expect(m.get(linkTargetKey(t[1]))?.itemCode).toBe('shop:a3');
    expect(m.get(linkTargetKey(t[2]))?.itemCode).toBeNull();
    expect(m.has(linkTargetKey(t[3]))).toBe(false);
  });

  it('テーブル未作成のエラーを見分ける', async () => {
    const fresh = new PGliteCtor!();
    const err = await fresh.query('SELECT 1 FROM rakuten_events').catch((e: unknown) => e);
    expect(isMissingEventTable(err)).toBe(true);
    expect(isMissingEventTable(new Error('other'))).toBe(false);
  });

  it('setup-tables：作成後の確認が通り、2回実行しても同じ。空でなければ取り消さない', async () => {
    const pg2 = new PGliteCtor!();
    await pg2.exec(BASE_TABLES);
    const sdb: Db = {
      query: async (t, p = []) => (await pg2.query(t, p)).rows,
      readOnly: (stmts) => pg2.transaction(async (tx) => {
        const out: Record<string, unknown>[][] = [];
        for (const s of stmts) out.push((await tx.query(s.text, s.params ?? [])).rows);
        return out;
      }),
      tx: async (stmts) => { await pg2.transaction(async (tx) => { for (const s of stmts) await tx.query(s.text, s.params ?? []); }); },
    };
    const before = await readState(sdb);
    expect(before.tables).toEqual({ rakuten_events: false, rakuten_event_products: false });
    const stmts = migrationStatements(MIGRATION).map((text) => ({ text }));
    await sdb.tx(stmts);
    await sdb.tx(stmts);
    const after = await readState(sdb);
    expect(verifyProblems(after, before.fingerprint)).toEqual([]);
    expect(undoStatements(after).problems).toEqual([]);
    await pg2.query(`INSERT INTO rakuten_events (name, event_type, starts_at, ends_at) VALUES ('x', 'other', now(), now() + interval '1 day')`);
    expect(undoStatements(await readState(sdb)).problems.length).toBe(1);
  });
});
