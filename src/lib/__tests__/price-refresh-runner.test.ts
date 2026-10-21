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
vi.mock('@/db/client', () => ({ neonSql: vi.fn().mockResolvedValue([]), db: {} }));

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
    const plan = await planPriceRefresh({ persons: [P('a'), P('b')], relatedIdsOf: async () => new Set(['bk-1', 'bk-2', 'ic-4', 'ic-5']) });
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
