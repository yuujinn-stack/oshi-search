import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// /api/admin/price-review：未ログイン・権限なし・不正な入力では何もしない（DB は使わない・偽物）。
const spies = vi.hoisted(() => ({
  decide: vi.fn(),
  sync: vi.fn(),
  query: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: spies.revalidatePath }));
vi.mock('@/lib/price-review-store', async () => {
  const actual = await vi.importActual<typeof import('../price-review-store')>('../price-review-store');
  return {
    parseDecideInput: actual.parseDecideInput,
    decidePriceReview: spies.decide,
    syncPriceReviewsFromRedis: spies.sync,
    neonReviewDb: () => ({ query: spies.query, transaction: vi.fn() }),
  };
});
vi.mock('@/db/client', () => ({ neonSql: {}, db: {} }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/price-refresh-runner', () => ({ LOCK_KEY: 'l', REVIEW_INBOX_KEY: 'i', STATE_KEY: 's' }));
vi.mock('@/lib/product-store', () => ({ CATEGORIES: ['写真集'] }));

import { POST } from '../../app/api/admin/price-review/route';
import { createSessionToken, SESSION_COOKIE } from '../session';

const SECRET = 'test-secret-not-real-0123456789abcdefghij';
const body = { action: 'approve', id: 1, expectedPreviousPrice: 10000, expectedFetchedPrice: 14000, operator: '管理者A' };

function req(b: unknown, o: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'oshi-search.jp' };
  if (o.cookie) headers.cookie = `${SESSION_COOKIE}=${o.cookie}`;
  if (o.origin) headers.origin = o.origin;
  return new NextRequest('https://oshi-search.jp/api/admin/price-review', { method: 'POST', headers, body: JSON.stringify(b) });
}

describe('価格の確認待ちの承認・却下 API', () => {
  let token = '';
  beforeEach(async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', SECRET);
    token = await createSessionToken(SECRET);
    spies.decide.mockReset().mockResolvedValue({ ok: true, code: 'approved', message: '承認しました' });
    spies.sync.mockReset().mockResolvedValue({ received: 0, valid: 0, synced: true });
    spies.query.mockReset().mockResolvedValue([{ person_name: '推しA' }]);
    spies.revalidatePath.mockReset();
  });

  it('未ログインでは操作できない（401・何もしない）', async () => {
    const res = await POST(req(body));
    expect(res.status).toBe(401);
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('不正なセッション（署名が違う・期限切れ相当）では操作できない', async () => {
    const forged = await createSessionToken('another-secret-not-real-0123456789abcdef');
    expect((await POST(req(body, { cookie: forged }))).status).toBe(401);
    expect((await POST(req(body, { cookie: 'garbage' }))).status).toBe(401);
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('セッションの秘密が未設定なら誰も操作できない', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    expect((await POST(req(body, { cookie: token }))).status).toBe(401);
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('別のサイトからの送信は拒否する（403）', async () => {
    expect((await POST(req(body, { cookie: token, origin: 'https://evil.example' }))).status).toBe(403);
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('不正な入力は受け付けない（400）', async () => {
    expect((await POST(req({ ...body, expectedFetchedPrice: '14000' }, { cookie: token }))).status).toBe(400);
    expect((await POST(req({ ...body, operator: '' }, { cookie: token }))).status).toBe(400);
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('取り込み（sync）は POST だけ・管理者だけ', async () => {
    expect((await POST(req({ action: 'sync' }))).status).toBe(401);
    expect((await POST(req({ action: 'sync' }, { cookie: token, origin: 'https://evil.example' }))).status).toBe(403);
    expect(spies.sync).not.toHaveBeenCalled();
    spies.sync.mockResolvedValue({ received: 3, valid: 2, synced: true });
    const res = await POST(req({ action: 'sync' }, { cookie: token, origin: 'https://oshi-search.jp' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, code: 'synced' });
    expect(spies.decide).not.toHaveBeenCalled();
  });

  it('承認・却下の前に最新の確認待ちを取り込む（取り込みに失敗しても判定は行う）', async () => {
    spies.sync.mockRejectedValue(new Error('redis down'));
    expect((await POST(req(body, { cookie: token }))).status).toBe(200);
    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.decide).toHaveBeenCalledTimes(1);
  });

  it('管理者の承認：検証済みの入力で処理し、人物ページを再検証する', async () => {
    const res = await POST(req(body, { cookie: token, origin: 'https://oshi-search.jp' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, code: 'approved' });
    expect(spies.decide).toHaveBeenCalledWith(expect.anything(), body);
    expect(spies.revalidatePath).toHaveBeenCalledWith(`/person/${encodeURIComponent('推しA')}`);
  });

  it('処理済み・古い確認待ちは 409 で、人物ページは再検証しない', async () => {
    spies.decide.mockResolvedValue({ ok: false, code: 'stale', message: '更新しませんでした' });
    expect((await POST(req(body, { cookie: token }))).status).toBe(409);
    expect(spies.revalidatePath).not.toHaveBeenCalled();
  });

  it('DB のエラーの文面（接続文字列などを含みうる）は返さない', async () => {
    spies.decide.mockRejectedValue(new Error('connect failed postgresql://u:secret-password@ep-x.neon.tech/db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req(body, { cookie: token }));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('secret-password');
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-password');
    err.mockRestore();
  });

  it('テーブル未作成なら 503 で案内する', async () => {
    spies.decide.mockRejectedValue(Object.assign(new Error('relation "price_reviews" does not exist'), { code: '42P01' }));
    expect((await POST(req(body, { cookie: token }))).status).toBe(503);
  });
});

describe('管理画面の確認待ちの表示', async () => {
  vi.doMock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PriceReviewQueue } = await import('../../app/admin/price-refresh/PriceReviewQueue');
  const row = {
    id: 1, personName: '推しA', category: '写真集', itemId: 'ic-1', itemTitle: '写真集 A', previousPrice: 10000, fetchedPrice: 14000,
    changeRate: 0.4, reason: 'price_change_30pct', fetchedAtMs: Date.UTC(2026, 9, 21), currentPrice: 10000, blocker: null,
  } as const;

  it('人物・カテゴリ・商品・保存中と取得した価格・変動・理由・取得日時・承認／却下ボタン（PC の表とスマートフォンのカード）', () => {
    const html = renderToStaticMarkup(createElement(PriceReviewQueue, { rows: [row] }));
    for (const s of ['推しA', '写真集', 'ic-1', '写真集 A', '¥10,000', '¥14,000', '+¥4,000（+40.0%）', '前回の価格から30%以上の変動', '承認', '却下']) expect(html).toContain(s);
    expect(html).toContain('md:hidden'); // スマートフォン用のカード
    expect(html).toContain('bg-emerald-600'); // 承認（塗り）
    expect(html).toContain('border-red-300'); // 却下（枠線）で区別
    // 操作者名が未入力の間は押せない
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('承認できない理由がある商品は理由を表示する', () => {
    const html = renderToStaticMarkup(createElement(PriceReviewQueue, { rows: [{ ...row, blocker: 'price_changed', currentPrice: 11000 }] }));
    expect(html).toContain('保存済みの価格が変わったため承認できません');
  });
});
