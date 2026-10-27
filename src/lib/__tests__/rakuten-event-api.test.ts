import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 楽天イベント管理の API（/api/admin/rakuten-events）と、商品1件の楽天API確認（src/lib/rakuten-event/item-check.ts）。
// DB・楽天API は偽物。未ログイン・不正な Origin・不正な入力では何もしない。API の結果で確認状態を変えない。
const spies = vi.hoisted(() => ({
  createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), linkProducts: vi.fn(), updateEventProduct: vi.fn(),
  searchProducts: vi.fn(), getLinkedItemCode: vi.fn(), checkRakutenItem: vi.fn(),
}));
vi.mock('@/db/client', () => ({ neonSql: {}, db: {} }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'] }));
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: async () => [{ name: '推しA', group: 'G1' }, { name: '推しB', group: 'G1' }, { name: '推しC', group: 'G2' }, { name: '推しD', group: 'G2' }],
}));
vi.mock('@/lib/group-membership-store', () => ({
  getAllMembershipRecords: async () => [{ personName: '推しD', groupName: 'G1', activityStatus: 'active', joinedAt: null, leftAt: null, note: null }],
}));
vi.mock('@/lib/rakuten-event/store', async () => {
  const actual = await vi.importActual<typeof import('../rakuten-event/store')>('../rakuten-event/store');
  return {
    MAX_LINK_PER_REQUEST: actual.MAX_LINK_PER_REQUEST, isMissingEventTable: actual.isMissingEventTable,
    neonEventDb: () => ({}), getEvent: vi.fn(), listEventProducts: vi.fn(), unlinkProduct: vi.fn(),
    createEvent: spies.createEvent, updateEvent: spies.updateEvent, deleteEvent: spies.deleteEvent, linkProducts: spies.linkProducts,
    updateEventProduct: spies.updateEventProduct, searchProducts: spies.searchProducts, getLinkedItemCode: spies.getLinkedItemCode,
  };
});
vi.mock('@/lib/rakuten-event/item-check', async () => {
  const actual = await vi.importActual<typeof import('../rakuten-event/item-check')>('../rakuten-event/item-check');
  return { ITEM_CHECK_MESSAGE: actual.ITEM_CHECK_MESSAGE, checkRakutenItem: spies.checkRakutenItem };
});

import { POST } from '../../app/api/admin/rakuten-events/route';
import { createSessionToken, SESSION_COOKIE } from '../session';

const SECRET = 'test-secret-not-real-0123456789abcdefghij';
const ORIGIN = 'https://oshi-search.jp';
const event = {
  name: '楽天お買い物マラソン', eventType: 'marathon', startsAt: '2026-11-04T20:00', endsAt: '2026-11-11T01:59',
  officialUrl: 'https://event.rakuten.co.jp/campaign/', entryRequired: 'required', visibility: 'hidden',
};

function req(b: unknown, o: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'oshi-search.jp' };
  if (o.cookie) headers.cookie = `${SESSION_COOKIE}=${o.cookie}`;
  if (o.origin) headers.origin = o.origin;
  return new NextRequest('https://oshi-search.jp/api/admin/rakuten-events', { method: 'POST', headers, body: JSON.stringify(b) });
}

