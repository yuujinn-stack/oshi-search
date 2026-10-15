import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personVideoSlug } from '../person-slug';

// 推しでサブスク比較のCapCutナレーション（テンプレート共通音声）: ジョブ作成・再生成の最終確認。
// DBへは接続しない（drizzleの呼び出しを最小限の偽物で受ける）。診断結果は偽物を返す。
const state = vi.hoisted(() => ({
  worker: null as Record<string, unknown> | null,
  source: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
  diagnosis: null as Record<string, unknown> | null,
  diagnosisCalls: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  db: {
    select: (fields?: unknown) => ({
      from: () => ({
        orderBy: () => ({ limit: async () => (state.worker ? [state.worker] : []) }),
        where: async () => (fields ? [{ queued: 0 }] : state.source ? [state.source] : []),
      }),
    }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        returning: async () => {
          state.inserted.push(...rows);
          return rows;
        },
      }),
    }),
  },
}));
vi.mock('@/server/oshi-vod/video-diagnosis', () => ({
  loadOshiVodVideoDiagnosis: async () => {
    state.diagnosisCalls++;
    return state.diagnosis;
  },
}));

const VOD = 'oshi-vod-compare-v1';
const A = personVideoSlug('目黒蓮');
const B = personVideoSlug('松村北斗');
const C = personVideoSlug('京本大我');
const TRIO = { version: 1, personSlugs: [A, B, C] };
const MISMATCH = 'この3人の診断結果は保存済みCapCut音声の台本と一致しないため、音声なしで生成してください';

const s = (service: string) => ({ service });
const PAIR = { bestPair: { services: [s('unext'), s('hulu')] }, singleCoversAll: false, over80: { achieved: false, combo: null, bestPossible: null } };
const PAIR80 = {
  bestPair: { services: [s('unext'), s('hulu')] },
  singleCoversAll: false,
  over80: { achieved: true, combo: { services: [s('hulu'), s('unext')] }, bestPossible: null },
};
const SINGLE = { bestPair: null, singleCoversAll: false, over80: { achieved: false, combo: null, bestPossible: null } };

function workerRow(vodShared: Record<string, unknown> | null = { ready: true, durationSeconds: 17, message: '共通', requires: { kind: 'oshi-vod-compare-feature', feature: 'pair' } }) {
  return {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: 'oshi-first3-v1', name: 'まず見る3作 ショートV1', description: '', version: 1, narrationModes: ['capcut', 'none'] },
      {
        templateId: 'oshi-aruaru-v1',
        name: '推し活あるある → 解決 ショートV1',
        description: '',
        version: 1,
        narrationModes: ['capcut', 'none'],
        sharedCapcut: { ready: true, durationSeconds: 18, message: '共通' },
      },
      {
        templateId: VOD,
        name: '推しでサブスク比較 ショートV1',
        description: '',
        version: 1,
        narrationModes: vodShared ? ['capcut', 'none'] : ['none'],
        templateInputKind: 'oshi-vod-compare-persons',
        ...(vodShared ? { sharedCapcut: vodShared } : {}),
      },
    ],
    persons: [],
    capcutStore: {
      inboxDir: '',
      reportedAt: new Date().toISOString(),
      entries: [{ personName: '松村北斗', templateId: 'oshi-first3-v1', status: 'ready' }],
      prepareFailures: [],
    },
    capcutPrepareRequests: [],
  };
}

beforeEach(() => {
  state.worker = workerRow();
  state.source = null;
  state.inserted = [];
  state.diagnosis = PAIR;
  state.diagnosisCalls = 0;
});

const create = async (over: Record<string, unknown> = {}) => {
  const { createVideoJobs } = await import('../job-store');
  return createVideoJobs({ personNames: ['目黒蓮'], templateId: VOD, narrationMode: 'capcut', templateInput: TRIO, ...over } as never);
};

describe('createVideoJobs: 推しでサブスク比較のCapCut（テンプレート共通音声）', () => {
  it('診断結果が pair（80%以上の表示なし）の3人は CapCut のジョブを作れる', async () => {
    await create();
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ templateId: VOD, narrationMode: 'capcut', templateInput: TRIO });
  });

  it('pair-over80・組み合わせなしの3人は 400 で拒否し、ジョブを作らない（画面を通さずAPIを呼んでも）', async () => {
    for (const diag of [PAIR80, SINGLE]) {
      state.diagnosis = diag;
      await expect(create()).rejects.toMatchObject({ message: MISMATCH, status: 400 });
    }
    expect(state.inserted).toHaveLength(0);
  });

  it('Workerが利用条件（requires）を報告していない・共通音声が準備できていない場合も拒否する', async () => {
    state.worker = workerRow({ ready: true, durationSeconds: 17, message: '共通' });
    await expect(create()).rejects.toMatchObject({ status: 400 });
    state.worker = workerRow({ ready: false, durationSeconds: null, message: '台本が一致しません', requires: { kind: 'oshi-vod-compare-feature', feature: 'pair' } });
    await expect(create()).rejects.toMatchObject({ status: 400 });
    state.worker = workerRow(null);
    await expect(create()).rejects.toMatchObject({ status: 400 });
    expect(state.inserted).toHaveLength(0);
  });

  it('音声なしは診断結果の種類に関係なく今までどおり作れる（診断結果の確認はしない）', async () => {
    state.diagnosis = SINGLE;
    await create({ narrationMode: 'none' });
    expect(state.inserted).toHaveLength(1);
    expect(state.diagnosisCalls).toBe(0);
  });

  it('再生成でも同じ確認をする（不適合な3人の CapCut ジョブは作り直せない）', async () => {
    const { retryVideoJob } = await import('../job-store');
    state.source = { id: '00000000-0000-0000-0000-000000000007', personName: '目黒蓮', templateId: VOD, narrationMode: 'capcut', status: 'failed', templateInput: TRIO };
    state.diagnosis = SINGLE;
    await expect(retryVideoJob('00000000-0000-0000-0000-000000000007')).rejects.toMatchObject({ message: MISMATCH });
    state.diagnosis = PAIR;
    await retryVideoJob('00000000-0000-0000-0000-000000000007');
    expect(state.inserted).toHaveLength(1);
  });
});

describe('createVideoJobs: 既存テンプレートのCapCutは変わらない', () => {
  it('推し活あるある（従来の共通音声）は人物に関係なく作れる（診断結果の確認なし）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮', '京本大我'], templateId: 'oshi-aruaru-v1', narrationMode: 'capcut' });
    expect(state.inserted).toHaveLength(2);
    expect(state.diagnosisCalls).toBe(0);
  });

  it('人物ごとのCapCut（まず見る3作）は、保存済み音声が ready の人物だけ作れる（従来どおり）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['松村北斗'], templateId: 'oshi-first3-v1', narrationMode: 'capcut' });
    expect(state.inserted).toHaveLength(1);
    await expect(createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'capcut' })).rejects.toThrow(/readyではない/);
    expect(state.diagnosisCalls).toBe(0);
  });
});
