// 楽天BF：Vercel の Preview（本番と同じ Redis）では投稿記録を保存しない。Production・ローカルは従来どおり。
// Redis はメモリ上の代わり（本物の Redis には書かない）。読み書きの回数も数えて、Preview では一切触らないことを確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const CANDIDATE = { productId: 'p1', title: 'サンプル商品', section: 'グッズ', pageUrl: 'https://item.rakuten.co.jp/shop-a/item-1/', thumbUrl: null, storedPrice: null };
vi.mock('@/server/story-maker/goods-data', () => ({
  loadStorySaleCandidates: vi.fn(async () => ({ targetName: 'Snow Man', candidates: [CANDIDATE], totalOnSite: 1 })),
  StoryGoodsError: class extends Error { status = 400; },
}));
const store = new Map<string, Map<string, string>>();
const calls = { read: 0, write: 0 };
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    hget: async (k: string, f: string) => { calls.read++; return store.get(k)?.get(f) ?? null; },
    hlen: async (k: string) => { calls.read++; return store.get(k)?.size ?? 0; },
    hset: async (k: string, obj: Record<string, string>) => { calls.write++; const m = store.get(k) ?? new Map(); for (const [f, v] of Object.entries(obj)) m.set(f, v); store.set(k, m); return 1; },
    hgetall: async (k: string) => { calls.read++; return Object.fromEntries(store.get(k) ?? []); },
    hdel: async () => { calls.write++; return 1; },
  }),
}));

import { verifyBfItem, type BfApprovedItem } from '@/lib/story-maker/bf-sale';
import { BF_PREVIEW_RECORD_MESSAGE, bfRecordSaveBlocked } from '@/lib/story-maker/metrics';
import { signBfApproval } from '@/server/story-maker/bf-approval';
import { saveStoryPost, storyPostsKey } from '@/server/story-maker/post-store';
import { POST as postsPost } from '@/app/api/admin/story-maker/posts/route';
import { POST as bfPost } from '@/app/api/admin/story-maker/bf-sale/route';
import StoryMetricsPanel, { type MetricsDraftContext } from '@/app/admin/story-maker/StoryMetricsPanel';

const DURING = Date.parse('2026-11-20T12:00:00+09:00');
const input = { priceLabel: '通常価格', regularPrice: '3000', salePrice: '2400', sourceUrl: CANDIDATE.pageUrl, discountKind: 'price-cut', conditions: '', confirmed: true, checkedBy: '確認者' } as const;

async function signed(): Promise<BfApprovedItem> {
  const r = verifyBfItem(CANDIDATE, { ...input }, DURING);
  if (!r.ok) throw new Error(r.errors.join());
  return signBfApproval(r.item, { type: 'group', name: 'Snow Man' });
}
const record = (templateId: string, item?: BfApprovedItem) => ({
  id: `rec${templateId}${Math.random().toString(36).slice(2, 8)}`, postedAt: '2026-11-20T12:30', templateId, targetName: 'Snow Man', targetType: 'group',
  slideCount: templateId === 'bf' ? 3 : 2, linkSlide: templateId === 'bf' ? 3 : 2, reach: [100, 80, 60], ...(item ? { saleItems: [item] } : {}),
});
const postReq = (rec: unknown) => new NextRequest('http://localhost/api/admin/story-maker/posts', { method: 'POST', body: JSON.stringify({ record: rec }) });

