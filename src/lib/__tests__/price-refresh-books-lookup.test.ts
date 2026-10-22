import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

// ── 以下の偽物は src/lib/__tests__/price-refresh.test.ts と同じ（DB はメモリ上・OpenAI は呼ばれたら数える）──

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


import { booksSearchKeyword, lookupPricesByCode, matchBooksResult, selectLookupCandidates, type CachedLookup } from '../price-refresh';
import { __resetRakutenApiGateForTests } from '../rakuten-api-gate';

// 楽天ブックスの商品のコード指定（楽天ブックス総合検索APIで商品名検索 → 商品番号が完全一致したものだけ。src/lib/price-refresh.ts）
const PERSON = '上白石萌歌';
const aff = (pageUrl: string) => `https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=${encodeURIComponent(pageUrl)}&m=x`;
function book(num: string, over: Partial<RakutenItem> = {}): RakutenItem {
  return { id: `mn-${num}`, title: `上白石萌歌 作品 ${num}`, price: 2000, reviewCount: 0, reviewAverage: 0, imageUrl: `https://thumbnail.image.rakuten.co.jp/${num}.jpg`,
    itemUrl: aff(`https://item.rakuten.co.jp/book/${num}/`), affiliateUrl: aff(`https://item.rakuten.co.jp/book/${num}/`), category: '写真集', relevanceScore: 0, ...over };
}
const seed = (category: ProductCategory, items: RakutenItem[]) =>
  db.rows.push({ personName: PERSON, category, items: structuredClone(items), fetchedAt: new Date(Date.UTC(2026, 6, 1)) });
const rowItems = (category: ProductCategory) => db.rows.find((r) => r.category === category)?.items ?? [];
const booksItem = (num: string, price: number, availability: string) => ({ Item: { itemUrl: `https://books.rakuten.co.jp/rb/${num}/`, itemPrice: price, availability } });
const okRes = (items: unknown[]) => ({ ok: true, status: 200, json: async () => ({ count: items.length, Items: items }) });
const cands = (items: RakutenItem[], category: ProductCategory = '写真集') => selectLookupCandidates({ [category]: { products: items } }, { nowMs: Date.now(), freshMs: 0, limit: 50 });

describe('検索語（保存中の商品名から作る）', () => {
  it.each([
    ['連続ドラマW 宮部みゆき「ソロモンの偽証」 [ 上白石萌歌 ]', '連続ドラマW 宮部みゆき ソロモンの偽証'],
    ['【先着特典】パンダより恋が苦手な私たち DVD-BOX(オリジナルフォンタブ)', 'パンダより恋が苦手な私たち DVD-BOX'],
    ['映画『子供はわかってあげない』Blu-ray豪華版【Blu-ray】 [ 上白石萌歌 ]', '映画 子供はわかってあげない Blu-ray豪華版'],
    ['上白石萌歌 ～虹とシマウマ～ [ 上白石萌歌 ]', '上白石萌歌 虹とシマウマ'],
    ['本 1', '本'],
  ])('%s → %s', (title, kw) => {
    expect(booksSearchKeyword(title)).toBe(kw);
  });
  it('作れない（記号だけ・1文字の半角だけ）なら null。長い商品名は最大4語・40文字', () => {
    expect(booksSearchKeyword('【特典】 [ ] !')).toBeNull();
    expect(booksSearchKeyword('a b')).toBeNull();
    expect(booksSearchKeyword(undefined)).toBeNull();
    const kw = booksSearchKeyword('あいうえおかきくけこ さしすせそたちつてと なにぬねのはひふへほ まみむめもやゆよらり わをん')!;
    expect(kw.split(' ').length).toBeLessThanOrEqual(4);
    expect(kw.length).toBeLessThanOrEqual(40);
  });
});

