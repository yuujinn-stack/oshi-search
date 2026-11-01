import { beforeEach, describe, expect, it, vi } from 'vitest';

// フォロー獲得リールの CapCut 音声の自動取り込み（Worker の受信フォルダ → 推しサーチ）。DB・Blob・ジョブ作成は偽物。
const state = vi.hoisted(() => ({
  /** select() の結果を呼ばれた順に返す */
  queue: [] as Array<Array<Record<string, unknown>>>,
  created: [] as Array<Record<string, unknown>>,
  tokens: [] as Array<Record<string, unknown>>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: async (o: Record<string, unknown>) => {
    state.tokens.push(o);
    return 'client-token';
  },
}));
vi.mock('@/db/client', () => {
  const next = async () => state.queue.shift() ?? [];
  // where() はそのまま await しても .limit() を付けても、結果を1つだけ取り出す
  const where = () => ({ then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej), limit: next });
  return { db: { select: () => ({ from: () => ({ where }) }) } };
});
vi.mock('../job-store', () => {
  class VideoJobError extends Error {
    constructor(message: string, readonly status = 400) {
      super(message);
    }
  }
  return {
    VideoJobError,
    createVideoJobs: async (input: Record<string, unknown>) => {
      state.created.push(input);
      return [{ id: 'eeeeeeee-0000-4000-8000-000000000001' }];
    },
  };
});

const SOURCE = {
  id: 'ab12cd34-0000-4000-8000-000000000001',
  personName: 'M!LK',
  personSlug: 'p-0123456789ab',
  templateId: 'follow_three_works',
  narrationMode: 'none',
  status: 'completed',
  completedAt: new Date('2026-11-01T10:00:00Z'),
  templateInput: { targetType: 'group' },
};
const KEY = { jobKey: 'ab12cd34', personSlug: 'p-0123456789ab', templateId: 'follow_three_works' };

beforeEach(() => {
  state.queue = [];
  state.created = [];
  state.tokens = [];
});

describe('prepareCapcutAutoImport: 元のジョブの確認とアップロード許可', () => {
  it('ジョブID・人物slug・テンプレート・状態が合えば、手動の取り込みと同じパス・条件の許可を WAV・SRT に出す', async () => {
    const { prepareCapcutAutoImport } = await import('../capcut-auto-import');
    state.queue.push([SOURCE], []);
    const r = await prepareCapcutAutoImport(KEY, { wavBytes: 3_000_000, srtBytes: 900 });
    expect(r).toMatchObject({ sourceJobId: SOURCE.id, personName: 'M!LK', completedAt: '2026-11-01T10:00:00.000Z' });
    expect(r.wav.pathname).toMatch(new RegExp(`^video-jobs/${SOURCE.id}/capcut-[0-9a-f]{16}\\.wav$`));
    expect(r.srt.pathname).toMatch(new RegExp(`^video-jobs/${SOURCE.id}/capcut-[0-9a-f]{16}\\.srt$`));
    expect(state.tokens.map((t) => [t.allowedContentTypes, t.allowOverwrite, t.addRandomSuffix])).toEqual([
      [['audio/wav'], false, false],
      [['text/plain'], false, false],
    ]);
  });

  it('別の人物・別のテンプレート・音声付き/未完了・見つからない・複数・作成中があれば拒否する（許可を出さない）', async () => {
    const { prepareCapcutAutoImport } = await import('../capcut-auto-import');
    const sizes = { wavBytes: 1000, srtBytes: 100 };
    const cases: Array<[Array<Array<Record<string, unknown>>>, Partial<typeof KEY>, RegExp]> = [
      [[[{ ...SOURCE, personSlug: 'p-ffffffffffff', personName: '佐野勇斗' }]], {}, /別の人物・グループ（佐野勇斗）/],
      [[[{ ...SOURCE, templateId: 'follow_hidden_works' }]], {}, /別のテンプレート/],
      [[[{ ...SOURCE, narrationMode: 'capcut' }]], {}, /完了した音声なし動画ではありません/],
      [[[{ ...SOURCE, status: 'processing' }]], {}, /完了した音声なし動画ではありません/],
      [[[]], {}, /見つかりません/],
      [[[SOURCE, { ...SOURCE, id: 'ab12cd34-1111-4000-8000-000000000002' }]], {}, /1件に決まりません/],
      [[[SOURCE], [{ id: 'cccccccc-0000-4000-8000-000000000003' }]], {}, /すでに作成中です（ジョブ cccccccc）/],
      [[], { jobKey: 'XYZ' }, /ジョブID（先頭8桁の英数字）が不正/],
      [[], { templateId: 'oshi-sonkamo-v1' }, /対応していないテンプレート/],
    ];
    for (const [queue, over, re] of cases) {
      state.queue = [...queue];
      state.tokens = [];
      await expect(prepareCapcutAutoImport({ ...KEY, ...over }, sizes), String(re)).rejects.toThrow(re);
      expect(state.tokens).toHaveLength(0);
    }
    state.queue = [[SOURCE], []];
    await expect(prepareCapcutAutoImport(KEY, { wavBytes: 61 * 1024 * 1024, srtBytes: 100 })).rejects.toThrow(/WAV は 60MB まで/);
  });
});

