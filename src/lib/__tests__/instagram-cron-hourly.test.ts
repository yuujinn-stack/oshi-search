import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 毎時Cron（24本）での自動投稿の確認。本物のCronハンドラ（/api/cron/instagram-publish の GET）を、
 * DBの代わりにメモリ上の予約ストア（schedule-store と同じ due 条件・条件付きclaim）で動かす。
 * Instagram API（publishScheduleToInstagram）はモックし、外部には一切送らない。
 */
vi.mock('server-only', () => ({}));

type Row = { id: number; personName: string; scheduledAt: Date; status: string; attempts: number; mediaId: string | null };
let rows: Row[] = [];
let now = new Date();
const MAX = 3;
const isDue = (r: Row) => r.scheduledAt.getTime() <= now.getTime() && r.mediaId === null
  && (r.status === 'scheduled' || (r.status === 'failed' && r.attempts < MAX));

vi.mock('@/server/instagram-schedule/schedule-store', () => ({
  CRON_BATCH_LIMIT: 5,
  listDueScheduleIds: async (limit = 5) => rows.filter(isDue).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()).slice(0, limit).map((r) => r.id),
  // 実物と同じく「due条件を満たす場合だけ processing にする」条件付き更新（1回しか成功しない）
  claimDueSchedule: async (id: number) => {
    await Promise.resolve();
    const r = rows.find((x) => x.id === id);
    if (!r || !isDue(r)) return null;
    r.status = 'processing';
    return { ...r, imageUrls: ['a', 'b', 'c'], caption: 'c' };
  },
  releaseSchedule: async (id: number) => { const r = rows.find((x) => x.id === id)!; if (r.status === 'processing') r.status = 'scheduled'; },
  markPublished: async (id: number, d: { mediaId: string }) => { const r = rows.find((x) => x.id === id)!; r.status = 'published'; r.mediaId = d.mediaId; },
  markFailed: async (id: number, d: { attempts: number }) => { const r = rows.find((x) => x.id === id)!; r.status = 'failed'; r.attempts = d.attempts; },
  markNeedsReview: async (id: number, d: { attempts: number }) => { const r = rows.find((x) => x.id === id)!; r.status = 'needs_review'; r.attempts = d.attempts; },
}));
const publishMock = vi.fn(async (s: { id: number }) => {
  await new Promise((res) => setTimeout(res, 5)); // 投稿処理中に別のCronが走る状況を作る
  return { mediaId: `M${s.id}`, publishedAt: now.toISOString() };
});
vi.mock('@/server/instagram-schedule/publish-schedule', () => ({
  publishScheduleToInstagram: (s: { id: number }) => publishMock(s),
  AmbiguousPublishError: class extends Error {},
  GraphApiRequestError: class extends Error {},
}));
vi.mock('@/server/instagram-post/config', () => ({ isAutopublishEnabled: () => true }));
vi.mock('@/server/instagram-schedule/admin-notifications', () => ({ createAdminNotificationIfNeeded: vi.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/instagram-publish/route';
import { jstWallClockToUtcDate } from '@/lib/jst-time';

process.env.CRON_SECRET = 'test-secret';
const cron = async () => (await GET(new NextRequest('http://x/api/cron/instagram-publish', { headers: { authorization: 'Bearer test-secret' } }))).json();
const at = (d: string, t: string) => jstWallClockToUtcDate(d, t);
const row = (id: number, t: string): Row => ({ id, personName: `P${id}`, scheduledAt: at('2026-10-01', t), status: 'scheduled', attempts: 0, mediaId: null });

beforeEach(() => { publishMock.mockClear(); });

describe('毎時Cronでの自動投稿', () => {
  it('各Cronは実行時点までに期限を迎えた予約だけを処理する（1日10件を各時間帯で1件ずつ）', async () => {
    const times = ['09:00', '10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '18:00', '20:00', '21:00'];
    rows = times.map((t, i) => row(i + 1, t));
    const publishedAt: Record<string, number[]> = {};
    for (let h = 0; h < 24; h++) {
      // Hobbyでは毎時0分のCronが最大59分遅れて動く。ここではH:25に動いたとする
      now = at('2026-10-01', `${String(h).padStart(2, '0')}:25`);
      const res = await cron();
      const ids = res.outcomes.filter((o: { result: string }) => o.result === 'published').map((o: { id: number }) => o.id);
      if (ids.length) publishedAt[`${h}:25`] = ids;
    }
    expect(publishedAt).toEqual({ '9:25': [1], '10:25': [2], '11:25': [3], '12:25': [4], '13:25': [5], '15:25': [6], '16:25': [7], '18:25': [8], '20:25': [9], '21:25': [10] });
    expect(publishMock).toHaveBeenCalledTimes(10);
  });

  it('既存の 09:00 / 15:00 / 20:00 の予約も、その時間帯のCronで処理される', async () => {
    rows = [row(1, '09:00'), row(2, '15:00'), row(3, '20:00')];
    now = at('2026-10-01', '09:40'); await cron();
    now = at('2026-10-01', '14:59'); await cron();
    expect(rows.map((r) => r.status)).toEqual(['published', 'scheduled', 'scheduled']);
    now = at('2026-10-01', '15:03'); await cron();
    now = at('2026-10-01', '20:58'); await cron();
    expect(rows.map((r) => r.status)).toEqual(['published', 'published', 'published']);
    expect(publishMock).toHaveBeenCalledTimes(3);
  });

  it('近いタイミングで複数のCronが動いても同じ予約を二重投稿しない（3本同時・予約5件）', async () => {
    rows = ['09:00', '10:00', '11:00', '12:00', '13:00'].map((t, i) => row(i + 1, t));
    now = at('2026-10-01', '13:30');
    const results = await Promise.all([cron(), cron(), cron()]);
    const published = results.flatMap((r) => r.outcomes.filter((o: { result: string }) => o.result === 'published').map((o: { id: number }) => o.id));
    expect(published.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(publishMock).toHaveBeenCalledTimes(5);
    // その後のCronでは対象なし（投稿済みは再投稿しない）
    now = at('2026-10-01', '14:10');
    expect((await cron()).dueCount).toBe(0);
    expect(publishMock).toHaveBeenCalledTimes(5);
  });

  it('1回のCronで処理するのは最大5件（従来どおり）。残りは次のCronで処理', async () => {
    rows = Array.from({ length: 7 }, (_, i) => row(i + 1, '09:00'));
    now = at('2026-10-01', '09:10');
    expect((await cron()).dueCount).toBe(5);
    now = at('2026-10-01', '10:10');
    expect((await cron()).dueCount).toBe(2);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });
});
