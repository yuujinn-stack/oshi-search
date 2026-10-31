import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personVideoSlug } from '../person-slug';

// 動画「推し活で損してるかも？ V1」（oshi-sonkamo-target）のジョブ作成・再生成。DB・人物データには接続しない。
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
// 公開人物: M!LK の2人と目黒蓮（Snow Man）。グループは所属（persons.group）から決まる
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: async () => [
    { name: '佐野勇斗', group: 'M!LK', config: {} },
    { name: '吉田仁人', group: 'M!LK', config: {} },
    { name: '目黒蓮', group: 'Snow Man', config: {} },
    { name: '斜線の人', group: 'DISH//', config: {} },
  ],
}));
vi.mock('@/lib/group-membership-store', () => ({ getAllMembershipRecords: async () => [] }));
vi.mock('@/lib/group-meta', () => ({ getAllGroupMetas: async () => [{ groupName: 'Snow Man', slug: 'snow-man' }] }));

const T = 'oshi-sonkamo-v1';
const LINES = ['01-hook', '02-works', '03-vod', '04-goods', '05-cta'].map((id) => ({ id, text: `字幕${id}`, kana: `よみ${id}` }));

beforeEach(() => {
  state.worker = {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: 'oshi-first3-v1', name: 'まず見る3作 ショートV1', description: '', version: 1, narrationModes: ['none'] },
      { templateId: T, name: '推し活で損してるかも？ V1', description: '', version: 1, narrationModes: ['capcut', 'none'], templateInputKind: 'oshi-sonkamo-target' },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
  state.source = null;
  state.inserted = [];
});

describe('createVideoJobs: 推し活で損してるかも？', () => {
  it('グループ: person_name にグループ名、ページのパスはDBのグループから作り、原稿・メンバーを保存する', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({
      personNames: ['M!LK'],
      templateId: T,
      narrationMode: 'none',
      // 画面から送られたページのパスは使わない
      templateInput: { version: 1, target: 'group', honorific: '', memberName: '吉田仁人', lines: LINES, pagePath: '/groups/evil' },
    });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      personName: 'M!LK',
      personSlug: personVideoSlug('M!LK'),
      templateId: T,
      templateInput: { version: 1, target: 'group', pagePath: '/groups/M!LK', honorific: '', memberName: '吉田仁人', lines: LINES },
    });
  });

  it('グループの slug が登録済みならそのURL、人物は /person/{名前}（敬称を保存）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({ personNames: ['Snow Man'], templateId: T, narrationMode: 'none', templateInput: { target: 'group', honorific: '' } });
    expect(state.inserted[0].templateInput).toMatchObject({ pagePath: '/groups/snow-man', memberName: null, lines: null });
    await createVideoJobs({ personNames: ['佐野勇斗'], templateId: T, narrationMode: 'none', templateInput: { target: 'person', honorific: 'くん' } });
    expect(state.inserted[1].templateInput).toMatchObject({ target: 'person', pagePath: `/person/${encodeURIComponent('佐野勇斗')}`, honorific: 'くん' });
  });

  it('存在しない人物・グループ、メンバーでない人、扱えない名前、複数指定、不正な敬称は拒否する', async () => {
    const { createVideoJobs } = await import('../job-store');
    const base = { templateId: T, narrationMode: 'none' };
    await expect(createVideoJobs({ ...base, personNames: ['架空の人'], templateInput: { target: 'person' } })).rejects.toThrow(/登録されていない人物/);
    await expect(createVideoJobs({ ...base, personNames: ['架空のグループ'], templateInput: { target: 'group' } })).rejects.toThrow(/公開中のグループではありません/);
    await expect(createVideoJobs({ ...base, personNames: ['M!LK'], templateInput: { target: 'group', memberName: '目黒蓮' } })).rejects.toThrow(/メンバーとして登録されていません/);
    await expect(createVideoJobs({ ...base, personNames: ['DISH//'], templateInput: { target: 'group' } })).rejects.toThrow(/扱えない名前/);
    await expect(createVideoJobs({ ...base, personNames: ['M!LK', 'Snow Man'], templateInput: { target: 'group' } })).rejects.toThrow(/1人だけ/);
    await expect(createVideoJobs({ ...base, personNames: ['佐野勇斗'], templateInput: { target: 'person', honorific: '様' } })).rejects.toThrow(/敬称/);
    await expect(createVideoJobs({ ...base, personNames: ['佐野勇斗'] })).rejects.toThrow(/人物かグループ/);
    expect(state.inserted).toHaveLength(0);
  });

  it('再生成は原稿・敬称・メンバーを引き継ぎ、存在とページのパスを確かめ直す', async () => {
    const { retryVideoJob } = await import('../job-store');
    state.source = {
      id: '00000000-0000-0000-0000-000000000021',
      personName: 'M!LK',
      templateId: T,
      narrationMode: 'none',
      status: 'completed',
      templateInput: { version: 1, target: 'group', pagePath: '/groups/old', honorific: '', memberName: null, lines: LINES },
    };
    await retryVideoJob('00000000-0000-0000-0000-000000000021');
    expect(state.inserted[0].templateInput).toEqual({ version: 1, target: 'group', pagePath: '/groups/M!LK', honorific: '', memberName: null, lines: LINES });
  });

  it('他のテンプレートには入力を渡せない（従来どおり）', async () => {
    const { createVideoJobs } = await import('../job-store');
    await expect(
      createVideoJobs({ personNames: ['目黒蓮'], templateId: 'oshi-first3-v1', narrationMode: 'none', templateInput: { target: 'person' } }),
    ).rejects.toThrow(/受け付けません/);
  });
});

