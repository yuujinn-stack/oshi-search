import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personVideoSlug } from '../person-slug';

// DBへは接続しない（drizzleの呼び出しを最小限の偽物で受ける）。作成・再生成で保存しようとした行を確認する。
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
        // getLatestWorker
        orderBy: () => ({ limit: async () => (state.worker ? [state.worker] : []) }),
        // 待機中件数（fields指定あり）／再生成の元ジョブ（fields指定なし）
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

const VOD = 'oshi-vod-compare-v1';
const A = personVideoSlug('目黒蓮');
const B = personVideoSlug('松村北斗');
const C = personVideoSlug('京本大我');

function workerRow() {
  return {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: 'oshi-first3-v1', name: 'まず見る3作 ショートV1', description: '', version: 1, narrationModes: ['none', 'capcut'] },
      {
        templateId: VOD,
        name: '推しでサブスク比較 ショートV1',
        description: '',
        version: 1,
        narrationModes: ['none'],
        templateInputKind: 'oshi-vod-compare-persons',
      },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
}

beforeEach(() => {
  state.worker = workerRow();
  state.source = null;
  state.inserted = [];
});

describe('createVideoJobs: テンプレート固有入力', () => {
  it('従来のテンプレートは template_input に触れない（人物ごとに1ジョブ）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮', '松村北斗'], templateId: 'oshi-first3-v1', narrationMode: 'none' });
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted.every((r) => !('templateInput' in r))).toBe(true);
    expect(state.inserted.map((r) => r.personSlug)).toEqual([A, B]);
  });

  it('従来のテンプレートにテンプレート固有入力を渡すと拒否する', async () => {
    const { createVideoJobs } = await import('../job-store');
    await expect(
      createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', templateInput: { personSlugs: [A, B, C] } }),
    ).rejects.toThrow(/受け付けません/);
    expect(state.inserted).toHaveLength(0);
  });

  it('推しでサブスク比較: 3人のslugを選択順のまま保存し、人物1を person_name / person_slug に入れる', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮'], templateId: VOD, narrationMode: 'none', templateInput: { version: 1, personSlugs: [A, B, C] } });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ personName: '目黒蓮', personSlug: A, templateId: VOD, templateInput: { version: 1, personSlugs: [A, B, C] } });
  });

  it('推しでサブスク比較: 入力なし・3人未満・重複・不正slug・人物1の食い違いを拒否する', async () => {
    const { createVideoJobs } = await import('../job-store');
    const base = { personNames: ['目黒蓮'], templateId: VOD, narrationMode: 'none' };
    await expect(createVideoJobs(base)).rejects.toThrow(/3人の指定/);
    await expect(createVideoJobs({ ...base, templateInput: { personSlugs: [A, B] } })).rejects.toThrow(/3人ちょうど/);
    await expect(createVideoJobs({ ...base, templateInput: { personSlugs: [A, B, A] } })).rejects.toThrow(/重複/);
    await expect(createVideoJobs({ ...base, templateInput: { personSlugs: [A, B, 'kyomoto-taiga'] } })).rejects.toThrow(/不正な人物/);
    await expect(createVideoJobs({ ...base, templateInput: { personSlugs: [B, A, C] } })).rejects.toThrow(/人物1/);
    await expect(
      createVideoJobs({ ...base, personNames: ['目黒蓮', '松村北斗'], templateInput: { personSlugs: [A, B, C] } }),
    ).rejects.toThrow(/人物1/);
    expect(state.inserted).toHaveLength(0);
  });
});

describe('retryVideoJob: テンプレート固有入力の引き継ぎ', () => {
  it('3人の入力を順番・人数を変えずにそのままコピーする', async () => {
    const { retryVideoJob } = await import('../job-store');
    state.source = {
      id: '00000000-0000-0000-0000-000000000009',
      personName: '目黒蓮',
      templateId: VOD,
      narrationMode: 'none',
      status: 'failed',
      templateInput: { version: 1, personSlugs: [A, B, C] },
    };
    await retryVideoJob('00000000-0000-0000-0000-000000000009');
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].templateInput).toEqual({ version: 1, personSlugs: [A, B, C] });
    expect(state.inserted[0].personName).toBe('目黒蓮');
    expect(state.inserted[0].retryOfJobId).toBe('00000000-0000-0000-0000-000000000009');
  });

  it('従来のテンプレートの再生成は従来どおり（template_input なし）', async () => {
    const { retryVideoJob } = await import('../job-store');
    state.source = {
      id: '00000000-0000-0000-0000-000000000008',
      personName: '松村北斗',
      templateId: 'oshi-first3-v1',
      narrationMode: 'none',
      status: 'completed',
      templateInput: null,
    };
    await retryVideoJob('00000000-0000-0000-0000-000000000008');
    expect(state.inserted).toHaveLength(1);
    expect('templateInput' in state.inserted[0]).toBe(false);
    expect(state.inserted[0]).toMatchObject({ personName: '松村北斗', personSlug: B, templateId: 'oshi-first3-v1' });
  });
});