describe('楽天イベント管理 API', () => {
  let token = '';
  const call = (b: unknown) => POST(req(b, { cookie: token, origin: ORIGIN }));
  beforeEach(async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', SECRET);
    token = await createSessionToken(SECRET);
    Object.values(spies).forEach((s) => s.mockReset());
    spies.createEvent.mockResolvedValue(1);
    spies.searchProducts.mockResolvedValue({ rows: [], truncated: false });
    spies.linkProducts.mockResolvedValue({ linked: 1, skipped: 0 });
    spies.updateEventProduct.mockResolvedValue(true);
  });

  it('未ログイン・不正なセッション・不正な Origin では何もしない', async () => {
    expect((await POST(req({ action: 'create', event, operator: 'A' }, { origin: ORIGIN }))).status).toBe(401);
    expect((await POST(req({ action: 'create', event, operator: 'A' }, { cookie: 'garbage', origin: ORIGIN }))).status).toBe(401);
    expect((await POST(req({ action: 'create', event, operator: 'A' }, { cookie: token, origin: 'https://evil.example' }))).status).toBe(403);
    expect(spies.createEvent).not.toHaveBeenCalled();
  });

  it('登録：入力を検証してから保存（操作者名が必要・不正な日時は保存しない）', async () => {
    expect((await call({ action: 'create', event })).status).toBe(400);
    expect((await call({ action: 'create', event: { ...event, endsAt: '2026-11-01T00:00' }, operator: 'A' })).status).toBe(400);
    expect(spies.createEvent).not.toHaveBeenCalled();
    const res = await call({ action: 'create', event, operator: 'A' });
    expect(res.status).toBe(200);
    expect(spies.createEvent.mock.calls[0][1].endsAt).toBe(Date.UTC(2026, 10, 10, 16, 59));
  });

  it('更新の競合は 409（保存しない）', async () => {
    spies.updateEvent.mockResolvedValue('conflict');
    expect((await call({ action: 'update', id: 1, expectedUpdatedAt: 1, event, operator: 'A' })).status).toBe(409);
  });

  it('確認済みには公式の確認元URLが必要（無ければ保存しない）', async () => {
    const link = { checkStatus: 'confirmed', benefitScope: 'item', checkedAt: '2026-11-05T10:00' };
    expect((await call({ action: 'update_link', eventId: 1, linkId: 2, link, operator: 'A' })).status).toBe(400);
    expect((await call({ action: 'update_link', eventId: 1, linkId: 2, link: { ...link, sourceUrl: 'https://hb.afl.rakuten.co.jp/hgc/x' }, operator: 'A' })).status).toBe(400);
    expect(spies.updateEventProduct).not.toHaveBeenCalled();
    expect((await call({ action: 'update_link', eventId: 1, linkId: 2, link: { ...link, sourceUrl: 'https://item.rakuten.co.jp/shop/a/' }, operator: 'A' })).status).toBe(200);
  });

  it('商品の検索：グループは所属履歴のメンバーも含む・人物優先・カテゴリは既存の値だけ', async () => {
    await call({ action: 'search', groupName: 'G1', categories: ['写真集', 'DROP TABLE'], keyword: 'x' });
    expect(spies.searchProducts.mock.calls[0][1]).toMatchObject({ personNames: ['推しA', '推しB', '推しD'], categories: ['写真集'], includeUnpublished: false });
    await call({ action: 'search', personName: '推しC', groupName: 'G1', categories: [] });
    expect(spies.searchProducts.mock.calls[1][1].personNames).toEqual(['推しC']);
    expect((await call({ action: 'search', categories: [] })).status).toBe(400);
  });

  it('紐付けは50件まで', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ personName: '推しA', category: '写真集', productId: `p${i}` }));
    expect((await call({ action: 'link', eventId: 1, items })).status).toBe(400);
    expect(spies.linkProducts).not.toHaveBeenCalled();
  });

  it('楽天APIで確認：取得できなくても確認状態を変えない（表示用の結果だけ返す）', async () => {
    spies.getLinkedItemCode.mockResolvedValue({ itemCode: 'shop:a1', itemUrl: null });
    spies.checkRakutenItem.mockResolvedValue({ code: 'not_found' });
    const res = await call({ action: 'check_item', eventId: 1, linkId: 2 });
    const data = await res.json();
    expect(data).toMatchObject({ ok: false, code: 'not_found' });
    expect(data.message).toMatch(/対象外とは判断していません/);
    expect(spies.updateEventProduct).not.toHaveBeenCalled();
  });

  it('エラー文（秘密を含みうる）は返さない。テーブル未作成は 503 で案内', async () => {
    spies.createEvent.mockRejectedValueOnce(Object.assign(new Error('postgres://user:secret@host failed'), { code: 'XX000' }));
    const res = await call({ action: 'create', event, operator: 'A' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    spies.createEvent.mockRejectedValueOnce(Object.assign(new Error('relation "rakuten_events" does not exist'), { code: '42P01' }));
    expect((await call({ action: 'create', event, operator: 'A' })).status).toBe(503);
  });
});

describe('商品1件の楽天API確認（item-check）', () => {
  beforeEach(() => {
    vi.stubEnv('RAKUTEN_APP_ID', 'app-id-not-real');
    vi.stubEnv('RAKUTEN_ACCESS_KEY', 'access-key-not-real');
    vi.stubEnv('VERCEL', '');
  });
  const deps = { redis: null, now: () => Date.now(), sleep: async () => {}, intervalMs: 0, log: () => {} };
  const okFetch = (item: Record<string, unknown> | null, status = 200) => vi.fn(async () => new Response(JSON.stringify({ Items: item ? [{ Item: item }] : [] }), { status }));

  it('2026-07-01版のエンドポイントを itemCode・在庫切れも含めて1回だけ呼び、商品別ポイント倍率などを返す', async () => {
    const { checkRakutenItem } = await vi.importActual<typeof import('../rakuten-event/item-check')>('../rakuten-event/item-check');
    const f = okFetch({ itemCode: 'shop:a1', itemName: '写真集', itemPrice: 3000, availability: 1, pointRate: 5, pointRateStartTime: '2026-11-04 20:00', pointRateEndTime: '2026-11-11 01:59' });
    const r = await checkRakutenItem('shop:a1', deps, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/IchibaItem/Search/20260701?');
    expect(url).toContain('itemCode=shop%3Aa1');
    expect(url).toContain('availability=0');
    expect(r).toMatchObject({ code: 'ok', info: { pointRate: 5, pointRateEndTime: '2026-11-11 01:59', itemPrice: 3000, availability: 1 } });
  });

  it('別の商品が返った・0件は not_found、429 は rate_limited、itemCode なしは呼ばない', async () => {
    const { checkRakutenItem } = await vi.importActual<typeof import('../rakuten-event/item-check')>('../rakuten-event/item-check');
    expect((await checkRakutenItem('shop:a1', deps, okFetch({ itemCode: 'shop:zz' }) as unknown as typeof fetch)).code).toBe('not_found');
    expect((await checkRakutenItem('shop:a1', deps, okFetch(null) as unknown as typeof fetch)).code).toBe('not_found');
    expect((await checkRakutenItem('shop:a2', deps, okFetch(null, 429) as unknown as typeof fetch)).code).toBe('rate_limited');
    const f = okFetch(null);
    expect((await checkRakutenItem(null, deps, f as unknown as typeof fetch)).code).toBe('no_item_code');
    expect(f).not.toHaveBeenCalled();
  });

  it('Vercel 上で呼び出し制御（Redis）が無ければ呼ばない', async () => {
    vi.stubEnv('VERCEL', '1');
    const { checkRakutenItem } = await vi.importActual<typeof import('../rakuten-event/item-check')>('../rakuten-event/item-check');
    const f = okFetch({ itemCode: 'shop:a1' });
    expect((await checkRakutenItem('shop:a1', deps, f as unknown as typeof fetch)).code).toBe('unavailable');
    expect(f).not.toHaveBeenCalled();
  });
});