describe('照合（商品番号の完全一致だけを採用）', () => {
  const stored = book('18561043');
  it('同じ商品番号で購入できれば価格を返す（在庫あり〜予約受付中 1〜5）', () => {
    for (const a of ['1', '2', '3', '4', '5']) expect(matchBooksResult([booksItem('18561043', 19541, a).Item], stored)).toEqual({ kind: 'found', price: 19541 });
  });
  it('似た商品名の別の版・別の商品だけなら採用しない（mismatched）', () => {
    expect(matchBooksResult([booksItem('18561042', 19000, '1').Item, booksItem('17000000', 6000, '1').Item], stored)).toEqual({ kind: 'mismatched' });
  });
  it('0件なら not_found', () => {
    expect(matchBooksResult([], stored)).toEqual({ kind: 'not_found' });
  });
  it('品切れ・販売終了（空）・メーカーに在庫確認（6）・価格が無いものは購入できると確認できないため反映しない（unavailable）', () => {
    expect(matchBooksResult([booksItem('18561043', 19541, '').Item], stored)).toEqual({ kind: 'unavailable' });
    expect(matchBooksResult([booksItem('18561043', 19541, '6').Item], stored)).toEqual({ kind: 'unavailable' });
    expect(matchBooksResult([booksItem('18561043', 0, '1').Item], stored)).toEqual({ kind: 'unavailable' });
  });
  it('楽天市場の商品（books: でない）には使わない', () => {
    const ichiba = { ...stored, itemUrl: 'https://item.rakuten.co.jp/shop/x/', affiliateUrl: '' };
    expect(matchBooksResult([booksItem('18561043', 19541, '1').Item], ichiba)).toEqual({ kind: 'mismatched' });
  });
});

