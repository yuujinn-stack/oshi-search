import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 既存の予約Cron（/api/cron/instagram-publish）に Reel（Phase R1b）を混ぜたときの確認。
 * 本物のCronハンドラ・reel-cron・publish-reel を、メモリ上の予約ストア（schedule-storeと同じ条件の
 * due判定・条件付きclaim）で動かす。Instagram Graph APIはモックで、呼ばれた回数だけを数える（外部には送らない）。
 * カルーセルの公開処理（publishScheduleToInstagram）はモック。
 */
vi.mock('server-only', () => ({}));

type Row = {
  id: number; personName: string; scheduledAt: Date; status: string; attempts: number; mediaId: string | null;
  mediaType: 'CAROUSEL' | 'REEL'; videoUrl: string | null; igContainerId: string | null; permalink: string | null;
  caption: string; imageUrls: string[];
};
let rows: Row[] = [];
const MAX = 3;
const isDue = (r: Row, type: string) => r.mediaType === type && r.scheduledAt.getTime() <= Date.now() && r.mediaId === null
  && (r.status === 'scheduled' || (r.status === 'failed' && r.attempts < MAX));
const byId = (id: number) => rows.find((x) => x.id === id)!;
const record = (r: Row) => ({ ...r, personId: r.personName, templateId: 't', hashtags: '', publishedAt: null, errorMessage: null, processingStartedAt: null, createdAt: new Date(), updatedAt: new Date(), videoGenerationJobId: null, containerCreatedAt: null });
const listDue = (type: string, limit: number) => rows.filter((r) => isDue(r, type)).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()).slice(0, limit).map((r) => r.id);
const claim = (type: string) => async (id: number) => {
  await Promise.resolve();
  const r = rows.find((x) => x.id === id);
  if (!r || !isDue(r, type)) return null;
  r.status = 'processing';
  return record(r);
};

vi.mock('@/server/instagram-schedule/schedule-store', () => ({
  CRON_BATCH_LIMIT: 5,
  listDueScheduleIds: async (limit = 5) => listDue('CAROUSEL', limit),
  claimDueSchedule: (id: number) => claim('CAROUSEL')(id),
  listDueReelScheduleIds: async (limit = 1) => listDue('REEL', limit),
  claimDueReelSchedule: (id: number) => claim('REEL')(id),
  releaseSchedule: async (id: number) => { const r = byId(id); if (r.status === 'processing') r.status = 'scheduled'; },
  releaseReelForNextRun: async (id: number) => { const r = byId(id); if (r.status === 'processing') r.status = 'scheduled'; },
  markPublished: async (id: number, d: { mediaId: string }) => { const r = byId(id); r.status = 'published'; r.mediaId = d.mediaId; },
  markFailed: async (id: number, d: { attempts: number }) => { const r = byId(id); r.status = 'failed'; r.attempts = d.attempts; },
  markNeedsReview: async (id: number, d: { attempts: number }) => { const r = byId(id); r.status = 'needs_review'; r.attempts = d.attempts; },
  markReelContainerFailed: async (id: number, d: { attempts: number }) => { const r = byId(id); r.status = 'failed'; r.attempts = d.attempts; r.igContainerId = null; },
  saveReelPermalink: async (id: number, p: string) => { byId(id).permalink = p; },
  saveReelContainer: async (id: number, c: string) => { const r = byId(id); if (r.status !== 'processing' || r.mediaId) return false; r.igContainerId = c; return true; },
  isReelStillPublishable: async (id: number, c: string) => { const r = byId(id); return r.status === 'processing' && r.mediaId === null && r.igContainerId === c; },
}));

