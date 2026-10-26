import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personVideoSlug } from '../person-slug';

// 動画「推し布教カード紹介」（oshi-card-selection）のジョブ作成・再生成。DB・人物データには接続しない。
const state = vi.hoisted(() => ({
  worker: null as Record<string, unknown> | null,
  source: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
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
// 布教カードの候補（その人物の公開作品）。目黒蓮だけ公開人物として作品3件を持つ
vi.mock('@/lib/oshi-card/data', () => ({
  loadOshiCardPerson: async (name: string) =>
    name === '目黒蓮'
      ? {
          name,
          group: 'Snow Man',
          candidates: ['w1', 'w2', 'w3'].map((id) => ({ id, title: `作品${id}`, displayType: 'movie', typeLabel: '映画', year: 2024, url: null })),
        }
      : null,
}));

const CARD = 'oshi-card-intro-v1';

beforeEach(() => {
  state.worker = {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: 'oshi-first3-v1', name: 'まず見る3作 ショートV1', description: '', version: 1, narrationModes: ['none'] },
      {
        templateId: CARD,
        name: '推し布教カード紹介｜18秒',
        description: '',
        version: 1,
        narrationModes: ['none', 'capcut'],
        templateInputKind: 'oshi-card-selection',
        sharedCapcut: { ready: true, durationSeconds: 18, message: 'ok' },
      },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
  state.source = null;
  state.inserted = [];
});

describe('createVideoJobs: 推し布教カード紹介', () => {
  it('1件・2件・3件の作品を選んだ順のままデザインと一緒に保存する（1ジョブ・人物1人）', async () => {
    const { createVideoJobs } = await import('../job-store');
    for (const workIds of [['w2'], ['w3', 'w1'], ['w1', 'w3', 'w2']]) {
      state.inserted = [];
      await createVideoJobs({ personNames: ['目黒蓮'], templateId: CARD, narrationMode: 'capcut', templateInput: { version: 1, workIds, variant: 'cute' } });
      expect(state.inserted).toHaveLength(1);
      expect(state.inserted[0]).toMatchObject({
        personName: '目黒蓮',
        personSlug: personVideoSlug('目黒蓮'),
        templateId: CARD,
        templateInput: { version: 1, workIds, variant: 'cute' },
      });
    }
  });

  it('他の人物の作品・存在しない作品、布教カードで選べない人物、複数人物、入力なしは拒否する', async () => {
    const { createVideoJobs } = await import('../job-store');
    const base = { personNames: ['目黒蓮'], templateId: CARD, narrationMode: 'none' };
    await expect(createVideoJobs({ ...base, templateInput: { workIds: ['w1', 'other'], variant: 'cool' } })).rejects.toThrow(/公開作品にない/);
    await expect(createVideoJobs({ ...base, personNames: ['架空の人'], templateInput: { workIds: ['w1'], variant: 'cool' } })).rejects.toThrow(/選べない人物/);
    await expect(
      createVideoJobs({ ...base, personNames: ['目黒蓮', '松村北斗'], templateInput: { workIds: ['w1'], variant: 'cool' } }),
    ).rejects.toThrow(/1人だけ/);
    await expect(createVideoJobs(base)).rejects.toThrow(/おすすめ作品とデザイン/);
    await expect(createVideoJobs({ ...base, templateInput: { workIds: ['w1', 'w2', 'w3', 'w4'], variant: 'cool' } })).rejects.toThrow(/1〜3件/);
    expect(state.inserted).toHaveLength(0);
  });

  it('他のテンプレートには作品の入力を渡せない（従来どおり）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await expect(
      createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', templateInput: { workIds: ['w1'], variant: 'cool' } }),
    ).rejects.toThrow(/受け付けません/);
  });

  it('再生成は作品・順番・デザインをそのまま引き継ぎ、作品も確かめ直す', async () => {
    const { retryVideoJob } = await import('../job-store');
    state.source = {
      id: '00000000-0000-0000-0000-000000000011',
      personName: '目黒蓮',
      templateId: CARD,
      narrationMode: 'none',
      status: 'completed',
      templateInput: { version: 1, workIds: ['w3', 'w1'], variant: 'cool' },
    };
    await retryVideoJob('00000000-0000-0000-0000-000000000011');
    expect(state.inserted[0].templateInput).toEqual({ version: 1, workIds: ['w3', 'w1'], variant: 'cool' });
  });
});
