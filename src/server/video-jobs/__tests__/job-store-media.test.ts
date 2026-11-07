import { beforeEach, describe, expect, it, vi } from 'vitest';

// 推しサーチ総合紹介動画（oshi-media-reel）のジョブ作成・CapCut 音声付き。DB・グループデータには接続しない。
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
// 公開サイトのグループ一覧（推し活で損してるかも？と同じ）
vi.mock('../sonkamo-target', () => ({
  isVideoTargetName: (n: string) => n.length > 0 && n === n.trim() && !/[/\\]/.test(n),
  listSonkamoGroups: async () => [
    { name: 'M!LK', members: ['佐野勇斗'] },
    { name: 'Snow Man', members: ['目黒蓮'] },
  ],
}));

const GENERAL = 'OSHI_GENERAL_01';
const GROUP = 'OSHI_GROUP_05';
const SRC = '11111111-2222-4333-8444-555555555555';
const audio = { sourceJobId: SRC, wavUrl: 'https://abc.public.blob.vercel-storage.com/video-jobs/11111111-2222-4333-8444-555555555555/capcut-x.wav', srtUrl: 'https://abc.public.blob.vercel-storage.com/video-jobs/11111111-2222-4333-8444-555555555555/capcut-x.srt' };

beforeEach(() => {
  state.worker = {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: GENERAL, name: '推しサーチ紹介｜神サイト作りました！', description: '', version: 1, narrationModes: ['capcut', 'none'], templateInputKind: 'oshi-media-reel' },
      { templateId: GROUP, name: '推しサーチ紹介｜M!LK推し向け・総合紹介', description: '', version: 1, narrationModes: ['capcut', 'none'], templateInputKind: 'oshi-media-reel' },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
  state.source = null;
  state.inserted = [];
});

describe('createVideoJobs: 推しサーチ総合紹介動画', () => {
  it('一般版は「推しサーチ」で1本。グループ名は持たない', async () => {
    const { createVideoJobs } = await import('../job-store');
    const [job] = await createVideoJobs({ personNames: ['推しサーチ'], templateId: GENERAL, narrationMode: 'none', templateInput: { version: 1, templateCategory: 'oshi_media', groupName: null } });
    expect(job.personName).toBe('推しサーチ');
    expect(state.inserted[0].templateInput).toMatchObject({ version: 1, templateCategory: 'oshi_media', groupName: null, templateId: GENERAL });
    await expect(createVideoJobs({ personNames: ['推しサーチ'], templateId: GENERAL, narrationMode: 'none', templateInput: { groupName: 'M!LK' } })).rejects.toThrow('グループ名は指定できません');
    await expect(createVideoJobs({ personNames: ['M!LK'], templateId: GENERAL, narrationMode: 'none', templateInput: {} })).rejects.toThrow('推しサーチ');
  });

  it('グループ版は登録済みのグループだけ。グループ名が無ければ作らない', async () => {
    const { createVideoJobs } = await import('../job-store');
    const [job] = await createVideoJobs({ personNames: ['Snow Man'], templateId: GROUP, narrationMode: 'none', templateInput: { groupName: 'Snow Man' } });
    expect(job.personName).toBe('Snow Man');
    expect(state.inserted[0].templateInput).toMatchObject({ groupName: 'Snow Man', templateId: GROUP });
    await expect(createVideoJobs({ personNames: ['未登録G'], templateId: GROUP, narrationMode: 'none', templateInput: { groupName: '未登録G' } })).rejects.toThrow('登録されていない');
    await expect(createVideoJobs({ personNames: ['推しサーチ'], templateId: GROUP, narrationMode: 'none', templateInput: { groupName: null } })).rejects.toThrow('グループ名が未設定');
    await expect(createVideoJobs({ personNames: ['M!LK'], templateId: GROUP, narrationMode: 'none', templateInput: { groupName: 'Snow Man' } })).rejects.toThrow('一致しません');
  });

  it('作成フォームから CapCut は選べない（音声は完成した音声なし動画に付ける）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await expect(createVideoJobs({ personNames: ['推しサーチ'], templateId: GENERAL, narrationMode: 'capcut', templateInput: { groupName: null } })).rejects.toThrow('音声付きの動画は');
    await expect(createVideoJobs({ personNames: ['推しサーチ'], templateId: GENERAL, narrationMode: 'none', templateInput: { groupName: null, audio } })).rejects.toThrow('CapCut 方式だけ');
  });

  it('CapCut 音声付きは、元の音声なし動画からグループ名と撮影データの場所を付け直す', async () => {
    const { createVideoJobs } = await import('../job-store');
    state.source = {
      id: SRC,
      templateId: GROUP,
      status: 'completed',
      narrationMode: 'none',
      personName: 'M!LK',
      templateInput: { version: 1, templateCategory: 'oshi_media', groupName: 'M!LK', templateId: GROUP },
      result: { outDir: 'out/media/OSHI_GROUP_05/2026-11-07_M!LK' },
    };
    const [job] = await createVideoJobs({ personNames: ['M!LK'], templateId: GROUP, narrationMode: 'capcut', templateInput: { version: 1, templateCategory: 'oshi_media', groupName: null, audio } });
    expect(job.narrationMode).toBe('capcut');
    expect(state.inserted[0].templateInput).toMatchObject({ groupName: 'M!LK', audio: { ...audio, sourceOutDir: 'out/media/OSHI_GROUP_05/2026-11-07_M!LK' } });
    // 別のテンプレート・別の対象・未完成の元動画には付けられない
    await expect(createVideoJobs({ personNames: ['推しサーチ'], templateId: GENERAL, narrationMode: 'capcut', templateInput: { groupName: null, audio } })).rejects.toThrow('同じテンプレート');
    await expect(createVideoJobs({ personNames: ['Snow Man'], templateId: GROUP, narrationMode: 'capcut', templateInput: { groupName: null, audio } })).rejects.toThrow('違う対象');
    state.source = { ...state.source, status: 'processing' };
    await expect(createVideoJobs({ personNames: ['M!LK'], templateId: GROUP, narrationMode: 'capcut', templateInput: { groupName: null, audio } })).rejects.toThrow('完了した音声なし動画');
  });
});