// Graph API（Reelのコンテナ作成・状態確認・公開）。containerStatus で返す状態を切り替える
const graphPost = vi.fn();
const graphGet = vi.fn();
let containerStatus = 'FINISHED';
let containerSeq = 0;
vi.mock('@/server/instagram-post/graph-client', () => {
  class GraphApiRequestError extends Error {}
  class InstagramGraphClient {
    post = graphPost;
    get = graphGet;
  }
  return { InstagramGraphClient, GraphApiRequestError };
});
let autopublish = true;
let reelsAutopublish = false;
vi.mock('@/server/instagram-post/config', () => ({
  isAutopublishEnabled: () => autopublish,
  isReelsAutopublishEnabled: () => reelsAutopublish,
  loadInstagramConfig: () => ({ igUserId: 'IGUSER', accessToken: 'dummy' }),
}));
vi.mock('@/lib/instagram-post-store', () => ({ recordInstagramPost: vi.fn() }));
const carouselPublish = vi.fn(async (s: { id: number; mediaType?: string }) => ({ mediaId: `CM${s.id}`, publishedAt: new Date().toISOString() }));
vi.mock('@/server/instagram-schedule/publish-schedule', () => ({
  publishScheduleToInstagram: (s: { id: number }) => carouselPublish(s),
  AmbiguousPublishError: class AmbiguousPublishError extends Error {},
  AlreadyPublishedError: class AlreadyPublishedError extends Error {},
  GraphApiRequestError: class extends Error {},
}));
const notify = vi.fn();
vi.mock('@/server/instagram-schedule/admin-notifications', () => ({ createAdminNotificationIfNeeded: (...a: unknown[]) => notify(...a) }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/instagram-publish/route';

process.env.CRON_SECRET = 'test-secret';
const T0 = new Date('2026-10-05T11:10:00Z');
const runCron = async (query = '') => {
  const p = GET(new NextRequest(`http://x/api/cron/instagram-publish${query}`, { headers: { authorization: 'Bearer test-secret' } }));
  await vi.runAllTimersAsync();
  return (await p).json();
};
const carousel = (id: number): Row => ({ id, personName: `C${id}`, scheduledAt: new Date('2026-10-05T11:00:00Z'), status: 'scheduled', attempts: 0, mediaId: null, mediaType: 'CAROUSEL', videoUrl: null, igContainerId: null, permalink: null, caption: 'c', imageUrls: ['a', 'b', 'c'] });
const reelRow = (id: number): Row => ({ id, personName: `R${id}`, scheduledAt: new Date('2026-10-05T11:00:00Z'), status: 'scheduled', attempts: 0, mediaId: null, mediaType: 'REEL', videoUrl: 'https://x.public.blob.vercel-storage.com/video-jobs/j/ig-reel-0123456789abcdef.mp4', igContainerId: null, permalink: null, caption: 'r', imageUrls: [] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  vi.setSystemTime(T0);
  autopublish = true; reelsAutopublish = false; containerStatus = 'FINISHED'; containerSeq = 0;
  graphPost.mockReset(); graphGet.mockReset(); carouselPublish.mockClear(); notify.mockClear();
  graphPost.mockImplementation(async (path: string) => (path.endsWith('/media') ? { id: `CT${++containerSeq}` } : { id: 'RM1' }));
  graphGet.mockImplementation(async (_p: string, params: Record<string, string>) =>
    params.fields === 'permalink' ? { permalink: 'https://www.instagram.com/reel/RM1/' } : { status_code: containerStatus });
});
afterEach(() => { vi.useRealTimers(); });

describe('既存Cronとの共存（Reelスイッチ無効＝本番の現在の状態）', () => {
  it('カルーセルは従来どおり公開され、Reelは件数を数えるだけでclaimもMeta APIも行わない', async () => {
    rows = [carousel(1), reelRow(2), carousel(3)];
    const res = await runCron();
    expect(res.outcomes.map((o: { id: number; result: string }) => [o.id, o.result])).toEqual([[1, 'published'], [3, 'published']]);
    expect(carouselPublish.mock.calls.map((c) => c[0].id)).toEqual([1, 3]); // REELの行はカルーセル処理へ渡らない
    expect(res.reels).toMatchObject({ guarded: true, dueCount: 1, outcomes: [] });
    expect(byId(2).status).toBe('scheduled');
    expect(graphPost).not.toHaveBeenCalled();
    expect(graphGet).not.toHaveBeenCalled();
  });

  it('全体の自動投稿スイッチが無効なら、従来どおり何もせずに返す（Reelスイッチが有効でも）', async () => {
    autopublish = false; reelsAutopublish = true;
    rows = [carousel(1), reelRow(2)];
    const res = await runCron();
    expect(res.guarded).toBe(true);
    expect(carouselPublish).not.toHaveBeenCalled();
    expect(graphPost).not.toHaveBeenCalled();
    expect(rows.map((r) => r.status)).toEqual(['scheduled', 'scheduled']);
  });

  it('dryRun: Reelもclaimしてすぐ戻すだけ（Meta APIは呼ばない）', async () => {
    rows = [reelRow(2)];
    const res = await runCron('?dryRun=1');
    expect(res.reels.outcomes).toEqual([{ id: 2, personName: 'R2', result: 'dry-run-ok' }]);
    expect(byId(2).status).toBe('scheduled');
    expect(graphPost).not.toHaveBeenCalled();
  });
});

describe('Reelスイッチ有効時の流れ（テスト内のみ。Graph APIはモック）', () => {
  beforeEach(() => { reelsAutopublish = true; });

  it('処理中なら次回へ持ち越し、次回は同じコンテナを再利用して公開する。公開後は再処理しない', async () => {
    rows = [reelRow(2)];
    containerStatus = 'IN_PROGRESS';
    const first = await runCron();
    expect(first.reels.outcomes[0].result).toBe('waiting');
    expect(byId(2)).toMatchObject({ status: 'scheduled', igContainerId: 'CT1', mediaId: null });
    expect(graphPost.mock.calls.filter((c) => c[0].endsWith('/media'))).toHaveLength(1);

    containerStatus = 'FINISHED';
    vi.setSystemTime(new Date('2026-10-05T12:10:00Z'));
    const second = await runCron();
    expect(second.reels.outcomes[0]).toMatchObject({ result: 'published', mediaId: 'RM1' });
    expect(graphPost.mock.calls.filter((c) => c[0].endsWith('/media'))).toHaveLength(1); // 新しいコンテナは作らない
    expect(graphPost).toHaveBeenCalledWith('IGUSER/media_publish', { creation_id: 'CT1' });
    expect(byId(2)).toMatchObject({ status: 'published', mediaId: 'RM1', permalink: 'https://www.instagram.com/reel/RM1/' });

    graphPost.mockClear(); graphGet.mockClear();
    vi.setSystemTime(new Date('2026-10-05T13:10:00Z'));
    const third = await runCron();
    expect(third.reels.dueCount).toBe(0);
    expect(graphPost).not.toHaveBeenCalled();
  });

  it('保存済みコンテナがPUBLISHED（応答だけ失われた等）なら needs_review にし、以後は自動で再投稿しない', async () => {
    rows = [{ ...reelRow(2), igContainerId: 'CTX' }];
    containerStatus = 'PUBLISHED';
    const res = await runCron();
    expect(res.reels.outcomes[0].result).toBe('needs_review');
    expect(byId(2).status).toBe('needs_review');
    expect(byId(2).igContainerId).toBe('CTX'); // コンテナIDは残す
    expect(graphPost).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ scheduleId: 2, status: 'needs_review', attempts: 1 });
    vi.setSystemTime(new Date('2026-10-05T12:10:00Z'));
    expect((await runCron()).reels.dueCount).toBe(0);
  });

  it('コンテナがERRORならコンテナを捨ててfailed。自動再試行では新しいコンテナを作る（上限3回）', async () => {
    rows = [{ ...reelRow(2), igContainerId: 'BAD' }];
    containerStatus = 'ERROR';
    const res = await runCron();
    expect(res.reels.outcomes[0].result).toBe('failed');
    expect(byId(2)).toMatchObject({ status: 'failed', attempts: 1, igContainerId: null });
    containerStatus = 'FINISHED';
    vi.setSystemTime(new Date('2026-10-05T12:10:00Z'));
    const retry = await runCron();
    expect(retry.reels.outcomes[0].result).toBe('published');
    expect(graphPost).toHaveBeenCalledWith('IGUSER/media', expect.objectContaining({ media_type: 'REELS' }));
  });

  it('media_publish自体の失敗は needs_review（二重投稿の恐れがあるため自動再試行しない）', async () => {
    rows = [{ ...reelRow(2), igContainerId: 'CT9' }];
    graphPost.mockImplementation(async (path: string) => { if (path.endsWith('/media_publish')) throw new Error('timeout'); return { id: 'x' }; });
    const res = await runCron();
    expect(res.reels.outcomes[0].result).toBe('needs_review');
    expect(byId(2).mediaId).toBeNull();
  });

  it('同時に2つのCronが動いても、同じReelを処理できるのは1回だけ（atomic claim）', async () => {
    rows = [reelRow(2)];
    const p1 = GET(new NextRequest('http://x/api/cron/instagram-publish', { headers: { authorization: 'Bearer test-secret' } }));
    const p2 = GET(new NextRequest('http://x/api/cron/instagram-publish', { headers: { authorization: 'Bearer test-secret' } }));
    await vi.runAllTimersAsync();
    const results = [await (await p1).json(), await (await p2).json()].flatMap((r) => r.reels.outcomes.map((o: { result: string }) => o.result));
    expect(results.filter((r) => r === 'published')).toHaveLength(1);
    expect(graphPost.mock.calls.filter((c) => c[0].endsWith('/media_publish'))).toHaveLength(1);
  });

  it('1回のCronで扱うReelは1件だけ（残りは次回）', async () => {
    rows = [reelRow(2), { ...reelRow(4), scheduledAt: new Date('2026-10-05T10:00:00Z') }];
    const res = await runCron();
    expect(res.reels.outcomes).toHaveLength(1);
    expect(res.reels.outcomes[0].id).toBe(4); // 予定日時の古い方から
    expect(byId(2).status).toBe('scheduled');
  });
});
