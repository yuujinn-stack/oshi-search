import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase R2: /admin/video-maker からのReel予約API（POST /api/admin/video-jobs/[id]/instagram-reel）と、
 * 予約一覧の表示ラベルの確認。予約の検証・保存（createReelScheduleFromVideoJob）はモック。Instagram APIは関係しない。
 */
vi.mock('server-only', () => ({}));

const createMock = vi.fn();
vi.mock('@/server/instagram-schedule/reel-schedule', () => {
  class ReelScheduleValidationError extends Error {}
  return { ReelScheduleValidationError, createReelScheduleFromVideoJob: (input: unknown) => createMock(input) };
});
vi.mock('@/server/instagram-schedule/schedule-store', () => {
  class DuplicateReelScheduleError extends Error {}
  class SlotConflictError extends Error {}
  return { DuplicateReelScheduleError, SlotConflictError };
});

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/video-jobs/[id]/instagram-reel/route';
import { ReelScheduleValidationError } from '@/server/instagram-schedule/reel-schedule';
import { DuplicateReelScheduleError, SlotConflictError } from '@/server/instagram-schedule/schedule-store';
import { getScheduleDisplayLabel, getScheduleTemplateMeta, SCHEDULE_TEMPLATE_OPTIONS, REEL_TEMPLATE_ID_PREFIX } from '@/lib/instagram-templates';

const JOB = '10b085df-a644-4462-a995-4d8cefe12733';
const post = (id: string, body: unknown) =>
  POST(new NextRequest(`http://x/api/admin/video-jobs/${id}/instagram-reel`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({ id: 1, status: 'scheduled', mediaType: 'REEL' });
});

describe('POST /api/admin/video-jobs/[id]/instagram-reel', () => {
  it('ジョブID・キャプション・日時だけを予約処理へ渡す（動画URL等はクライアントから受け取らない）', async () => {
    const res = await post(JOB, { caption: '投稿文 #推し活', scheduledAt: '2026-10-20T11:00:00.000Z', videoUrl: 'https://evil.example.com/x.mp4', personName: '別人' });
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toEqual({
      videoGenerationJobId: JOB,
      scheduledAt: new Date('2026-10-20T11:00:00.000Z'),
      caption: '投稿文 #推し活',
    });
  });

  it('不正なID・投稿文なし・日時なしは予約処理を呼ばずに400', async () => {
    expect((await post('../x', { caption: 'a', scheduledAt: 'x' })).status).toBe(400);
    expect((await post(JOB, { scheduledAt: '2026-10-20T11:00:00.000Z' })).status).toBe(400);
    expect((await post(JOB, { caption: 'a' })).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('検証エラーは400、時間枠の競合・同じ動画の二重予約は409', async () => {
    createMock.mockRejectedValueOnce(new ReelScheduleValidationError('Instagram用動画（ig-reel.mp4）の仕様チェックに合格していないため予約できません'));
    const r1 = await post(JOB, { caption: 'a', scheduledAt: '2026-10-20T11:00:00.000Z' });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toContain('仕様チェック');
    createMock.mockRejectedValueOnce(new SlotConflictError('x', []));
    expect((await post(JOB, { caption: 'a', scheduledAt: '2026-10-20T11:00:00.000Z' })).status).toBe(409);
    createMock.mockRejectedValueOnce(new DuplicateReelScheduleError('この動画は既にReel予約があります'));
    const r3 = await post(JOB, { caption: 'a', scheduledAt: '2026-10-20T11:00:00.000Z' });
    expect(r3.status).toBe(409);
    expect((await r3.json()).error).toContain('既にReel予約');
  });
});

describe('予約一覧の表示ラベル', () => {
  it('Reelは「リール」（接頭辞はR1bのReel予約作成が保存する reel: と同じ）', () => {
    expect(REEL_TEMPLATE_ID_PREFIX).toBe('reel:');
    expect(getScheduleDisplayLabel(`${REEL_TEMPLATE_ID_PREFIX}oshi-curious-v1`)).toBe('リール');
  });
  it('既存のテンプレートは従来と同じラベル（getScheduleTemplateMetaのlabel）、未知のIDはそのまま', () => {
    for (const t of SCHEDULE_TEMPLATE_OPTIONS) expect(getScheduleDisplayLabel(t.id)).toBe(getScheduleTemplateMeta(t.id)!.label);
    expect(getScheduleDisplayLabel('default-person')).toBe(getScheduleTemplateMeta('default-person')?.label ?? 'default-person');
    expect(getScheduleDisplayLabel('unknown-x')).toBe('unknown-x');
  });
  it('Reelの接頭辞は既存の予約テンプレートIDと重ならない', () => {
    expect(SCHEDULE_TEMPLATE_OPTIONS.some((t) => t.id.startsWith(REEL_TEMPLATE_ID_PREFIX))).toBe(false);
  });
});
