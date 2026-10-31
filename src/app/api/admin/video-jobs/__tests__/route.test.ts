import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 管理画面のジョブ作成: 推しでサブスク比較（3人で1本）だけ新しい分岐に入り、従来のテンプレートは従来どおり。
const state = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  diagnosisError: null as null | { message: string; status: number },
}));

vi.mock('server-only', () => ({}));
// 管理画面の使用状況の記録（Redis には接続しない）
vi.mock('@/server/video-jobs/worker-poll', () => ({ markVideoAdminActive: async () => {} }));
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: async () => ['目黒蓮', '松村北斗', '京本大我'].map((name) => ({ name, group: 'G' })),
}));
vi.mock('@/server/instagram-schedule/schedule-store', () => ({ listReelSchedulesForJobs: async () => ({}) }));
vi.mock('@/server/instagram-post/config', () => ({ isAutopublishEnabled: () => false, isReelsAutopublishEnabled: () => false }));
vi.mock('@/server/video-jobs/job-store', () => {
  class VideoJobError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    VideoJobError,
    failStaleProcessingJobs: async () => {},
    listVideoJobs: async () => [],
    getLatestWorker: async () => ({ templates: state.templates }),
    createVideoJobs: async (input: Record<string, unknown>) => {
      state.created.push(input);
      return [{ id: 'job' }];
    },
  };
});
vi.mock('@/server/oshi-vod/video-diagnosis', async () => {
  const { VideoJobError } = await import('@/server/video-jobs/job-store');
  return {
    loadOshiVodVideoDiagnosis: async (input: { personSlugs: string[] }) => {
      if (state.diagnosisError) throw new VideoJobError(state.diagnosisError.message, state.diagnosisError.status);
      return { persons: input.personSlugs.map((slug, i) => ({ slug, name: ['目黒蓮', '松村北斗', '京本大我'][i] })) };
    },
  };
});

const S = ['p-0123456789ab', 'p-111111111111', 'p-222222222222'];

async function post(body: unknown) {
  const { POST } = await import('../route');
  const res = await POST(new NextRequest('http://localhost/api/admin/video-jobs', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}

beforeEach(() => {
  state.templates = [
    { templateId: 'oshi-first3-v1', narrationModes: ['none'] },
    { templateId: 'oshi-vod-compare-v1', narrationModes: ['none'], templateInputKind: 'oshi-vod-compare-persons' },
  ];
  state.created = [];
  state.diagnosisError = null;
});

describe('POST /api/admin/video-jobs', () => {
  it('従来のテンプレートは人物名のリストのまま作成する（テンプレート固有入力なし）', async () => {
    const { status } = await post({ personNames: ['目黒蓮', '松村北斗'], templateId: 'oshi-first3-v1', narrationMode: 'none' });
    expect(status).toBe(200);
    expect(state.created).toEqual([{ personNames: ['目黒蓮', '松村北斗'], templateId: 'oshi-first3-v1', narrationMode: 'none', templateInput: undefined }]);
  });

  it('推しでサブスク比較は3人のslugを保存し、人物1の名前で1ジョブだけ作る', async () => {
    const { status } = await post({ templateId: 'oshi-vod-compare-v1', narrationMode: 'none', templateInput: { version: 1, personSlugs: S } });
    expect(status).toBe(200);
    expect(state.created).toEqual([
      { personNames: ['目黒蓮'], templateId: 'oshi-vod-compare-v1', narrationMode: 'none', templateInput: { version: 1, personSlugs: S } },
    ]);
  });

  it('推しでサブスク比較: 3人未選択・重複は400で、ジョブを作らない', async () => {
    expect((await post({ templateId: 'oshi-vod-compare-v1', narrationMode: 'none', personNames: ['目黒蓮'] })).status).toBe(400);
    expect((await post({ templateId: 'oshi-vod-compare-v1', narrationMode: 'none', templateInput: { personSlugs: S.slice(0, 2) } })).status).toBe(400);
    expect((await post({ templateId: 'oshi-vod-compare-v1', narrationMode: 'none', templateInput: { personSlugs: [S[0], S[0], S[1]] } })).status).toBe(400);
    expect(state.created).toEqual([]);
  });

  it('推しでサブスク比較: 人物不存在・比較対象0件・比較失敗ならジョブを作らない', async () => {
    for (const error of [
      { message: '推しサーチに登録されていない人物です', status: 404 },
      { message: '比較対象作品が0件のため生成できません', status: 422 },
      { message: '比較結果を取得できませんでした', status: 502 },
    ]) {
      state.diagnosisError = error;
      const { status, data } = await post({ templateId: 'oshi-vod-compare-v1', narrationMode: 'none', templateInput: { personSlugs: S } });
      expect(status).toBe(error.status);
      expect(data.error).toContain(error.message);
    }
    expect(state.created).toEqual([]);
  });
});
