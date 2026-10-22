/**
 * 価格更新専用モード（src/lib/price-refresh.ts）と、商品の保存（mergeProductItems）の安全性テスト。
 *  - OpenAI API の呼び出しが必ず0回（OpenAI クライアント・AI判定・判定保存をすべてモックして数える）
 *  - 判定（verdicts）・掲載状態を変更しない、既存に無い商品を追加しない
 *  - 今回取得できた商品だけ価格と価格の取得日時（priceFetchedAt）を更新
 *  - 楽天の商品コードが違う場合は別商品として更新しない、アフィリエイトURLを保護
 *  - 楽天APIのエラー・429・タイムアウト・0件、途中停止、OpenAI キーなし
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

// ── OpenAI・AI判定・判定保存（呼ばれたら数える。factory が実行された＝モジュールが読み込まれた）──
const spies = vi.hoisted(() => ({
  openaiConstructed: 0,
  openaiCreate: vi.fn(),
  judgeProducts: vi.fn(),
  saveVerdict: vi.fn(),
  getAllVerdicts: vi.fn(),
  aiJudgeLoaded: false,
  judgmentStoreLoaded: false,
}));
vi.mock('openai', () => ({
  default: vi.fn(() => { spies.openaiConstructed++; return { chat: { completions: { create: spies.openaiCreate } } }; }),
}));
vi.mock('@/lib/ai-judge', () => {
  spies.aiJudgeLoaded = true;
  return { judgeProducts: spies.judgeProducts, shouldAutoApprove: () => false, PROMPT_VERSION: 'v3' };
});
vi.mock('@/lib/judgment-store', () => {
  spies.judgmentStoreLoaded = true;
  return { saveVerdict: spies.saveVerdict, getAllVerdicts: spies.getAllVerdicts };
});

// ── 楽天API ──
const rakuten = vi.hoisted(() => ({ getProductsByCategory: vi.fn() }));
vi.mock('@/lib/rakuten', () => rakuten);

// ── DB（products 行をメモリ上で再現）──
const db = vi.hoisted(() => ({ rows: [] as { personName: string; category: string; items: RakutenItem[]; fetchedAt: Date }[], upserts: 0, failOnUpsert: 0 }));
vi.mock('@/db/write', () => ({
  upsertProduct: vi.fn(async (personName: string, category: string, items: RakutenItem[], fetchedAt: number) => {
    db.upserts++;
    if (db.failOnUpsert && db.upserts >= db.failOnUpsert) throw new Error('db down');
    const row = db.rows.find((r) => r.personName === personName && r.category === category);
    if (row) { row.items = structuredClone(items); row.fetchedAt = new Date(fetchedAt); }
    else db.rows.push({ personName, category, items: structuredClone(items), fetchedAt: new Date(fetchedAt) });
  }),
  // 価格更新専用モードの保存（既存行の UPDATE だけ。行が無ければ何もしない）
  updateProductItemsOnly: vi.fn(async (personName: string, category: string, items: RakutenItem[], fetchedAt: number) => {
    db.upserts++;
    if (db.failOnUpsert && db.upserts >= db.failOnUpsert) throw new Error('db down');
    const row = db.rows.find((r) => r.personName === personName && r.category === category);
    if (!row) return false;
    row.items = structuredClone(items); row.fetchedAt = new Date(fetchedAt);
    return true;
  }),
  insertWorkStatusHistory: vi.fn(),
  hasIdempotencyKey: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => structuredClone(db.rows) }) }) },
  neonSql: vi.fn(),
}));

import { refreshPersonPrices } from '../price-refresh';
import { productIdentityKey } from '../product-store';

const PERSON = { name: '梅澤美波', group: '乃木坂46', config: {} };
const OLD = Date.UTC(2026, 6, 1);

const aff = (pageUrl: string) => `https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=${encodeURIComponent(pageUrl)}&m=x`;
function ichiba(id: string, shop: string, code: string, over: Partial<RakutenItem> = {}): RakutenItem {
  const page = `https://item.rakuten.co.jp/${shop}/${code}/`;
  return { id, title: `商品 ${code}`, price: 1000, reviewCount: 0, reviewAverage: 0, imageUrl: `https://thumbnail.image.rakuten.co.jp/${code}.jpg`,
    itemUrl: aff(page), affiliateUrl: aff(page), itemCode: `${shop}:${code}`, category: 'グッズ', relevanceScore: 0, ...over };
}
function book(num: string, over: Partial<RakutenItem> = {}): RakutenItem {
  return { id: `bk-${num}`, title: `本 ${num}`, price: 1500, reviewCount: 0, reviewAverage: 0, imageUrl: `https://thumbnail.image.rakuten.co.jp/${num}.jpg`,
    itemUrl: `https://books.rakuten.co.jp/rb/${num}/`, affiliateUrl: aff(`https://books.rakuten.co.jp/rb/${num}/`), category: '写真集', relevanceScore: 0, ...over };
}
const seed = (category: ProductCategory, items: RakutenItem[]) =>
  db.rows.push({ personName: PERSON.name, category, items: structuredClone(items), fetchedAt: new Date(OLD) });
const rowItems = (category: ProductCategory) => db.rows.find((r) => r.category === category)?.items ?? [];
const ok = (products: RakutenItem[]) => ({ status: 'ok' as const, products });

beforeEach(() => {
  db.rows = []; db.upserts = 0; db.failOnUpsert = 0;
  spies.openaiConstructed = 0;
  for (const s of [spies.openaiCreate, spies.judgeProducts, spies.saveVerdict, spies.getAllVerdicts, rakuten.getProductsByCategory]) s.mockReset();
  rakuten.getProductsByCategory.mockResolvedValue({ status: 'empty' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function expectNoOpenAiNoVerdicts() {
  expect(spies.openaiConstructed).toBe(0);
  expect(spies.openaiCreate).not.toHaveBeenCalled();
  expect(spies.judgeProducts).not.toHaveBeenCalled();
  expect(spies.saveVerdict).not.toHaveBeenCalled();
  expect(spies.getAllVerdicts).not.toHaveBeenCalled();
}

describe('価格更新専用モード：OpenAI API を一切使わない', () => {
  it('AI判定・判定保存・OpenAI のモジュール自体を読み込まない（呼び出し経路が無い）', async () => {
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    rakuten.getProductsByCategory.mockResolvedValue(ok([ichiba('ich-s1:a', 's1', 'a', { price: 1200 })]));
    await refreshPersonPrices(PERSON);
    expect(spies.aiJudgeLoaded).toBe(false);
    expect(spies.judgmentStoreLoaded).toBe(false);
    expectNoOpenAiNoVerdicts();
  });

  it('OPENAI_API_KEY が無い環境でも動く（呼び出し0回）', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    seed('写真集', [book('111')]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === '写真集' ? ok([book('111', { price: 1650 })]) : { status: 'empty' }));
    const r = await refreshPersonPrices(PERSON);
    expect(r.updated).toBe(1);
    expect(rowItems('写真集')[0].price).toBe(1650);
    expectNoOpenAiNoVerdicts();
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });

  it('判定履歴の無い既存商品・古いAI判定版の商品・手動 unrelated の商品が再取得されても、AI も判定の変更も行わない', async () => {
    // 判定は price-refresh から一切参照されない（verdicts の内容に関係なく同じ動作）
    seed('グッズ', [ichiba('ich-s1:no-verdict', 's1', 'no-verdict'), ichiba('ic-legacyshopid000000000', 's2', 'old-ai'), ichiba('mn-manual1', 's3', 'manual-unrelated')]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => cat === 'グッズ'
      ? ok([ichiba('ich-s1:no-verdict', 's1', 'no-verdict', { price: 900 }), ichiba('ich-s2:old-ai', 's2', 'old-ai', { price: 800 }), ichiba('ich-s3:manual-unrelated', 's3', 'manual-unrelated', { price: 750 })])
      : { status: 'empty' });
    const r = await refreshPersonPrices(PERSON);
    expectNoOpenAiNoVerdicts();
    expect(r.updated).toBe(3);
    const ids = rowItems('グッズ').map((p) => p.id).sort();
    expect(ids).toEqual(['ic-legacyshopid000000000', 'ich-s1:no-verdict', 'mn-manual1']); // IDは変わらない（判定はIDに付いたまま）
  });
});

describe('価格更新専用モード：保存の内容', () => {
  it('価格だけ変わった：価格と priceFetchedAt を更新し、ID・アフィリエイトURL・件数は変わらない', async () => {
    const before = ichiba('ich-s1:a', 's1', 'a');
    seed('グッズ', [before]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === 'グッズ' ? ok([ichiba('ich-s1:a', 's1', 'a', { price: 1100 })]) : { status: 'empty' }));
    const t0 = Date.now();
    await refreshPersonPrices(PERSON);
    const [after] = rowItems('グッズ');
    expect(rowItems('グッズ')).toHaveLength(1);
    expect(after).toMatchObject({ id: before.id, price: 1100, affiliateUrl: before.affiliateUrl, itemUrl: before.itemUrl, title: before.title });
    expect(after.priceFetchedAt).toBeGreaterThanOrEqual(t0);
  });

  it('商品名・画像・アフィリエイトURLが楽天側で変わっていても、価格更新では変えない（価格の項目だけ。Task 112）', async () => {
    const before = ichiba('ich-s1:a', 's1', 'a');
    seed('グッズ', [before]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === 'グッズ'
      ? ok([ichiba('ich-s1:a', 's1', 'a', { title: '新しい商品名', imageUrl: 'https://thumbnail.image.rakuten.co.jp/new.jpg', affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/zzz/?pc=x', price: 1234 })]) : { status: 'empty' }));
    await refreshPersonPrices(PERSON);
    const [after] = rowItems('グッズ');
    expect(after).toMatchObject({ title: before.title, imageUrl: before.imageUrl, affiliateUrl: before.affiliateUrl, itemUrl: before.itemUrl, price: 1234 });
  });

  it('並び順・件数・価格以外の項目（レビュー数・平均を含む）は変わらない（同じ商品の別の並びで返ってきても）', async () => {
    const items = [book('1'), book('2'), book('3', { id: 'mn-3', title: '手動' })];
    seed('写真集', items);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === '写真集'
      ? ok([book('3', { price: 1400, reviewCount: 50, reviewAverage: 4.5 }), book('1', { price: 1600, reviewCount: 7, reviewAverage: 3 })]) : { status: 'empty' }));
    await refreshPersonPrices(PERSON);
    const after = rowItems('写真集');
    expect(after.map((p) => p.id)).toEqual(['bk-1', 'bk-2', 'mn-3']);
    // 変わってよいのは price・priceFetchedAt だけ（レビュー数・平均は人物ページの自動の並び順に使うため変えない）
    const strip = (p: RakutenItem) => { const { price, priceFetchedAt, ...rest } = p; return rest; };
    expect(after.map(strip)).toEqual(items.map(strip));
    expect(after.map((p) => p.price)).toEqual([1600, 1500, 1400]);
  });

  it('楽天APIから返ってこなかった商品：価格も priceFetchedAt も変更しない', async () => {
    const kept = ichiba('ich-s1:kept', 's1', 'kept', { price: 500, priceFetchedAt: OLD });
    const noDate = ichiba('ich-s1:nodate', 's1', 'nodate', { price: 600 });
    seed('グッズ', [kept, noDate, ichiba('ich-s1:back', 's1', 'back')]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === 'グッズ' ? ok([ichiba('ich-s1:back', 's1', 'back', { price: 1100 })]) : { status: 'empty' }));
    const r = await refreshPersonPrices(PERSON);
    const items = rowItems('グッズ');
    expect(items.find((p) => p.id === kept.id)).toEqual(kept);
    expect(items.find((p) => p.id === noDate.id)).toEqual(noDate); // 取得日時を推測で付けない
    expect(items.find((p) => p.id === 'ich-s1:back')!.priceFetchedAt).toBeDefined();
    expect(r.categories.find((c) => c.category === 'グッズ')).toMatchObject({ updated: 1, notReturned: 2 });
  });

  it('既存に無い商品は追加しない（新規商品の発見は別処理）', async () => {
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === 'グッズ'
      ? ok([ichiba('ich-s1:a', 's1', 'a'), ichiba('ich-s9:new', 's9', 'new')]) : { status: 'empty' }));
    const r = await refreshPersonPrices(PERSON);
    expect(rowItems('グッズ').map((p) => p.id)).toEqual(['ich-s1:a']);
    expect(r.newCandidates).toBe(1);
  });

  it('保存済み商品が無いカテゴリは楽天APIを呼ばず、行も作らない', async () => {
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    await refreshPersonPrices(PERSON);
    expect(rakuten.getProductsByCategory).toHaveBeenCalledTimes(1);
    expect(db.rows).toHaveLength(1);
  });

  it.each([
    ['楽天APIエラー（500）', { status: 'upstream_error', httpStatus: 500 }],
    ['429', { status: 'upstream_error', httpStatus: 429 }],
    ['タイムアウト・ネットワーク障害', { status: 'error' }],
    ['0件', { status: 'empty' }],
  ])('%s：保存しない（既存データ・取得日時はそのまま）', async (_label, res) => {
    const before = ichiba('ich-s1:a', 's1', 'a', { priceFetchedAt: OLD });
    seed('グッズ', [before]);
    rakuten.getProductsByCategory.mockResolvedValue(res);
    await refreshPersonPrices(PERSON);
    expect(db.upserts).toBe(0);
    expect(rowItems('グッズ')).toEqual([before]);
    expect(db.rows[0].fetchedAt.getTime()).toBe(OLD);
  });

  it('楽天APIの認証情報なし：そこで終了し、何も保存しない', async () => {
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    seed('写真集', [book('1')]);
    rakuten.getProductsByCategory.mockResolvedValue({ status: 'config_missing' });
    const r = await refreshPersonPrices(PERSON);
    expect(rakuten.getProductsByCategory).toHaveBeenCalledTimes(1);
    expect(db.upserts).toBe(0);
    expect(r.categories.at(-1)!.status).toBe('config_missing');
  });

  it('途中で停止した：停止前に保存したカテゴリ以外は変更されない', async () => {
    seed('写真集', [book('1')]);
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => {
      if (cat === '写真集') return ok([book('1', { price: 1700 })]);
      throw new Error('function timeout');
    });
    await expect(refreshPersonPrices(PERSON)).rejects.toThrow('function timeout');
    expect(rowItems('写真集')[0].price).toBe(1700);
    expect(rowItems('グッズ')[0].price).toBe(1000);
    expect(rowItems('グッズ')[0].priceFetchedAt).toBeUndefined();
  });

  it('保存に失敗したカテゴリは db_error として続行し、他のカテゴリは処理する', async () => {
    seed('写真集', [book('1')]);
    seed('グッズ', [ichiba('ich-s1:a', 's1', 'a')]);
    db.failOnUpsert = 1;
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) =>
      cat === '写真集' ? ok([book('1', { price: 1700 })]) : cat === 'グッズ' ? ok([ichiba('ich-s1:a', 's1', 'a', { price: 999 })]) : { status: 'empty' });
    const r = await refreshPersonPrices(PERSON);
    expect(r.categories.find((c) => c.category === '写真集')!.status).toBe('db_error');
  });
});

import { lookupCodeOf, selectLookupCandidates, lookupPricesByCode } from '../price-refresh';
import { __resetRakutenApiGateForTests } from '../rakuten-api-gate';
import { withPriceFreshness } from '../price-freshness';

describe('手動登録の商品（mn-）の価格更新（カテゴリ検索）', () => {
  it('同じ商品（楽天の同一性キーが一致）なら価格の項目だけ更新し、ID・商品名・URL・アフィリエイトURLは変えない', async () => {
    const manual = book('555', { id: 'mn-abc', title: '手動で付けた商品名', affiliateUrl: 'https://a.r10.to/manual', itemUrl: 'https://books.rakuten.co.jp/rb/555/' });
    seed('写真集', [manual]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === '写真集'
      ? ok([book('555', { title: '楽天の商品名', price: 1650, reviewCount: 9, reviewAverage: 4.2 })]) : { status: 'empty' }));
    await refreshPersonPrices(PERSON);
    const [after] = rowItems('写真集');
    expect(after).toMatchObject({ id: 'mn-abc', title: '手動で付けた商品名', affiliateUrl: 'https://a.r10.to/manual', itemUrl: manual.itemUrl, price: 1650, reviewCount: 0, reviewAverage: 0 });
    expect(after.priceFetchedAt).toBeDefined();
    expectNoOpenAiNoVerdicts();
  });
});

describe('コード指定の取得', () => {
  it('取得用のコード：楽天ブックスは book:<番号>、楽天市場は保存済みの API itemCode だけ（URLの商品コードからは作らない）', () => {
    expect(lookupCodeOf(book('123'))).toBe('book:123');
    expect(lookupCodeOf(ichiba('ich-shop:10001', 'shop', '10001', { itemCode: 'shop:10001' }))).toBe('shop:10001');
    expect(lookupCodeOf(ichiba('ic-x', 'shop', 'srcl-9039', { itemCode: undefined }))).toBeNull();
    expect(lookupCodeOf({ itemUrl: 'https://a.r10.to/x', affiliateUrl: 'https://a.r10.to/x' })).toBeNull();
  });

  it('候補：取得日時が不明な商品が先、その後は古い順。最近取得した商品・公開中でない商品は除く', () => {
    const NOW = Date.UTC(2026, 9, 20);
    const stored = { '写真集': { products: [
      book('1', { priceFetchedAt: NOW - 10 * 86400000 }), book('2'), book('3', { priceFetchedAt: NOW - 3600000 }), book('4', { priceFetchedAt: NOW - 20 * 86400000 }), book('5'),
    ] } };
    const list = selectLookupCandidates(stored, { nowMs: NOW, freshMs: 3 * 86400000, limit: 10, onlyIds: new Set(['bk-1', 'bk-2', 'bk-3', 'bk-4']) });
    expect(list.map((c) => c.item.id)).toEqual(['bk-2', 'bk-4', 'bk-1']);
  });

  describe('取得と反映', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      __resetRakutenApiGateForTests();
      process.env.RAKUTEN_APP_ID = 'test-app'; process.env.RAKUTEN_ACCESS_KEY = 'test-key';
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });
    const api = (itemCode: string, price: number) => ({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode, itemPrice: price, reviewCount: 3, reviewAverage: 4 } }] }) });

    it('返ってきた itemCode が一致した商品だけ価格の項目を更新（カテゴリ行の再検索日時・ID・商品名・URLは変えない）。0件・不一致は変更しない', async () => {
      const a = book('1', { id: 'mn-1', title: '手動の名前' }), b = book('2'), c = book('3', { priceFetchedAt: OLD, price: 999 });
      seed('写真集', [a, b, c]);
      fetchMock
        .mockResolvedValueOnce(api('book:1', 1800))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [] }) })
        .mockResolvedValueOnce(api('book:999', 5000));
      const stored = { '写真集': { products: [a, b, c] } };
      const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates(stored, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
      expect(r).toMatchObject({ attempted: 3, applied: 1, notFound: 1, mismatched: 1, stoppedBy: 'done' });
      const items = rowItems('写真集');
      expect(items.find((p) => p.id === 'mn-1')).toMatchObject({ title: '手動の名前', price: 1800, itemUrl: a.itemUrl, affiliateUrl: a.affiliateUrl });
      expect(items.find((p) => p.id === 'bk-2')).toEqual(b);
      expect(items.find((p) => p.id === 'bk-3')).toEqual(c);
      expect(db.rows[0].fetchedAt.getTime()).toBe(OLD); // カテゴリの再検索日時は変えない
      expectNoOpenAiNoVerdicts();
    }, 15000);

    it('429 は再試行せず、残りは呼ばずに終了', async () => {
      seed('写真集', [book('1'), book('2')]);
      fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
      const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ '写真集': { products: [book('1'), book('2')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r.stoppedBy).toBe('rate_limited');
      expect(db.upserts).toBe(0);
    });

    it('503 等が3回続いたら残りは呼ばずに終了し、取得できなかった商品の価格は変えない', async () => {
      seed('写真集', [book('1'), book('2'), book('3'), book('4')]);
      fetchMock.mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } });
      const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ '写真集': { products: [book('1'), book('2'), book('3'), book('4')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(r).toMatchObject({ stoppedBy: 'upstream_errors', failed: 3, errors: ['503', '503', '503'] });
      expect(db.upserts).toBe(0);
      expect(rowItems('写真集').map((i) => i.price)).toEqual([1500, 1500, 1500, 1500]);
    });

    it('503 の後に取得できれば数え直す（503→成功→503→503 では止めない）', async () => {
      seed('写真集', [book('1'), book('2'), book('3'), book('4')]);
      const err = { ok: false, status: 503, headers: { get: () => null } };
      fetchMock.mockResolvedValueOnce(err).mockResolvedValueOnce(api('book:2', 1800)).mockResolvedValueOnce(err).mockResolvedValueOnce(err);
      const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ '写真集': { products: [book('1'), book('2'), book('3'), book('4')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(r.stoppedBy).toBe('done');
      expect(r.failed).toBe(3);
      expect(r.applied).toBe(1);
    });

    it('取得の間に保存済みの商品が別の商品に変わっていたら反映しない（保存直前の同一性の確認）', async () => {
      seed('写真集', [book('1')]);
      const candidates = selectLookupCandidates({ '写真集': { products: [book('1')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 });
      db.rows[0].items = [book('777', { id: 'bk-1' })]; // 同じIDで別の商品番号
      fetchMock.mockResolvedValueOnce(api('book:1', 1800));
      const r = await lookupPricesByCode(PERSON.name, candidates);
      expect(r.applied).toBe(0);
      expect(rowItems('写真集')[0].price).toBe(1500);
    });
  });
});

describe('価格の表示モード', () => {
  const NOW = Date.UTC(2026, 9, 20);
  it('legacy（既定）：取得日時不明の商品は従来どおり価格を出す（日付なし）。分かる商品は日付つき・古ければ出さない', () => {
    expect(withPriceFreshness(book('1'), NOW, 'legacy')).toMatchObject({ priceStale: false, priceDateLabel: undefined });
    expect(withPriceFreshness(book('1', { priceFetchedAt: NOW - 86400000 }), NOW, 'legacy')).toMatchObject({ priceStale: false, priceDateLabel: '10/19時点' });
    expect(withPriceFreshness(book('1', { priceFetchedAt: NOW - 60 * 86400000 }), NOW, 'legacy').priceStale).toBe(true);
  });
  it('strict：取得日時不明の商品も価格を出さない', () => {
    expect(withPriceFreshness(book('1'), NOW, 'strict')).toMatchObject({ priceStale: true, priceDateLabel: undefined });
  });
});

describe('コード指定の共有キャッシュ（同じ商品が複数の人物に保存されている場合）', () => {
  beforeEach(() => {
    __resetRakutenApiGateForTests();
    process.env.RAKUTEN_APP_ID = 'test-app'; process.env.RAKUTEN_ACCESS_KEY = 'test-key';
  });
  const memCache = () => {
    const m = new Map<string, import('../price-refresh').CachedLookup>();
    return { m, cache: { getMany: async (codes: readonly string[]) => new Map(codes.filter((c) => m.has(c)).map((c) => [c, m.get(c)!])), setMany: async (es: readonly import('../price-refresh').CachedLookup[]) => { es.forEach((e) => m.set(e.itemCode, e)); } } };
  };

  it('期限内のキャッシュがあれば楽天APIを呼ばず、取得日時はキャッシュの値（実際に取得した日時）をそのまま使う', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    seed('CD', [book('9', { category: 'CD' })]);
    const { m, cache } = memCache();
    const fetchedAt = Date.now() - 3600_000;
    m.set('book:9', { itemCode: 'book:9', price: 1700, fetchedAt });
    const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ CD: { products: [book('9')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }), { cache });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ attempted: 0, fromCache: 1, applied: 1 });
    expect(rowItems('CD')[0]).toMatchObject({ price: 1700, priceFetchedAt: fetchedAt });
  });

  it('期限切れ・別コードのキャッシュは使わず楽天APIで取得し、結果をキャッシュに保存する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: 'book:9', itemPrice: 1900 } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    seed('CD', [book('9', { category: 'CD' })]);
    const { m, cache } = memCache();
    m.set('book:9', { itemCode: 'book:9', price: 1, fetchedAt: Date.now() - 10 * 86400000 });
    const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ CD: { products: [book('9')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }), { cache, cacheMaxAgeMs: 3 * 86400000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.applied).toBe(1);
    expect(m.get('book:9')!.price).toBe(1900);
  });

  it('同じ実行で同じコードが複数カテゴリにあっても楽天APIは1回', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: 'book:9', itemPrice: 1900 } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    seed('CD', [book('9', { category: 'CD' })]);
    seed('写真集', [book('9')]);
    const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ CD: { products: [book('9')] }, 写真集: { products: [book('9')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ attempted: 1, fromCache: 1, applied: 2 });
  });
});

describe('更新の対象は related の商品だけ・30%以上の変動は確認対象', () => {
  // 成田凌の中古商品と同じ値（43,027円 → 28,059円、約34.8%下がる）
  const USED = () => ichiba('ic-used-box', 'usedshop', '10001', { price: 43027, category: '中古' });

  it('30%の境界：+29.9%・-29.9% は反映、+30%・-30% 以上と前回の価格が無いものは確認対象', async () => {
    const { priceChangeReview } = await import('../product-store');
    expect(priceChangeReview('a', 1000, 1299)).toBeNull();
    expect(priceChangeReview('a', 1000, 701)).toBeNull();
    expect(priceChangeReview('a', 1000, 1300)).toMatchObject({ reason: 'price_change_30pct', changeRate: 0.3 });
    expect(priceChangeReview('a', 1000, 700)).toMatchObject({ reason: 'price_change_30pct', changeRate: -0.3 });
    expect(priceChangeReview('a', 0, 500)).toMatchObject({ reason: 'no_previous_price', changeRate: null });
    expect(priceChangeReview('a', undefined, 500)).toMatchObject({ reason: 'no_previous_price' });
  });

  it('43,027円 → 28,059円の中古商品は反映せず確認対象（価格・取得日時・他の項目とも変えない）', async () => {
    const before = USED();
    seed('中古', [before]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === '中古' ? ok([ichiba('ic-used-box', 'usedshop', '10001', { price: 28059 })]) : { status: 'empty' }));
    const r = await refreshPersonPrices(PERSON, undefined, { eligibleIds: new Set(['ic-used-box']) });
    expect(rowItems('中古')[0]).toEqual(before);
    expect(r.updated).toBe(0);
    expect(r.reviews).toEqual([{ category: '中古', id: 'ic-used-box', previousPrice: 43027, fetchedPrice: 28059, changeRate: -0.348, reason: 'price_change_30pct' }]);
    expect(db.upserts).toBe(0); // 反映する商品が無ければ保存しない（カテゴリ行の fetched_at も変えない）
  });

  it('related でない商品（unrelated・判定なし）は楽天の結果に含まれても変えない。related だけ更新', async () => {
    const rel = ichiba('ich-s1:rel', 's1', 'rel');
    const unrel = ichiba('ich-s1:unrel', 's1', 'unrel');
    seed('グッズ', [rel, unrel]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === 'グッズ'
      ? ok([ichiba('ich-s1:rel', 's1', 'rel', { price: 1100 }), ichiba('ich-s1:unrel', 's1', 'unrel', { price: 1100 })]) : { status: 'empty' }));
    const r = await refreshPersonPrices(PERSON, undefined, { eligibleIds: new Set(['ich-s1:rel']) });
    const items = rowItems('グッズ');
    expect(items.find((p) => p.id === 'ich-s1:rel')).toMatchObject({ price: 1100 });
    expect(items.find((p) => p.id === 'ich-s1:rel')!.priceFetchedAt).toBeDefined();
    expect(items.find((p) => p.id === 'ich-s1:unrel')).toEqual(unrel);
    expect(r.categories.find((c) => c.category === 'グッズ')).toMatchObject({ updated: 1, notEligible: 1, newCandidates: 0 });
    expectNoOpenAiNoVerdicts();
  });

  it('related の商品が無いカテゴリは楽天APIを呼ばない', async () => {
    seed('グッズ', [ichiba('ich-s1:unrel', 's1', 'unrel')]);
    const r = await refreshPersonPrices(PERSON, undefined, { eligibleIds: new Set() });
    expect(rakuten.getProductsByCategory).not.toHaveBeenCalled();
    expect(r.categories.find((c) => c.category === 'グッズ')).toMatchObject({ status: 'no_eligible', notEligible: 1 });
  });

  it('カテゴリ行の fetched_at が新しくなっても、確認対象・取得失敗の商品は次回も確認される（商品ごとの取得日時で判断）', async () => {
    const ok1 = ichiba('ich-s1:ok', 's1', 'ok');
    seed('中古', [ok1, USED()]);
    const rows = () => ok([ichiba('ich-s1:ok', 's1', 'ok', { price: 1050 }), ichiba('ic-used-box', 'usedshop', '10001', { price: 28059 })]);
    rakuten.getProductsByCategory.mockImplementation(async (_n: string, _g: string, cat: string) => (cat === '中古' ? rows() : { status: 'empty' }));
    const eligibleIds = new Set(['ich-s1:ok', 'ic-used-box']);
    const r1 = await refreshPersonPrices(PERSON, undefined, { eligibleIds });
    expect(r1.updated).toBe(1);
    expect(db.rows.find((x) => x.category === '中古')!.fetchedAt.getTime()).toBeGreaterThan(OLD); // 1件反映したので行の日時は新しい
    expect(rowItems('中古').find((p) => p.id === 'ic-used-box')!.priceFetchedAt).toBeUndefined();
    // 2回目：行の日時に関係なく、確認対象の商品は再び取得・判定される（自動では反映されない）
    const r2 = await refreshPersonPrices(PERSON, undefined, { eligibleIds });
    expect(r2.reviews.map((x) => x.id)).toEqual(['ic-used-box']);
    expect(rowItems('中古').find((p) => p.id === 'ic-used-box')).toMatchObject({ price: 43027 });
    // コード指定の候補（商品ごとの取得日時が無い・古い商品）にも残る
    expect(selectLookupCandidates({ '中古': { products: rowItems('中古') } }, { nowMs: Date.now(), freshMs: 3 * 86400000, limit: 10, onlyIds: eligibleIds }).map((c) => c.item.id)).toContain('ic-used-box');
  });

  it('API エラー時は既存の価格を保持する（related でも変えない）', async () => {
    const before = ichiba('ich-s1:rel', 's1', 'rel', { price: 1000 });
    seed('グッズ', [before]);
    rakuten.getProductsByCategory.mockResolvedValue({ status: 'upstream_error', httpStatus: 503 });
    const r = await refreshPersonPrices(PERSON, undefined, { eligibleIds: new Set(['ich-s1:rel']) });
    expect(rowItems('グッズ')[0]).toEqual(before);
    expect(r.categories.find((c) => c.category === 'グッズ')).toMatchObject({ status: 'fetch_failed', httpStatus: 503 });
  });

  describe('コード指定の取得でも30%以上は確認対象', () => {
    beforeEach(() => {
      __resetRakutenApiGateForTests();
      process.env.RAKUTEN_APP_ID = 'test-app'; process.env.RAKUTEN_ACCESS_KEY = 'test-key';
    });
    it('取得価格が前回から30%以上変わる商品は反映しない（reviews に入る）', async () => {
      seed('写真集', [book('1'), book('2')]);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: 'book:1', itemPrice: 900 } }] }) }) // -40%
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: 'book:2', itemPrice: 1600 } }] }) }); // +6.7%
      vi.stubGlobal('fetch', fetchMock);
      const r = await lookupPricesByCode(PERSON.name, selectLookupCandidates({ '写真集': { products: [book('1'), book('2')] } }, { nowMs: Date.now(), freshMs: 0, limit: 10 }));
      expect(r.applied).toBe(1);
      expect(r.reviews).toEqual([{ category: '写真集', id: 'bk-1', previousPrice: 1500, fetchedPrice: 900, changeRate: -0.4, reason: 'price_change_30pct' }]);
      expect(rowItems('写真集').map((p) => p.price)).toEqual([1500, 1600]);
      expect(rowItems('写真集')[0].priceFetchedAt).toBeUndefined();
    });
  });
});