beforeEach(() => {
  vi.stubEnv('ADMIN_SESSION_SECRET', 'x'.repeat(48));
  store.clear();
  calls.read = 0;
  calls.write = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DURING + 3600_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Preview（VERCEL_ENV=preview）', () => {
  beforeEach(() => vi.stubEnv('VERCEL_ENV', 'preview'));

  it('楽天BF（通常投稿・ストーリーズ）の投稿記録は保存しない。Redis を読みも書きもしない', async () => {
    const item = await signed();
    for (const t of ['bf', 'bfstory']) {
      await expect(saveStoryPost(record(t, item))).rejects.toThrow(BF_PREVIEW_RECORD_MESSAGE);
    }
    expect(calls).toEqual({ read: 0, write: 0 });
    expect(store.size).toBe(0);
  });

  it('APIを直接呼んでも保存できない（400・Redis に触らない）。承認の無い楽天BFの記録も同じ', async () => {
    const item = await signed();
    for (const rec of [record('bf', item), record('bfstory', item), record('bf')]) {
      const res = await postsPost(postReq(rec));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(BF_PREVIEW_RECORD_MESSAGE);
    }
    expect(calls).toEqual({ read: 0, write: 0 });
  });

  it('商品の承認・承認内容の検証（PNG保存前の確認）は Preview でも使える', async () => {
    const req = (body: unknown) => new NextRequest('http://localhost/api/admin/story-maker/bf-sale', { method: 'POST', body: JSON.stringify(body) });
    const a = await (await bfPost(req({ action: 'approve', type: 'group', name: 'Snow Man', productId: 'p1', input }))).json();
    expect(a.ok).toBe(true);
    const c = await (await bfPost(req({ action: 'check', type: 'group', name: 'Snow Man', items: [a.item] }))).json();
    expect(c.ok).toBe(true);
    expect(calls).toEqual({ read: 0, write: 0 });
  });

  it('既存のテンプレートの記録は Preview でも従来どおり（Preview 用のキーに保存）', async () => {
    const saved = await saveStoryPost(record('goods'));
    expect(saved.templateId).toBe('goods');
    expect(storyPostsKey()).toBe('story-maker:posts:v1:preview');
    expect(store.get('story-maker:posts:v1:preview')?.size).toBe(1);
    expect(store.has('story-maker:posts:v1')).toBe(false);
  });

  it('画面：楽天BFでは「プレビュー環境では記録を保存できません」と出し、記録の追加ボタンを押せない（他のテンプレートは従来どおり）', () => {
    const ctx = (templateId: MetricsDraftContext['templateId']): MetricsDraftContext => ({
      templateId, targetName: 'Snow Man', targetType: 'group', abTest: null,
      variants: [{ variant: null, slides: 3, utmCampaign: 'c', utmContent: 'x', url: 'https://oshi-search.jp/', linkSlide: 3 }],
    });
    for (const t of ['bf', 'bfstory'] as const) {
      const html = renderToStaticMarkup(<StoryMetricsPanel ctx={ctx(t)} envScope="preview" />);
      expect(html).toContain('プレビュー環境では記録を保存できません');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>＋ いまの設定で記録を追加/);
    }
    const goods = renderToStaticMarkup(<StoryMetricsPanel ctx={ctx('goods')} envScope="preview" />);
    expect(goods).not.toContain('プレビュー環境では記録を保存できません');
    expect(goods).not.toMatch(/<button[^>]*disabled=""[^>]*>＋ いまの設定で記録を追加/);
  });
});

describe('Production（VERCEL_ENV=production）・ローカル', () => {
  it('Production では楽天BFの投稿記録を従来どおり保存できる（本番のキー）', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const item = await signed();
    for (const t of ['bf', 'bfstory']) {
      const res = await postsPost(postReq(record(t, item)));
      expect(res.status).toBe(200);
    }
    expect(store.get('story-maker:posts:v1')?.size).toBe(2);
    expect(store.has('story-maker:posts:v1:preview')).toBe(false);
    const html = renderToStaticMarkup(<StoryMetricsPanel ctx={{ templateId: 'bf', targetName: 'Snow Man', targetType: 'group', abTest: null, variants: [{ variant: null, slides: 3, utmCampaign: 'c', utmContent: 'x', url: '', linkSlide: 3 }] }} envScope="production" />);
    expect(html).not.toContain('プレビュー環境では記録を保存できません');
  });

  it('判定は楽天BF × preview のときだけ', () => {
    for (const t of ['bf', 'bfstory'] as const) {
      expect(bfRecordSaveBlocked(t, 'preview')).toBe(true);
      expect(bfRecordSaveBlocked(t, 'production')).toBe(false);
      expect(bfRecordSaveBlocked(t, 'local')).toBe(false);
      expect(bfRecordSaveBlocked(t, '')).toBe(false);
    }
    for (const t of ['vod', 'goods', 'request', 'card', 'goodsmaking'] as const) expect(bfRecordSaveBlocked(t, 'preview')).toBe(false);
  });
});