describe('コード指定の取得（楽天ブックス）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db.rows.length = 0; db.upserts = 0;
    __resetRakutenApiGateForTests();
    process.env.RAKUTEN_APP_ID = 'test-app'; process.env.RAKUTEN_ACCESS_KEY = 'test-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  const urlOf = (i: number) => new URL(String(fetchMock.mock.calls[i][0]));

  it('楽天ブックス総合検索APIを商品名で検索し（品切れも含めて返させる）、一致した商品の価格の項目だけを更新する', async () => {
    const a = book('17184798', { title: '連続ドラマW 宮部みゆき「ソロモンの偽証」 [ 上白石萌歌 ]', price: 12505 });
    seed('写真集', [a]);
    fetchMock.mockResolvedValueOnce(okRes([booksItem('17184798', 13376, '1')]));
    const r = await lookupPricesByCode(PERSON, cands([a]));
    const u = urlOf(0);
    expect(`${u.origin}${u.pathname}`).toBe('https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404');
    expect(u.searchParams.get('keyword')).toBe('連続ドラマW 宮部みゆき ソロモンの偽証');
    expect(u.searchParams.get('outOfStockFlag')).toBe('1');
    expect(u.searchParams.get('itemCode')).toBeNull();
    expect(r).toMatchObject({ attempted: 1, applied: 1, notFound: 0, mismatched: 0, unavailable: 0, stoppedBy: 'done' });
    const [after] = rowItems('写真集');
    expect(after).toEqual({ ...a, price: 13376, priceFetchedAt: expect.any(Number) }); // 商品名・ID・URL・アフィリエイトURL・画像は不変
  });

  it('似た商品名の別の版だけが返ったら更新しない（別商品への誤照合をしない）', async () => {
    const a = book('18561043', { title: '【先着特典】パンダより恋が苦手な私たち DVD-BOX(オリジナルフォンタブ)', price: 19541 });
    seed('写真集', [a]);
    fetchMock.mockResolvedValueOnce(okRes([booksItem('18561042', 15000, '1'), booksItem('18561044', 9000, '1'), booksItem('18000000', 5000, '1')]));
    const r = await lookupPricesByCode(PERSON, cands([a]));
    expect(r).toMatchObject({ applied: 0, mismatched: 1 });
    expect(rowItems('写真集')[0]).toEqual(a);
    expect(db.upserts).toBe(0);
  });

  it('同じ商品番号でも品切れ・販売終了なら価格・取得日時とも変えない', async () => {
    const a = book('16982113', { price: 5104 });
    seed('写真集', [a]);
    fetchMock.mockResolvedValueOnce(okRes([booksItem('16982113', 3980, '')]));
    const r = await lookupPricesByCode(PERSON, cands([a]));
    expect(r).toMatchObject({ applied: 0, unavailable: 1 });
    expect(rowItems('写真集')[0]).toEqual(a);
  });

  it('30%以上の変動は反映せず確認待ちにする（既存のルール）', async () => {
    const a = book('11462860', { price: 2803 });
    seed('写真集', [a]);
    fetchMock.mockResolvedValueOnce(okRes([booksItem('11462860', 1500, '1')]));
    const r = await lookupPricesByCode(PERSON, cands([a]));
    expect(r.applied).toBe(0);
    expect(r.reviews).toEqual([{ category: '写真集', id: a.id, previousPrice: 2803, fetchedPrice: 1500, changeRate: -0.465, reason: 'price_change_30pct' }]);
    expect(rowItems('写真集')[0]).toEqual(a);
  });

  it('429 は再試行せず残りを呼ばずに終了（何も変えない）', async () => {
    const items = [book('1'), book('2')];
    seed('写真集', items);
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
    const r = await lookupPricesByCode(PERSON, cands(items));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.stoppedBy).toBe('rate_limited');
    expect(db.upserts).toBe(0);
  });

  it('503 が3回続いたら終了し、価格は変えない（次回はその商品から取り直す）', async () => {
    const items = [book('1'), book('2'), book('3'), book('4')];
    seed('写真集', items);
    fetchMock.mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } });
    const r = await lookupPricesByCode(PERSON, cands(items));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ stoppedBy: 'upstream_errors', failed: 3 });
    expect(rowItems('写真集')).toEqual(items);
  }, 15000);

  it('検索語が作れない商品は API を呼ばず、変えない', async () => {
    const a = book('5', { title: '【特典】 [ ]' });
    seed('写真集', [a]);
    const r = await lookupPricesByCode(PERSON, cands([a]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ attempted: 0, notFound: 1 });
  });

  it('取得できなかった結果も共有キャッシュに残し、期限内は他の人物の同じ商品で API を呼ばない（価格も変えない）', async () => {
    const m = new Map<string, CachedLookup>();
    const cache = { getMany: async (codes: readonly string[]) => new Map(codes.filter((c) => m.has(c)).map((c) => [c, m.get(c)!])), setMany: async (es: readonly CachedLookup[]) => { es.forEach((e) => m.set(e.itemCode, e)); } };
    const a = book('16982113');
    seed('写真集', [a]);
    fetchMock.mockResolvedValueOnce(okRes([booksItem('16982113', 3980, '')]));
    await lookupPricesByCode(PERSON, cands([a]), { cache });
    expect(m.get('book:16982113')).toMatchObject({ price: 0, status: 'unavailable' });
    const r2 = await lookupPricesByCode(PERSON, cands([a]), { cache });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2).toMatchObject({ attempted: 0, fromCache: 1, applied: 0 });
    expect(rowItems('写真集')[0]).toEqual(a);
  });

  it('楽天市場の商品（数字の itemCode）は従来どおり楽天市場商品検索APIで itemCode 指定', async () => {
    const page = 'https://item.rakuten.co.jp/shop/10001/';
    const it1 = { ...book('x'), id: 'ich-shop:10001', itemUrl: aff(page), affiliateUrl: aff(page), itemCode: 'shop:10001', category: 'グッズ' } as RakutenItem;
    seed('グッズ', [it1]);
    fetchMock.mockResolvedValueOnce(okRes([{ Item: { itemCode: 'shop:10001', itemPrice: 2100 } }]));
    const r = await lookupPricesByCode(PERSON, cands([it1], 'グッズ'));
    const u = urlOf(0);
    expect(`${u.origin}${u.pathname}`).toBe('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
    expect(u.searchParams.get('itemCode')).toBe('shop:10001');
    expect(r.applied).toBe(1);
  });
});
