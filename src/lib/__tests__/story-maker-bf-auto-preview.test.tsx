// 楽天BFの商品自動選定：Vercel の Preview（本番と同じ Redis・同じ楽天APIの利用枠）では自動照合を止める。
// 楽天APIの呼び出し制御（src/lib/rakuten-api-gate.ts）と照合（src/lib/rakuten-event/item-check.ts）は本物のモジュールを使い、
// Redis の取得（getRedis）と fetch の回数を数えて、Preview では一切触れないことを確かめる（本物の Redis・楽天APIには接続しない）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/server/story-maker/goods-data', () => ({
  loadStorySaleCandidates: vi.fn(async () => ({
    targetName: 'Snow Man', totalOnSite: 1,
    candidates: [{ productId: 'ich-shop:xy1', title: 'サンプル商品', section: 'CD', pageUrl: 'https://item.rakuten.co.jp/shop/xy1/', thumbUrl: null, storedPrice: null }],
  })),
  StoryGoodsError: class extends Error { status = 400; },
}));
// 楽天ブックスの照合に使う関数だけ（price-refresh は DB を読み込むため、ここでは代わりを使う）
vi.mock('@/lib/price-refresh', () => ({ booksSearchKeyword: () => '', matchBooksResult: () => null }));
const redisCalls = { getRedis: 0 };
vi.mock('@/lib/redis', () => ({
  getRedis: () => { redisCalls.getRedis++; return null; },
}));

import { loadStorySaleCandidates } from '@/server/story-maker/goods-data';
import { BF_AUTO_PREVIEW_MESSAGE, bfAutoLookupBlocked } from '@/lib/story-maker/bf-auto';
import { suggestBfProducts } from '@/server/story-maker/bf-auto';
import { POST as postSuggest } from '@/app/api/admin/story-maker/bf-auto/route';
import BfSalePanel from '@/app/admin/story-maker/BfSalePanel';

const fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
const call = () => postSuggest(new NextRequest('http://localhost/api/admin/story-maker/bf-auto', { method: 'POST', body: JSON.stringify({ type: 'group', name: 'Snow Man' }) }));
const panel = (envScope: string) => renderToStaticMarkup(<BfSalePanel target={{ type: 'group', name: 'Snow Man', pagePath: '/groups/snow-man' }} onChange={() => {}} serverNow={Date.parse('2026-11-20T12:00:00+09:00')} envScope={envScope} />);

beforeEach(() => {
  redisCalls.getRedis = 0;
  fetchSpy.mockClear();
  vi.mocked(loadStorySaleCandidates).mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Preview（VERCEL_ENV=preview）', () => {
  beforeEach(() => vi.stubEnv('VERCEL_ENV', 'preview'));

  it('自動照合を実行しない：楽天API（fetch）・API制御用のRedisロック（getRedis）・候補の読み込みのどれにも触れない', async () => {
    const r = await suggestBfProducts({ type: 'group', name: 'Snow Man' });
    expect(r).toEqual({ items: [], recommendedIds: [], checkedCount: 0, warning: BF_AUTO_PREVIEW_MESSAGE, disabled: 'preview' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redisCalls.getRedis).toBe(0);
    expect(loadStorySaleCandidates).not.toHaveBeenCalled();
  });

  it('APIを直接呼んでも止まる（200・停止の案内・no-store。fetch・Redis は0回）', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    expect(j.disabled).toBe('preview');
    expect(j.warning).toBe(BF_AUTO_PREVIEW_MESSAGE);
    expect(j.recommendedIds).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redisCalls.getRedis).toBe(0);
  });

  it('画面：停止の案内を出す。候補の読み込みボタンは使える（手動入力・承認の流れはそのまま）', () => {
    const html = panel('preview');
    expect(html).toContain('data-testid="bf-auto-preview-disabled"');
    expect(html).toContain('プレビュー環境では商品の自動照合を停止しています。本番環境で利用できます');
    expect(html).toMatch(/<button[^>]*>この推しの商品候補を読み込む<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>この推しの商品候補を読み込む/);
  });
});

describe('Production（VERCEL_ENV=production）・ローカル', () => {
  it('Production では自動照合が動く（候補を読み込み、楽天APIの呼び出し制御を通る）。画面に停止の案内は出ない', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const r = await suggestBfProducts({ type: 'group', name: 'Snow Man' });
    expect(r.disabled).toBeUndefined();
    expect(r.checkedCount).toBe(1);
    expect(loadStorySaleCandidates).toHaveBeenCalledTimes(1);
    expect(redisCalls.getRedis).toBeGreaterThan(0); // 呼び出し制御が Redis を取りに行く（この判定で Preview の0回を見分けられる）
    expect(panel('production')).not.toContain('bf-auto-preview-disabled');
  });

  it('止めるのは preview のときだけ', () => {
    expect(bfAutoLookupBlocked('preview')).toBe(true);
    for (const s of ['production', 'local', '', undefined]) expect(bfAutoLookupBlocked(s)).toBe(false);
    expect(panel('local')).not.toContain('bf-auto-preview-disabled');
  });
});