describe('createVideoJobs: 推し活で損してるかも？の CapCut 音声付き', () => {
  const SRC = '00000000-0000-0000-0000-0000000000a1';
  const BLOB = `https://abc.public.blob.vercel-storage.com/video-jobs/${SRC}`;
  const audio = { sourceJobId: SRC, wavUrl: `${BLOB}/capcut-1.wav`, srtUrl: `${BLOB}/capcut-2.srt` };
  const silent = {
    id: SRC,
    personName: 'M!LK',
    templateId: T,
    narrationMode: 'none',
    status: 'completed',
    templateInput: { version: 1, target: 'group', pagePath: '/groups/M!LK', honorific: '', memberName: null, lines: LINES },
    result: { outDir: 'out/sonkamo/M!LK/2026-10-31T10-33-19-621Z' },
  };

  it('完了した音声なし動画に付けた WAV・SRT で、別のジョブを作る（原稿・撮影データの場所は元のジョブから付け直す）', async () => {
    const { createVideoJobs } = await import('../job-store');
    state.source = silent;
    // 画面から別の原稿を送っても使わない
    const other = LINES.map((l) => ({ ...l, text: '違う原稿' }));
    await createVideoJobs({ personNames: ['M!LK'], templateId: T, narrationMode: 'capcut', templateInput: { version: 1, target: 'group', honorific: '', lines: other, audio } });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      personName: 'M!LK',
      narrationMode: 'capcut',
      templateInput: { target: 'group', pagePath: '/groups/M!LK', lines: LINES, audio: { ...audio, sourceOutDir: 'out/sonkamo/M!LK/2026-10-31T10-33-19-621Z' } },
    });
  });

  it('別の人物・未完了・音声付きの元ジョブ、音声なしの CapCut、音声付きの音声なし方式、他のジョブ用の URL は拒否する', async () => {
    const { createVideoJobs } = await import('../job-store');
    const base = { templateId: T, narrationMode: 'capcut' };
    state.source = silent;
    await expect(createVideoJobs({ ...base, personNames: ['Snow Man'], templateInput: { target: 'group', audio } })).rejects.toThrow(/違う人物・グループ/);
    state.source = { ...silent, status: 'processing' };
    await expect(createVideoJobs({ ...base, personNames: ['M!LK'], templateInput: { target: 'group', audio } })).rejects.toThrow(/完了した音声なし動画/);
    state.source = { ...silent, narrationMode: 'capcut' };
    await expect(createVideoJobs({ ...base, personNames: ['M!LK'], templateInput: { target: 'group', audio } })).rejects.toThrow(/完了した音声なし動画/);
    state.source = silent;
    await expect(createVideoJobs({ ...base, personNames: ['M!LK'], templateInput: { target: 'group' } })).rejects.toThrow(/WAV・SRT を付けて/);
    await expect(createVideoJobs({ ...base, narrationMode: 'none', personNames: ['M!LK'], templateInput: { target: 'group', audio } })).rejects.toThrow(/CapCut 方式だけ/);
    await expect(
      createVideoJobs({ ...base, personNames: ['M!LK'], templateInput: { target: 'group', audio: { ...audio, wavUrl: 'https://abc.public.blob.vercel-storage.com/video-jobs/00000000-0000-0000-0000-0000000000ff/capcut-1.wav' } } }),
    ).rejects.toThrow(/アップロードしたファイルだけ/);
    expect(state.inserted).toHaveLength(0);
  });
});
