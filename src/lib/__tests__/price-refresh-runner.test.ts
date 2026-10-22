/**
 * 価格の分割自動更新（src/lib/price-refresh-runner.ts）のテスト。
 *  - OpenAI・AI判定・判定の保存に到達する import 経路が無いこと（ソースを辿って静的に確認。継続的な保証）
 *  - 処理順（途中で止まった人物 → 未完了 → 完了が古い順）、途中再開、実行ロック、時間の枠、再処理の間隔、429・認証情報なしでの停止
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const spies = vi.hoisted(() => ({
  refreshPersonPrices: vi.fn(),
  lookupPricesByCode: vi.fn(),
  selectLookupCandidates: vi.fn(),
  aiJudgeLoaded: false,
  judgmentStoreLoaded: false,
  openaiLoaded: false,
}));
vi.mock('openai', () => { spies.openaiLoaded = true; return { default: vi.fn() }; });
vi.mock('@/lib/ai-judge', () => { spies.aiJudgeLoaded = true; return {}; });
vi.mock('@/lib/judgment-store', () => { spies.judgmentStoreLoaded = true; return {}; });
vi.mock('@/lib/price-refresh', () => ({
  refreshPersonPrices: spies.refreshPersonPrices,
  lookupPricesByCode: spies.lookupPricesByCode,
  selectLookupCandidates: spies.selectLookupCandidates,
  lookupCodeOf: (p: { id: string }) => (p.id.startsWith('bk-') ? `book:${p.id.slice(3)}` : null),
}));
const storeSpies = vi.hoisted(() => ({ getAllStoredProducts: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
  getAllStoredProducts: storeSpies.getAllStoredProducts,
  listPersonsWithProducts: vi.fn().mockResolvedValue([]),
  productIdentityKey: (p: { id: string; itemUrl?: string }) => (p.itemUrl ? `key:${p.id}` : ''),
}));
vi.mock('@/db/write', () => ({ upsertProduct: storeSpies.upsert }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/db/client', () => ({ neonSql: Object.assign(vi.fn().mockResolvedValue([]), { query: vi.fn().mockResolvedValue([]) }), db: {} }));
// 楽天APIの呼び出し回数（テストでは数を直接動かす）
const gateSpies = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/rakuten-api-gate', () => ({ rakutenApiCallCount: () => gateSpies.calls }));

import { runPriceRefreshBatch, orderPersons, createMemoryStateStore, planPriceRefresh, fingerprintDiff, type PersonFingerprint } from '../price-refresh-runner';
import type { PersonWithConfig } from '@/types/person';

const P = (name: string): PersonWithConfig => ({ name, group: '', genre: '坂道', config: {} });
const okCategory = (updated = 1) => ({ personName: '', categories: [{ category: 'x', status: 'updated', updated }], updated, newCandidates: 0, identityMismatches: 0, fetchFailed: 0, remaining: [], configMissing: false });

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  clock = 1_000_000;
  for (const f of [spies.refreshPersonPrices, spies.lookupPricesByCode, spies.selectLookupCandidates]) f.mockReset();
  // 1カテゴリ処理するごとに10秒進む
  spies.refreshPersonPrices.mockImplementation(async () => { clock += 10_000; return okCategory(); });
  spies.selectLookupCandidates.mockReturnValue([]);
  spies.lookupPricesByCode.mockResolvedValue({ attempted: 0, applied: 0, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'done' });
  storeSpies.getAllStoredProducts.mockReset().mockResolvedValue({});
  storeSpies.upsert.mockReset();
});

describe('OpenAI への経路が無い（静的な import の確認）', () => {
  const SRC = path.resolve(__dirname, '..', '..');
  const resolveImport = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else return null; // 外部パッケージ（openai 等）は名前で判定
    for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) if (fs.existsSync(cand)) return cand;
    return null;
  };
  const reachable = (entry: string) => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        const r = resolveImport(file, spec);
        if (r) walk(r); else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec);
      }
    };
    walk(entry);
    return { files: [...seen].map((f) => path.relative(SRC, f)), packages };
  };

  it.each(['lib/price-refresh-runner.ts', 'lib/price-refresh.ts', '../scripts/price-refresh/run.ts'])('%s から ai-judge・judgment-store・openai に到達しない', (entry) => {
    const { files, packages } = reachable(path.join(SRC, entry));
    expect(files).not.toContain('lib/ai-judge.ts');
    expect(files).not.toContain('lib/judgment-store.ts');
    expect(files).not.toContain('lib/batch-processor.ts');
    expect([...packages]).not.toContain('openai');
  });

  it('実行時にも OpenAI・AI判定・判定の保存のモジュールは読み込まれない', async () => {
    const store = createMemoryStateStore();
    await runPriceRefreshBatch({ budgetMs: 60_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(spies.openaiLoaded).toBe(false);
    expect(spies.aiJudgeLoaded).toBe(false);
    expect(spies.judgmentStoreLoaded).toBe(false);
  });
});

describe('処理順', () => {
  it('途中で止まった人物 → 一度も完了していない人物 → 完了が古い順', () => {
    const order = orderPersons(['done-new', 'never', 'done-old', 'stopped'], {
      'done-new': { completedAt: 300, startedAt: 290 },
      'done-old': { completedAt: 100, startedAt: 90 },
      stopped: { completedAt: 50, startedAt: 400, nextCategory: 3 },
    });
    expect(order).toEqual(['stopped', 'never', 'done-old', 'done-new']);
  });
});

describe('分割実行と途中再開', () => {
  it('時間の枠を過ぎたら次の作業に進まず、次回は止まったカテゴリから再開する', async () => {
    const store = createMemoryStateStore();
    // 1回目：25秒の枠 → 3カテゴリ（30秒）目の途中で枠を超え、3カテゴリで止まる
    const r1 = await runPriceRefreshBatch({ budgetMs: 25_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r1.stoppedBy).toBe('budget');
    expect(r1.persons[0].completed).toBe(false);
    expect(store.states.a.nextCategory).toBe(3);
    // 2回目：続きの4カテゴリ目から
    spies.refreshPersonPrices.mockClear();
    const r2 = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    const cats = spies.refreshPersonPrices.mock.calls.map((c) => c[1][0]);
    expect(cats).toEqual(['グッズ', 'CD', '中古']);
    expect(r2.persons[0].completed).toBe(true);
    expect(store.states.a.completedAt).toBeDefined();
  });

  it('完了した人物は、再処理の間隔（既定1日）が過ぎるまで処理しない', async () => {
    const store = createMemoryStateStore({ a: { completedAt: clock - 1000, startedAt: clock - 5000 } });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a'), P('b')], relatedIdsOf: async () => new Set() });
    expect(r.persons.map((p) => p.name)).toEqual(['b']);
  });

  it('1回の人数の上限', async () => {
    const store = createMemoryStateStore();
    const r = await runPriceRefreshBatch({ budgetMs: 10_000_000, maxPersons: 2, store, now, persons: [P('a'), P('b'), P('c')], relatedIdsOf: async () => new Set() });
    expect(r.persons).toHaveLength(2);
    expect(r.stoppedBy).toBe('max_persons');
  });

  it('カテゴリ検索を終えた人物だけ、公開中の商品のコード指定の取得を行う（上限件数・公開中の商品IDを渡す）', async () => {
    const store = createMemoryStateStore();
    spies.selectLookupCandidates.mockReturnValue([{ code: 'book:1' }]);
    spies.lookupPricesByCode.mockResolvedValue({ attempted: 1, applied: 1, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'done' });
    const related = new Set(['bk-1']);
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, lookupPerPerson: 50, store, now, persons: [P('a')], relatedIdsOf: async () => related });
    expect(spies.selectLookupCandidates).toHaveBeenCalledWith({}, expect.objectContaining({ limit: 50, onlyIds: related }));
    expect(r.lookupApplied).toBe(1);
    expect(r.persons[0].completed).toBe(true);
  });

  it('コード指定が時間切れで途中なら未完了のまま（次回はカテゴリ検索を飛ばしてコード指定から）', async () => {
    const store = createMemoryStateStore();
    spies.lookupPricesByCode.mockResolvedValue({ attempted: 5, applied: 5, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'deadline' });
    await runPriceRefreshBatch({ budgetMs: 600_000, lookupPerPerson: 50, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(store.states.a.completedAt).toBeUndefined();
    expect(store.states.a.nextCategory).toBe(6);
    spies.refreshPersonPrices.mockClear();
    spies.lookupPricesByCode.mockResolvedValue({ attempted: 1, applied: 1, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'done' });
    await runPriceRefreshBatch({ budgetMs: 600_000, lookupPerPerson: 50, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(spies.refreshPersonPrices).not.toHaveBeenCalled();
    expect(store.states.a.completedAt).toBeDefined();
  });
});

describe('停止と排他', () => {
  it('実行ロック：同時に2つは動かない', async () => {
    const store = createMemoryStateStore();
    await store.acquireLock('other', 60_000);
    const r = await runPriceRefreshBatch({ budgetMs: 60_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r.status).toBe('locked');
    expect(spies.refreshPersonPrices).not.toHaveBeenCalled();
  });

  it('処理中に例外が出てもロックを外す', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockRejectedValueOnce(new Error('timeout'));
    await expect(runPriceRefreshBatch({ budgetMs: 60_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() })).rejects.toThrow('timeout');
    expect(await store.acquireLock('next', 1000)).toBe(true);
    expect(store.states.a.startedAt).toBeDefined(); // 途中で止まった人物として次回は先頭
  });

  it('429 を受けたらその回は終了（再試行しない）', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockImplementationOnce(async () => ({ ...okCategory(0), categories: [{ category: '写真集', status: 'fetch_failed', httpStatus: 429, updated: 0 }] }));
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a'), P('b')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).toBe('rate_limited');
    expect(spies.refreshPersonPrices).toHaveBeenCalledTimes(1);
    expect(r.persons[0].completed).toBe(false);
  });

  it('楽天APIの認証情報が無ければ終了', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockResolvedValueOnce({ ...okCategory(0), configMissing: true });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r.status).toBe('config_missing');
  });

  it('進み具合の保存先（Redis）が無ければ何もしない', async () => {
    const r = await runPriceRefreshBatch({ budgetMs: 60_000, now, persons: [P('a')] });
    expect(r.status).toBe('no_state_store');
    expect(spies.refreshPersonPrices).not.toHaveBeenCalled();
  });
});

describe('手動テストモード（人物の指定）', () => {
  it('指定した人物だけ処理し、再処理の間隔は無視する', async () => {
    const store = createMemoryStateStore({ b: { completedAt: clock - 1000, startedAt: clock - 5000 } });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a'), P('b'), P('c')], onlyPersons: ['b'], relatedIdsOf: async () => new Set() });
    expect(r.persons.map((p) => p.name)).toEqual(['b']);
  });
});

describe('dry-run（planPriceRefresh）', () => {
  it('読み取りだけで、対象人物・カテゴリ・推定API回数・コード指定の候補・DB更新対象の行数を返す（楽天API・DB書き込み・進み具合の保存なし）', async () => {
    const item = (id: string, itemUrl = 'https://books.rakuten.co.jp/rb/1/') => ({ id, title: id, price: 1, reviewCount: 0, reviewAverage: 0, imageUrl: '', itemUrl, affiliateUrl: '', category: 'CD', relevanceScore: 0 });
    storeSpies.getAllStoredProducts.mockImplementation(async (name: string) => name === 'a'
      ? { CD: { products: [item('bk-1'), item('bk-2'), item('mn-3'), item('ic-4', 'https://item.rakuten.co.jp/s/x/'), item('ic-5', '')] }, 写真集: { products: [item('bk-1')] } }
      : {});
    spies.selectLookupCandidates.mockReturnValue([{ code: 'book:1' }, { code: 'book:2' }, { code: 'book:1' }]);
    const fetchSpy = vi.spyOn(global, 'fetch');
    // 見積もりは軽い項目だけを読む（ここでは同じデータを渡す）
    const plan = await planPriceRefresh({ persons: [P('a'), P('b')], relatedIdsOf: async () => new Set(['bk-1', 'bk-2', 'ic-4', 'ic-5']), lightItemsOf: storeSpies.getAllStoredProducts });
    expect(plan.persons.map((p) => p.name)).toEqual(['a', 'b']);
    expect(plan.persons[0]).toMatchObject({ categories: 2, searchCallsMin: 6, searchCallsMax: 24, storedItems: 6, manualItems: 1, lookupCandidates: 3, lookupUniqueCodes: 2, searchOnlyRelated: 1, unidentifiableRelated: 1 });
    expect(plan.dbRowsToUpdate).toBe(2);
    expect(spies.refreshPersonPrices).not.toHaveBeenCalled();
    expect(spies.lookupPricesByCode).not.toHaveBeenCalled();
    expect(storeSpies.upsert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('自動停止（価格以外の変更を検知）', () => {
  const fp = (hash = 'h', vhash = 'v', count = 3): PersonFingerprint => ({ products: { CD: { count, hash } }, verdicts: { count: 10, hash: vhash } });

  it('指紋の差：判定・件数・価格以外の項目／並びの変化を見つける', () => {
    expect(fingerprintDiff(fp(), fp())).toEqual([]);
    expect(fingerprintDiff(fp(), fp('h', 'v2'))).toEqual(['判定（verdicts）が変わった']);
    expect(fingerprintDiff(fp(), fp('h', 'v', 4))).toEqual(['CD: 商品件数が変わった（3→4）']);
    expect(fingerprintDiff(fp(), fp('h2'))).toEqual(['CD: 価格以外の項目または並びが変わった']);
    expect(fingerprintDiff(fp(), { products: {}, verdicts: fp().verdicts })).toEqual(['CD: カテゴリ行の有無が変わった']);
  });

  it('処理後に価格以外が変わっていたら、停止の印を記録してその場で終了する（次の人物に進まない）', async () => {
    const store = createMemoryStateStore();
    let calls = 0;
    const fingerprintOf = async () => (++calls === 2 ? fp('changed') : fp());
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a'), P('b')], relatedIdsOf: async () => new Set(), fingerprintOf });
    expect(r.status).toBe('halted');
    expect(r.halt).toMatchObject({ person: 'a', reasons: ['CD: 価格以外の項目または並びが変わった'] });
    expect(store.halt).not.toBeNull();
    expect(r.persons.map((p) => p.name)).toEqual(['a']);
    expect(store.states.a.completedAt).toBeUndefined();
  });

  it('停止の印がある間は、手動・定期とも何もしない（印を消すまで）', async () => {
    const store = createMemoryStateStore();
    await store.setHalt({ at: 1, person: 'a', reasons: ['x'] });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], onlyPersons: ['a'], relatedIdsOf: async () => new Set() });
    expect(r.status).toBe('halted');
    expect(spies.refreshPersonPrices).not.toHaveBeenCalled();
  });

  it('価格だけが変わった場合（指紋が同じ）は停止しない', async () => {
    const store = createMemoryStateStore();
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set(), fingerprintOf: async () => fp() });
    expect(r.status).toBe('ok');
    expect(r.persons[0].completed).toBe(true);
  });
});

describe('管理画面用の記録（直近の結果・実行の要約）', () => {
  it('取得できなかったカテゴリ（503 等）を人物の直近の結果と実行の要約に残す（保存済みの商品は変更しない）', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => {
      clock += 10_000;
      if (cats[0] === '本・雑誌') return { ...okCategory(0), categories: [{ category: '本・雑誌', status: 'fetch_failed', httpStatus: 503, updated: 0 }] };
      return okCategory(2);
    });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], onlyPersons: ['a'], relatedIdsOf: async () => new Set() });
    expect(r.persons[0].failedCategories).toEqual([{ category: '本・雑誌', status: 'fetch_failed', httpStatus: 503 }]);
    const last = store.states.a.last!;
    expect(last.failedCategories).toEqual([{ category: '本・雑誌', status: 'fetch_failed', httpStatus: 503 }]);
    expect(last.updated).toBe(10); // 503 以外の5カテゴリ×2件
    expect(last.completed).toBe(true);
    expect(store.lastRun).toMatchObject({ manualTest: true, status: 'ok', persons: 1, completed: 1, updated: 10, failedCategories: 1 });
  });

  it('時間切れで途中の人物も、続きの位置を保ったまま直近の結果を残す', async () => {
    const store = createMemoryStateStore();
    await runPriceRefreshBatch({ budgetMs: 25_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(store.states.a.nextCategory).toBe(3);
    expect(store.states.a.last).toMatchObject({ completed: false, categories: 3, updated: 3, failedCategories: [] });
  });

  it('ロック中・停止中で何もしなかった回は、実行の要約を上書きしない', async () => {
    const store = createMemoryStateStore();
    await store.setHalt({ at: 1, person: 'x', reasons: ['テスト'] });
    await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(store.lastRun).toBeNull();
  });

  it('自動停止した人物は、直近の結果に halted を残す', async () => {
    const store = createMemoryStateStore();
    let n = 0;
    const fp = async () => ({ products: { CD: { count: 1, hash: n++ === 0 ? 'before' : 'after' } }, verdicts: { count: 0, hash: '' } });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set(), fingerprintOf: fp });
    expect(r.status).toBe('halted');
    expect(store.states.a.last).toMatchObject({ halted: true, completed: false });
    expect(store.lastRun).toMatchObject({ status: 'halted', persons: 1 });
  });
});

describe('楽天のエラーが続いたらその回を終える（原因と位置を記録）', () => {
  const fail = (category: string, httpStatus?: number, status = 'fetch_failed') =>
    ({ ...okCategory(0), categories: [{ category, status, httpStatus, updated: 0 }] });

  it('503 等が3回続いたら（人物をまたいでも）その回を終え、原因と位置を記録し、失敗したカテゴリは次回取り直す', async () => {
    const store = createMemoryStateStore();
    // a：写真集 503、本・雑誌 503 → b：写真集 503 で3回目
    spies.refreshPersonPrices.mockImplementation(async (p: { name: string }, cats: string[]) => {
      clock += 10_000;
      if (p.name === 'a' && cats[0] === '写真集') return fail('写真集', 503);
      if (p.name === 'a' && cats[0] === '本・雑誌') return fail('本・雑誌', 503);
      if (p.name === 'a') return { ...okCategory(0), categories: [{ category: cats[0], status: 'no_existing', updated: 0 }] };
      return fail('写真集', 503);
    });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a'), P('b'), P('c')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).toBe('upstream_errors');
    expect(r.stopDetail).toEqual({ person: 'b', category: '写真集', reasons: ['写真集: 503', '本・雑誌: 503', '写真集: 503'] });
    expect(r.persons.map((p) => p.name)).toEqual(['a', 'b']); // c には進まない
    expect(store.states.b.nextCategory).toBe(0); // 失敗した写真集から取り直す
    expect(store.states.b.completedAt).toBeUndefined();
    expect(store.states.b.last).toMatchObject({ completed: false, stop: { person: 'b', category: '写真集' } });
    expect(store.lastRun?.stopDetail?.person).toBe('b');
  });

  it('途中で取得できたカテゴリがあれば数え直す（503 が2回→成功→503 では止めない）', async () => {
    const store = createMemoryStateStore();
    const seq = [503, 503, 0, 503];
    let k = 0;
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => {
      clock += 10_000;
      const s = seq[k++] ?? 0;
      return s ? fail(cats[0], s) : okCategory(1);
    });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).not.toBe('upstream_errors');
    expect(r.persons[0].failedCategories).toHaveLength(3);
  });

  it('保存の失敗（db_error）・通信エラーも数える', async () => {
    const store = createMemoryStateStore();
    const seq: [number | undefined, string][] = [[undefined, 'db_error'], [undefined, 'fetch_failed'], [500, 'fetch_failed']];
    let k = 0;
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => { clock += 10_000; const [h, st] = seq[k++]; return fail(cats[0], h, st); });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).toBe('upstream_errors');
    expect(r.stopDetail?.reasons).toEqual(['写真集: 保存失敗', '本・雑誌: 通信エラー', 'Blu-ray・DVD: 500']);
  });

  it('429 は1回で終え、失敗したカテゴリは次回取り直す（位置を記録）', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => { clock += 10_000; return cats[0] === '本・雑誌' ? fail('本・雑誌', 429) : okCategory(1); });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).toBe('rate_limited');
    expect(r.stopDetail).toEqual({ person: 'a', category: '本・雑誌', reasons: ['本・雑誌: 429'] });
    expect(store.states.a.nextCategory).toBe(1);
  });

  it('コード指定の取得で 503 等が続いて止まった場合も、その回を終えて位置を記録する', async () => {
    const store = createMemoryStateStore();
    spies.selectLookupCandidates.mockReturnValue([{ code: 'book:1' }]);
    spies.lookupPricesByCode.mockResolvedValue({ attempted: 3, fromCache: 0, applied: 0, notFound: 0, mismatched: 0, failed: 3, stoppedBy: 'upstream_errors', errors: ['503', '503', '503'] });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, lookupPerPerson: 10, store, now, persons: [P('a'), P('b')], relatedIdsOf: async () => new Set() });
    expect(r.stoppedBy).toBe('upstream_errors');
    expect(r.stopDetail).toEqual({ person: 'a', category: 'コード指定', reasons: ['コード指定: 503', 'コード指定: 503', 'コード指定: 503'] });
    expect(r.persons.map((p) => p.name)).toEqual(['a']);
    expect(spies.lookupPricesByCode.mock.calls[0][2]).toMatchObject({ maxConsecutiveFailures: 3 });
  });
});

describe('related の商品だけを更新・30%以上の変動は確認対象として記録', () => {
  it('判定が related の商品IDを価格更新に渡す（判定は読むだけ）', async () => {
    const store = createMemoryStateStore();
    const related = new Set(['bk-1', 'bk-2']);
    await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => related });
    for (const call of spies.refreshPersonPrices.mock.calls) expect(call[2]).toMatchObject({ eligibleIds: related });
  });

  it('確認対象（商品ID・変更前の価格・取得した価格・変動率・理由）を人物の直近の結果と実行の要約に残す', async () => {
    const store = createMemoryStateStore();
    const review = { category: '中古', id: 'ic-used-box', previousPrice: 43027, fetchedPrice: 28059, changeRate: -0.348, reason: 'price_change_30pct' };
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => {
      clock += 10_000;
      return cats[0] === '中古' ? { ...okCategory(0), reviews: [review] } : okCategory(1);
    });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], onlyPersons: ['a'], relatedIdsOf: async () => new Set(['ic-used-box']) });
    // 楽天から価格を取得した日時つき（承認時に priceFetchedAt にする）
    expect(r.persons[0].priceReviews).toEqual([{ ...review, fetchedAt: expect.any(Number) }]);
    expect(store.states.a.last?.priceReviews).toEqual([{ ...review, fetchedAt: expect.any(Number) }]);
    expect(store.lastRun?.priceReviews).toBe(1);
    expect(r.persons[0].completed).toBe(true); // 確認対象があっても処理は完了（保存済みの商品は変えない）
  });

  it('記録する確認対象は人物ごとに上限まで（Redis の容量を抑える）', async () => {
    const store = createMemoryStateStore();
    const many = Array.from({ length: 80 }, (_, i) => ({ category: 'CD', id: `x-${i}`, previousPrice: 1000, fetchedPrice: 2000, changeRate: 1, reason: 'price_change_30pct' }));
    spies.refreshPersonPrices.mockImplementation(async () => { clock += 10_000; return { ...okCategory(0), reviews: many.slice(0, 20) }; });
    await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], relatedIdsOf: async () => new Set() });
    expect(store.states.a.last?.priceReviews).toHaveLength(50);
  });

  it('確認対象を受け取り箱にも残す（次の処理で人物の直近の結果が上書きされても、管理画面が DB に取り込めるように）', async () => {
    const store = createMemoryStateStore();
    const review = { category: '中古', id: 'ic-used-box', previousPrice: 43027, fetchedPrice: 28059, changeRate: -0.348, reason: 'price_change_30pct' };
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => {
      clock += 10_000;
      return cats[0] === '中古' ? { ...okCategory(0), reviews: [review] } : okCategory(1);
    });
    await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], onlyPersons: ['a'], relatedIdsOf: async () => new Set(['ic-used-box']) });
    const entries = Object.entries(store.reviewInbox);
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe(JSON.stringify(['a', '中古', 'ic-used-box', 43027, 28059]));
    expect(entries[0][1]).toEqual({ person: 'a', ...review, fetchedAt: expect.any(Number) });
  });

  it('受け取り箱への保存に失敗しても価格更新は続ける（人物の直近の結果には残る）', async () => {
    const store = createMemoryStateStore();
    store.addReviews = async () => { throw new Error('redis down'); };
    const review = { category: 'CD', id: 'x-1', previousPrice: 1000, fetchedPrice: 2000, changeRate: 1, reason: 'price_change_30pct' };
    spies.refreshPersonPrices.mockImplementation(async () => { clock += 10_000; return { ...okCategory(0), reviews: [review] }; });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, store, now, persons: [P('a')], onlyPersons: ['a'], relatedIdsOf: async () => new Set(['x-1']) });
    expect(r.persons[0].completed).toBe(true);
    expect(store.states.a.last?.priceReviews?.length).toBeGreaterThan(0);
  });
});

describe('DB の読み込みの削減と1回の上限', () => {
  const ALL = { 写真集: { items: 1, eligible: 1 }, '本・雑誌': { items: 1, eligible: 1 }, 'Blu-ray・DVD': { items: 1, eligible: 1 }, グッズ: { items: 1, eligible: 1 }, CD: { items: 1, eligible: 1 }, 中古: { items: 1, eligible: 1 } };
  beforeEach(() => {
    gateSpies.calls = 0;
    // 1カテゴリの検索で楽天APIを3回使う
    spies.refreshPersonPrices.mockImplementation(async () => { clock += 10_000; gateSpies.calls += 3; return okCategory(1); });
  });

  it('人物の全商品は読まない（カテゴリの要約と、コード指定の候補だけを読む）', async () => {
    const store = createMemoryStateStore();
    const summaryOf = vi.fn(async () => ALL);
    const lookupItemsOf = vi.fn(async () => ({}));
    await runPriceRefreshBatch({ budgetMs: 600_000, lookupPerPerson: 10, store, now, persons: [P('a')], relatedIdsOf: async () => new Set(['bk-1']), categorySummaryOf: summaryOf, lookupItemsOf });
    expect(storeSpies.getAllStoredProducts).not.toHaveBeenCalled();
    expect(summaryOf).toHaveBeenCalledTimes(1);
    expect(lookupItemsOf).toHaveBeenCalledWith('a', expect.any(Number), 10);
    for (const call of spies.refreshPersonPrices.mock.calls) expect(call[2]).toMatchObject({ summary: ALL });
  });

  it('楽天APIの回数の上限：次のカテゴリで超えうるなら始めず、次回は止まったカテゴリから続ける', async () => {
    const store = createMemoryStateStore();
    const opts = { budgetMs: 600_000, maxApiCalls: 20, store, now, persons: [P('a')], relatedIdsOf: async () => new Set<string>(), categorySummaryOf: async () => ALL };
    const r1 = await runPriceRefreshBatch(opts);
    // 0+12, 3+12, 6+12 は20以下で開始、9+12=21 は超えるので4カテゴリ目を始めない
    expect(spies.refreshPersonPrices).toHaveBeenCalledTimes(3);
    expect(r1.stoppedBy).toBe('max_api_calls');
    expect(r1.persons[0].completed).toBe(false);
    expect(store.states.a.nextCategory).toBe(3);
    expect(r1.usage).toMatchObject({ apiCalls: 9 });
    expect(store.states.a.last?.usage).toMatchObject({ apiCalls: 9 });
    expect(store.lastRun?.usage).toMatchObject({ apiCalls: 9 });
    spies.refreshPersonPrices.mockClear();
    const r2 = await runPriceRefreshBatch(opts);
    expect(spies.refreshPersonPrices.mock.calls.map((c) => c[1][0])).toEqual(['グッズ', 'CD', '中古']);
    expect(r2.persons[0].completed).toBe(true);
  });

  it('カテゴリ数の上限：上限まで検索したら次の人物・カテゴリに進まない（続きは次回）', async () => {
    const store = createMemoryStateStore();
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, maxCategories: 4, store, now, persons: [P('a'), P('b')], relatedIdsOf: async () => new Set<string>(), categorySummaryOf: async () => ALL });
    expect(spies.refreshPersonPrices).toHaveBeenCalledTimes(4);
    expect(r.stoppedBy).toBe('max_categories');
    expect(r.persons.map((p) => p.name)).toEqual(['a']);
    expect(store.states.a.nextCategory).toBe(4);
  });

  it('対象の無いカテゴリ（商品なし・related なし）は上限の数に入れない', async () => {
    const store = createMemoryStateStore();
    const summary = { ...ALL, 写真集: { items: 0, eligible: 0 }, '本・雑誌': { items: 5, eligible: 0 } };
    spies.refreshPersonPrices.mockImplementation(async (_p, cats: string[]) => { clock += 1000; if (summary[cats[0] as keyof typeof summary].eligible > 0) gateSpies.calls += 3; return okCategory(0); });
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, maxCategories: 4, store, now, persons: [P('a')], relatedIdsOf: async () => new Set<string>(), categorySummaryOf: async () => summary });
    expect(r.persons[0].completed).toBe(true); // 検索するのは4カテゴリだけなので上限内で完了
  });

  it('コード指定が楽天APIの回数の上限で途中になったら未完了（次回はコード指定から）', async () => {
    const store = createMemoryStateStore();
    spies.refreshPersonPrices.mockImplementation(async () => { clock += 1000; return okCategory(0); }); // 検索は0回
    spies.selectLookupCandidates.mockReturnValue(Array.from({ length: 20 }, (_, i) => ({ code: `book:${i}` })));
    spies.lookupPricesByCode.mockImplementation(async (_n, cands: unknown[]) => { gateSpies.calls += cands.length; return { attempted: cands.length, fromCache: 0, applied: cands.length, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'done', reviews: [] }; });
    // 上限14回：人物の開始時は 0+12≦14 で開始。検索は0回なので、コード指定は残りの14件まで（候補20件のうち）
    const r = await runPriceRefreshBatch({ budgetMs: 600_000, maxApiCalls: 14, lookupPerPerson: 20, store, now, persons: [P('a')], relatedIdsOf: async () => new Set<string>(), categorySummaryOf: async () => ({}), lookupItemsOf: async () => ({}) });
    expect(spies.lookupPricesByCode.mock.calls[0][1]).toHaveLength(14);
    expect(r.stoppedBy).toBe('max_api_calls');
    expect(r.persons[0].completed).toBe(false);
    expect(store.states.a.nextCategory).toBe(6);
  });
});
