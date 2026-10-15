import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 管理画面の生成前確認（推しでサブスク比較）: 診断結果の件数に加えて、共通CapCut音声を使えるか（capcutCompatible・理由）を返す
const state = vi.hoisted(() => ({
  worker: null as Record<string, unknown> | null,
  diagnosis: null as Record<string, unknown> | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/video-jobs/job-store', () => {
  class VideoJobError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return { VideoJobError, getLatestWorker: async () => state.worker };
});
vi.mock('@/server/oshi-vod/video-diagnosis', () => ({
  loadOshiVodVideoDiagnosis: async () => state.diagnosis,
}));

const S = ['p-0123456789ab', 'p-111111111111', 'p-222222222222'];
const svc = (service: string, displayName = service) => ({ service, displayName });
const base = {
  persons: S.map((slug) => ({ slug, name: slug, group: null })),
  headline: '',
  totals: { registered: 10, paid: 8 },
  byWorkCount: [{ displayName: 'U-NEXT', fractionText: '5 / 8作品' }],
  singleCoversAll: false,
};
const PAIR = { ...base, bestPair: { services: [svc('unext'), svc('hulu')], fractionText: '7 / 8作品' }, over80: { achieved: false, combo: null, bestPossible: null } };
const SINGLE = { ...base, bestPair: null, over80: { achieved: false, combo: null, bestPossible: null } };

function worker(sharedCapcut: Record<string, unknown> | null) {
  return {
    templates: [
      {
        templateId: 'oshi-vod-compare-v1',
        narrationModes: sharedCapcut ? ['capcut', 'none'] : ['none'],
        templateInputKind: 'oshi-vod-compare-persons',
        ...(sharedCapcut ? { sharedCapcut } : {}),
      },
    ],
  };
}
const READY = { ready: true, durationSeconds: 17, message: '共通', requires: { kind: 'oshi-vod-compare-feature', feature: 'pair' } };

async function post() {
  const { POST } = await import('../vod-compare-preview/route');
  const res = await POST(new NextRequest('http://localhost/api/admin/video-jobs/vod-compare-preview', { method: 'POST', body: JSON.stringify({ personSlugs: S }) }));
  return { status: res.status, data: await res.json() };
}

beforeEach(() => {
  state.worker = worker(READY);
  state.diagnosis = PAIR;
});

describe('POST /api/admin/video-jobs/vod-compare-preview', () => {
  it('pair（80%以上の表示なし）の3人は capcutCompatible: true', async () => {
    const { status, data } = await post();
    expect(status).toBe(200);
    expect(data).toMatchObject({ capcutCompatible: true, capcutReason: null, bestPair: { services: ['unext', 'hulu'] } });
  });

  it('組み合わせなしの3人は capcutCompatible: false と日本語の理由', async () => {
    state.diagnosis = SINGLE;
    const { data } = await post();
    expect(data.capcutCompatible).toBe(false);
    expect(data.capcutReason).toBe('この3人の診断結果は保存済みCapCut音声の台本と一致しないため、音声なしで生成してください');
  });

  it('WorkerがCapCut（共通音声）を報告していない場合は capcutCompatible: false', async () => {
    state.worker = worker(null);
    expect((await post()).data.capcutCompatible).toBe(false);
    state.worker = null;
    const { data } = await post();
    expect(data.capcutCompatible).toBe(false);
    expect(data.capcutReason).toMatch(/Worker/);
  });
});