describe('attachCapcutAutoImport: 音声付き動画のジョブ作成', () => {
  it('手動の「音声付き動画を生成」と同じ入力で createVideoJobs を呼ぶ（人物・グループの種類は元のジョブから）', async () => {
    const { attachCapcutAutoImport } = await import('../capcut-auto-import');
    const wavUrl = `https://abc.public.blob.vercel-storage.com/video-jobs/${SOURCE.id}/capcut-1.wav`;
    const srtUrl = `https://abc.public.blob.vercel-storage.com/video-jobs/${SOURCE.id}/capcut-2.srt`;
    state.queue.push([SOURCE], [SOURCE], [], []);
    const job = await attachCapcutAutoImport({ sourceJobId: SOURCE.id, wavUrl, srtUrl });
    expect(job.id).toBe('eeeeeeee-0000-4000-8000-000000000001');
    expect(state.created).toEqual([
      {
        personNames: ['M!LK'],
        templateId: 'follow_three_works',
        narrationMode: 'capcut',
        templateInput: { version: 1, targetType: 'group', selectedWorkIds: [], facts: [], periodStart: null, pickWorkId: null, lines: null, audio: { sourceJobId: SOURCE.id, wavUrl, srtUrl } },
      },
    ]);
  });

  it('作る直前にも確かめ直し、作成中の音声付き動画があれば二重に作らない', async () => {
    const { attachCapcutAutoImport } = await import('../capcut-auto-import');
    state.queue.push([SOURCE], [SOURCE], [{ id: 'cccccccc-0000-4000-8000-000000000003' }]);
    await expect(attachCapcutAutoImport({ sourceJobId: SOURCE.id, wavUrl: 'x', srtUrl: 'y' })).rejects.toThrow(/すでに作成中/);
    state.queue.push([{ ...SOURCE, status: 'failed' }], [{ ...SOURCE, status: 'failed' }]);
    await expect(attachCapcutAutoImport({ sourceJobId: SOURCE.id, wavUrl: 'x', srtUrl: 'y' })).rejects.toThrow(/完了した音声なし動画ではありません/);
    expect(state.created).toHaveLength(0);
  });
});

describe('登録グループ紹介のリール: 同じ自動取り込み', () => {
  const REG = { ...SOURCE, personName: '推しサーチ', templateId: 'registered_groups_all', templateInput: { templateCategory: 'registered_groups' } };
  const REG_KEY = { ...KEY, templateId: 'registered_groups_all' };

  it('リールは受け付け、音声付きのジョブは区間・台本を元のジョブから付け直す入力で作る', async () => {
    const { prepareCapcutAutoImport, attachCapcutAutoImport } = await import('../capcut-auto-import');
    state.queue.push([REG], []);
    await expect(prepareCapcutAutoImport(REG_KEY, { wavBytes: 1000, srtBytes: 100 })).resolves.toMatchObject({ sourceJobId: REG.id, personName: '推しサーチ' });
    const wavUrl = `https://abc.public.blob.vercel-storage.com/video-jobs/${REG.id}/capcut-1.wav`;
    const srtUrl = `https://abc.public.blob.vercel-storage.com/video-jobs/${REG.id}/capcut-2.srt`;
    state.queue.push([REG], [REG], [], []);
    await attachCapcutAutoImport({ sourceJobId: REG.id, wavUrl, srtUrl });
    expect(state.created).toEqual([
      {
        personNames: ['推しサーチ'],
        templateId: 'registered_groups_all',
        narrationMode: 'capcut',
        templateInput: { version: 1, templateCategory: 'registered_groups', selection: { order: null, excluded: [] }, lines: [], audio: { sourceJobId: REG.id, wavUrl, srtUrl } },
      },
    ]);
  });

  it('ストーリーズ（音声なしだけ）は自動取り込みの対象外', async () => {
    const { prepareCapcutAutoImport } = await import('../capcut-auto-import');
    await expect(prepareCapcutAutoImport({ ...KEY, templateId: 'story_registered_groups_all' }, { wavBytes: 1000, srtBytes: 100 })).rejects.toThrow(/対応していないテンプレート/);
  });
});
