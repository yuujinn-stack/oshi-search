import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 動画生成ジョブからのReel予約作成（createReelScheduleFromVideoJob、Phase R1b）の確認。
 * DB（video_generation_jobsの読み取り・予約の保存）はモック。Instagram APIは関係しない（呼ばない）。
 */
vi.mock('server-only', () => ({}));

let jobRow: Record<string, unknown> | null = null;
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (jobRow ? [jobRow] : []) }) }) }) },
}));
let occupied = new Set<string>();
const createMock = vi.fn(async (input: Record<string, unknown>) => ({ id: 1, status: 'scheduled', mediaType: 'REEL', ...input }));
vi.mock('@/server/instagram-schedule/schedule-store', () => {
  class SlotConflictError extends Error {}
  return {
    SlotConflictError,
    listOccupiedSlotIsos: async () => occupied,
    createReelSchedule: (input: Record<string, unknown>) => createMock(input),
  };
});

import { createReelScheduleFromVideoJob, ReelScheduleValidationError } from '@/server/instagram-schedule/reel-schedule';
import { SlotConflictError } from '@/server/instagram-schedule/schedule-store';

const JOB = '10b085df-a644-4462-a995-4d8cefe12733';
const IG = `https://vhhtmpgqaw4rsxuh.public.blob.vercel-storage.com/video-jobs/${JOB}/ig-reel-15038338b25c31dd.mp4`;
const FINAL = `https://vhhtmpgqaw4rsxuh.public.blob.vercel-storage.com/video-jobs/${JOB}/final-69bed47c8483bfc9.mp4`;
const NOW = new Date('2026-10-03T13:00:00Z');
const AT = new Date('2026-10-04T11:00:00Z'); // JST 20:00
const job = (over: Record<string, unknown> = {}) => ({
  id: JOB, personName: '松村北斗', templateId: 'oshi-curious-v1', status: 'completed', videoUrl: FINAL,
  postTexts: { instagram: '松村北斗の出演作、どこまで追えてる？\n\n#松村北斗 #推し活 #推しサーチ' },
  result: { instagramReelVideo: { url: IG, qaStatus: 'PASS' } },
  ...over,
});
const create = (over: Record<string, unknown> = {}) =>
  createReelScheduleFromVideoJob({ videoGenerationJobId: JOB, scheduledAt: AT, now: NOW, ...over });

beforeEach(() => { jobRow = job(); occupied = new Set(); createMock.mockClear(); });

describe('Reel予約の作成', () => {
  it('ig-reel.mp4のURL・post_texts.instagram・予定日時で REEL として保存する', async () => {
    const s = await create();
    expect(createMock).toHaveBeenCalledWith({
      personName: '松村北斗',
      scheduledAt: AT,
      caption: '松村北斗の出演作、どこまで追えてる？\n\n#松村北斗 #推し活 #推しサーチ',
      videoUrl: IG,
      videoGenerationJobId: JOB,
      templateId: 'reel:oshi-curious-v1',
    });
    expect(s).toMatchObject({ mediaType: 'REEL' });
  });

  it('予約時に編集したキャプションがあればそれを保存する（投稿文は新しく生成しない）', async () => {
    await create({ caption: '編集した文面 #推し活' });
    expect(createMock.mock.calls[0][0].caption).toBe('編集した文面 #推し活');
  });

  it('ig-reelの仕様チェックがFAIL・未作成・URLなしなら予約しない', async () => {
    for (const result of [
      { instagramReelVideo: { qaStatus: 'FAIL', error: 'x' } },
      { instagramReelVideo: { url: IG, qaStatus: 'FAIL' } },
      {},
      null,
      { instagramReelVideo: { qaStatus: 'PASS' } },
    ]) {
      jobRow = job({ result });
      await expect(create()).rejects.toBeInstanceOf(ReelScheduleValidationError);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it('final.mp4や別ジョブ・別ストレージのURLはReelに使わない', async () => {
    for (const url of [FINAL, IG.replace(JOB, '00000000-0000-0000-0000-000000000000'), 'https://evil.example.com/ig-reel-0123456789abcdef.mp4']) {
      jobRow = job({ result: { instagramReelVideo: { url, qaStatus: 'PASS' } } });
      await expect(create()).rejects.toThrow('URL');
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it('完了していないジョブ・存在しないジョブ・不正なIDは拒否', async () => {
    jobRow = job({ status: 'processing' });
    await expect(create()).rejects.toThrow('完了した動画だけ');
    jobRow = null;
    await expect(create()).rejects.toThrow('見つかりません');
    await expect(create({ videoGenerationJobId: "x' OR 1=1" })).rejects.toThrow('形式');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('過去・毎時0分以外の日時、空・長すぎるキャプションは拒否', async () => {
    await expect(create({ scheduledAt: new Date('2026-10-03T12:00:00Z') })).rejects.toThrow('過去');
    await expect(create({ scheduledAt: new Date('2026-10-04T11:30:00Z') })).rejects.toThrow('毎時0分');
    await expect(create({ caption: '   ' })).rejects.toThrow('空');
    await expect(create({ caption: 'あ'.repeat(2201) })).rejects.toThrow('2200');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('同じ時間枠に予約があれば拒否（既存の空き枠判定を再利用）', async () => {
    occupied = new Set([AT.toISOString()]);
    await expect(create()).rejects.toBeInstanceOf(SlotConflictError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('同じ動画の二重予約は保存処理（createReelSchedule）が拒否したエラーをそのまま返す', async () => {
    class DuplicateReelScheduleError extends Error {}
    createMock.mockRejectedValueOnce(new DuplicateReelScheduleError('この動画は既にReel予約があります'));
    await expect(create()).rejects.toThrow('既にReel予約があります');
  });
});
