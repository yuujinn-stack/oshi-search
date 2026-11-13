import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SNS_CTA } from '@/lib/video-sns-output';

// DBへは接続しない（drizzleの呼び出しを最小限の偽物で受ける）。出力先SNSの指定をどう保存するかを確認する。
const state = vi.hoisted(() => ({
  worker: null as Record<string, unknown> | null,
  source: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        orderBy: () => ({ limit: async () => (state.worker ? [state.worker] : []) }),
        // 待機中件数（queued）／元のジョブ（template_input だけ・全体）
        where: async () => (fields && 'queued' in fields ? [{ queued: 0 }] : state.source ? [state.source] : []),
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

const both = { version: 1, targets: ['instagram', 'tiktok'], cta: DEFAULT_SNS_CTA };

function workerRow(snsCta: unknown) {
  return {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: 'oshi-first3-v1', name: 'まず見る3作 ショートV1', description: '', version: 1, narrationModes: ['none', 'capcut'], ...(snsCta ? { snsCta } : {}) },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
}

beforeEach(() => {
  state.worker = workerRow({ version: 1, modes: ['none', 'capcut'], reason: null });
  state.source = null;
  state.inserted = [];
});

describe('createVideoJobs: 出力先SNS', () => {
  it('指定が無ければ従来どおり template_input に触れない', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none' });
    expect('templateInput' in state.inserted[0]).toBe(false);
  });

  it('指定があれば template_input の snsOutput に保存する（従来のテンプレートでも）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮', '松村北斗'], templateId: 'oshi-first3-v1', narrationMode: 'none', snsOutput: both });
    expect(state.inserted).toHaveLength(2);
    for (const row of state.inserted) {
      expect((row.templateInput as { snsOutput: { targets: string[] } }).snsOutput.targets).toEqual(['instagram', 'tiktok']);
      expect(Object.keys(row.templateInput as object)).toEqual(['snsOutput']);
    }
  });

  it('再生成: 元ジョブの template_input に保存した指定を引き継ぐ（テンプレート固有入力の検証には渡さない）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', templateInput: { snsOutput: both } });
    expect((state.inserted[0].templateInput as { snsOutput: unknown }).snsOutput).toEqual(both);
  });

  it('CTA を差し替える SNS は、Worker が未対応の方式なら理由つきで拒否する', async () => {
    state.worker = workerRow({ version: 1, modes: ['none'], reason: 'CapCut 音声版は未対応です。' });
    const { createVideoJobs } = await import('../job-store');
    await expect(createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'capcut', snsOutput: both })).rejects.toThrow(
      /TikTok版（CTAの差し替え）に未対応です: CapCut 音声版は未対応です。/,
    );
    expect(state.inserted).toHaveLength(0);
  });

  it('古い Worker（報告なし）: TikTok 版は拒否、Instagram のみ（テンプレートのCTAのまま）は受け付ける', async () => {
    state.worker = workerRow(null);
    const { createVideoJobs } = await import('../job-store');
    await expect(createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', snsOutput: both })).rejects.toThrow(/Worker が SNS別CTA に対応していません/);
    await createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', snsOutput: { ...both, targets: ['instagram'] } });
    expect(state.inserted).toHaveLength(1);
  });

  it('不正な指定は 400', async () => {
    const { createVideoJobs, VideoJobError } = await import('../job-store');
    await expect(createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', snsOutput: { version: 1, targets: [] } })).rejects.toBeInstanceOf(VideoJobError);
  });
});
