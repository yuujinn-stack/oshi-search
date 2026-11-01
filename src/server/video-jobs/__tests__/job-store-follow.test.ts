import { beforeEach, describe, expect, it, vi } from 'vitest';
import { personVideoSlug } from '../person-slug';

// 動画「フォロー獲得リール」（oshi-follow-reel）のジョブ作成・CapCut 音声付き。DB・人物データには接続しない。
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
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: async () => [
    { name: '佐野勇斗', group: 'M!LK', config: {} },
    { name: '吉田仁人', group: 'M!LK', config: {} },
  ],
}));
vi.mock('@/lib/group-membership-store', () => ({ getAllMembershipRecords: async () => [] }));
vi.mock('@/lib/group-meta', () => ({ getAllGroupMetas: async () => [{ groupName: 'M!LK', slug: 'milk' }] }));
// Hulu は管理画面で停止中（配信終了済み）のサービスとして扱う
vi.mock('@/lib/provider-store', () => ({ getInactiveProviderSlugs: async () => new Set<string>(['hulu']) }));
// 公開作品: 同じ作品（TMDb の作品ID が同じ）に2人が出演している
const vp = (providerName: string, type: string, over: Record<string, unknown> = {}) => ({ providerId: 0, providerName, type, countryCode: 'JP', source: 'manual', ...over });
const rec = (personName: string, id: string, over: Record<string, unknown> = {}) => ({
  id,
  personName,
  title: `作品${id}`,
  normalizedTitle: `作品${id}`,
  type: 'tv',
  releaseYear: 2020,
  roleName: '出演',
  vodProviders: [{ providerId: 1, providerName: 'U-NEXT', type: 'flatrate', countryCode: 'JP', source: 'manual', checkedDate: '2026-10-20' }],
  ...over,
});
vi.mock('@/lib/work-store', () => ({
  getPublishedWorksOrThrow: async (name: string) =>
    name === '佐野勇斗'
      ? [
          rec('佐野勇斗', 'a', { tmdbId: 1, roleName: 'たろう' }),
          rec('佐野勇斗', 'b', { tmdbId: 2 }),
          rec('佐野勇斗', 'c', { tmdbId: 3, roleName: 'じろう' }),
          // 配信先が確認できない作品: 配信情報なし／unknown だけ／非表示・停止中サービス・AI低確度だけ
          rec('佐野勇斗', 'n', { tmdbId: 5, vodProviders: [] }),
          rec('佐野勇斗', 'u', { tmdbId: 6, vodProviders: [vp('unknown', 'unknown')] }),
          rec('佐野勇斗', 'h', { tmdbId: 7, vodProviders: [vp('U-NEXT', 'flatrate', { hidden: true }), vp('Hulu', 'flatrate'), vp('Netflix', 'flatrate', { source: 'openai_web_search', confidence: 'low' })] }),
          // Prime Video の通常の見放題と追加チャンネル、レンタル
          rec('佐野勇斗', 'csv-tv-1', { title: 'CSV番組', normalizedTitle: 'CSV番組', releaseYear: 2026 }),
          rec('佐野勇斗', 'p', { tmdbId: 8, vodProviders: [vp('Amazon Prime Video', 'flatrate'), vp('Amazon Prime Video（TELASA）', 'flatrate'), vp('Lemino', 'rent')] }),
        ]
      : [
          rec('吉田仁人', 'x', { tmdbId: 1, vodProviders: [vp('Netflix', 'rent')] }),
          rec('吉田仁人', 'y', { tmdbId: 4, releaseYear: null }),
          // CSV の作品: 同じ作品ID でメンバーごとに出演年が違う（TMDb の作品ID なし）
          rec('吉田仁人', 'csv-tv-1', { title: 'CSV番組', normalizedTitle: 'CSV番組', releaseYear: 2025 }),
        ],
}));

const T = 'follow_three_works';
const LINES = ['01-hook', '02-item', '03-item', '04-item', '05-outro'].map((id) => ({ id, text: `字幕${id}`, kana: 'よみ' }));

beforeEach(() => {
  state.worker = {
    workerId: 'mac-test',
    lastSeenAt: new Date(),
    version: 'test',
    templates: [
      { templateId: T, name: 'フォロー獲得｜推しをもっと知るための3作品', description: '', version: 1, narrationModes: ['capcut', 'none'], templateInputKind: 'oshi-follow-reel' },
      { templateId: 'follow_genre_breakdown', name: 'ジャンル分析', description: '', version: 1, narrationModes: ['none'], templateInputKind: 'oshi-follow-reel' },
    ],
    persons: [],
    capcutStore: null,
    capcutPrepareRequests: [],
  };
  state.source = null;
  state.inserted = [];
});

describe('loadFollowTarget', () => {
  it('グループはメンバーの作品を同じ作品ごとにまとめ、役名は使わない。人物は「出演」など役名でない登録値を外す', async () => {
    const { loadFollowTarget } = await import('../follow-target');
    const g = await loadFollowTarget('group', 'M!LK');
    expect(g.personNames).toEqual(['佐野勇斗', '吉田仁人']);
    expect(g.works).toHaveLength(9);
    expect(g.works.find((w) => w.id === 'a')).toMatchObject({ persons: ['佐野勇斗', '吉田仁人'], roleName: null });
    const p = await loadFollowTarget('person', '佐野勇斗');
    expect(p.works.filter((w) => 'abc'.includes(w.id)).map((w) => [w.id, w.roleName])).toEqual([['a', 'たろう'], ['b', null], ['c', 'じろう']]);
    expect(p.works[0].streaming).toEqual([{ provider: 'U-NEXT', typeLabel: '見放題', checkedDate: '2026-10-20' }]);
  });
});

describe('loadFollowTarget: 作品選択欄の配信先（公開画面と同じ判定）', () => {
  it('配信情報なし・unknown だけ・非表示／停止中サービス／AI低確度だけの作品は配信先なし。区分・追加チャンネルを分けて付ける', async () => {
    const { loadFollowTarget } = await import('../follow-target');
    const p = await loadFollowTarget('person', '佐野勇斗');
    const av = (id: string) => p.works.find((w) => w.id === id)!.available;
    expect(av('n')).toEqual([]);
    expect(av('u')).toEqual([]);
    expect(av('h')).toEqual([]);
    expect(av('a')).toEqual([{ key: 'unext', provider: 'U-NEXT', typeLabel: '見放題', channel: false }]);
    expect(av('p')).toEqual([
      { key: 'primevideo', provider: 'Prime Video', typeLabel: '見放題', channel: false },
      { key: 'telasaamazonchannel', provider: 'Prime Video内 TELASAチャンネル', typeLabel: '見放題', channel: true },
      { key: 'lemino', provider: 'Lemino', typeLabel: 'レンタル', channel: false },
    ]);
    // 台本に使う「今すぐ見られる配信」（見放題・無料）は今までどおり。レンタルは入らない
    expect(p.works.find((w) => w.id === 'p')!.streaming.map((s) => s.provider)).toEqual(['Amazon Prime Video', 'Amazon Prime Video（TELASA）']);
  });

  it('グループで同じ作品に複数メンバーの登録があるときは1件にまとめ、配信先は全員分の登録から判定する', async () => {
    const { loadFollowTarget } = await import('../follow-target');
    const g = await loadFollowTarget('group', 'M!LK');
    expect(g.works.filter((w) => w.id === 'a' || w.id === 'x')).toHaveLength(1);
    // 同じ作品ID は出演年が違っても1件（公開画面のグループページと同じ）。ID の重複が無い
    expect(g.works.filter((w) => w.id === 'csv-tv-1')).toEqual([expect.objectContaining({ persons: ['佐野勇斗', '吉田仁人'], year: 2026 })]);
    expect(new Set(g.works.map((w) => w.id)).size).toBe(g.works.length);
    expect(g.works.find((w) => w.id === 'a')!.available!.map((a) => `${a.provider}:${a.typeLabel}`)).toEqual(['U-NEXT:見放題', 'Netflix:レンタル']);
  });
});

describe('createVideoJobs: フォロー獲得リール', () => {
  it('シーンはサーバーがDBの作品から作り直し（画面から送ったシーンは使わない）、出典・ページのパスを付けて保存する', async () => {
    const { createVideoJobs } = await import('../job-store');
    await createVideoJobs({
      personNames: ['M!LK'],
      templateId: T,
      narrationMode: 'none',
      templateInput: { version: 1, targetType: 'group', selectedWorkIds: ['a', 'b', 'c'], facts: [], lines: LINES, scenes: [{ id: 'fake' }] },
    });
    expect(state.inserted).toHaveLength(1);
    const ti = state.inserted[0].templateInput as Record<string, unknown> & { scenes: Array<{ id: string; title?: string }> };
    expect(state.inserted[0]).toMatchObject({ personName: 'M!LK', personSlug: personVideoSlug('M!LK'), templateId: T });
    expect(ti).toMatchObject({ targetType: 'group', templateCategory: 'follow_growth', personNames: ['佐野勇斗', '吉田仁人'], pagePath: '/groups/milk', lines: LINES });
    expect(ti.scenes.map((s) => s.id)).toEqual(LINES.map((l) => l.id));
    expect(ti.scenes[1].title).toBe('作品a');
  });

  it('公開作品にない作品・台本と構成の不一致・足りない選択は拒否する（ジョブを作らない）', async () => {
    const { createVideoJobs } = await import('../job-store');
    const base = { personNames: ['佐野勇斗'], templateId: T, narrationMode: 'none' };
    await expect(createVideoJobs({ ...base, templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b', 'zzz'], lines: LINES } })).rejects.toThrow(/必要な情報が足りない/);
    await expect(createVideoJobs({ ...base, templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b'], lines: LINES } })).rejects.toThrow(/3本選んでください/);
    await expect(createVideoJobs({ ...base, templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b', 'n'], lines: LINES } })).rejects.toThrow(/配信先が確認されていません/);
    await expect(createVideoJobs({ ...base, templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b', 'c'], lines: LINES.slice(0, 4) } })).rejects.toThrow(/構成と合いません/);
    await expect(createVideoJobs({ ...base, personNames: ['架空の人'], templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b', 'c'], lines: LINES } })).rejects.toThrow(/登録されていない人物/);
    await expect(createVideoJobs({ ...base, narrationMode: 'capcut', templateInput: { targetType: 'person', selectedWorkIds: ['a', 'b', 'c'], lines: LINES } })).rejects.toThrow(/WAV・SRT を付けて/);
    expect(state.inserted).toHaveLength(0);
  });

  it('CapCut 音声付き: 元の音声なし動画のシーン・台本を付け直す。別テンプレート・未完了・別の人は拒否', async () => {
    const { createVideoJobs } = await import('../job-store');
    const SRC = '00000000-0000-0000-0000-0000000000b1';
    const BLOB = `https://abc.public.blob.vercel-storage.com/video-jobs/${SRC}`;
    const audio = { sourceJobId: SRC, wavUrl: `${BLOB}/capcut-1.wav`, srtUrl: `${BLOB}/capcut-2.srt` };
    const scenes = LINES.map((l, i) => ({ id: l.id, kind: l.id.slice(3), slotSeconds: 3, title: `シーン${i}` }));
    const silent = {
      id: SRC,
      personName: '佐野勇斗',
      templateId: T,
      narrationMode: 'none',
      status: 'completed',
      templateInput: { version: 1, targetType: 'person', selectedWorkIds: ['a', 'b', 'c'], facts: [], periodStart: null, pickWorkId: null, lines: LINES, scenes, title: 'タイトル', pagePath: '/person/x', sourceUrls: [] },
    };
    state.source = silent;
    await createVideoJobs({ personNames: ['佐野勇斗'], templateId: T, narrationMode: 'capcut', templateInput: { targetType: 'person', lines: null, audio } });
    expect(state.inserted[0].templateInput).toMatchObject({ lines: LINES, scenes, title: 'タイトル', audio: { ...audio, sourceOutDir: null } });
    state.source = { ...silent, templateId: 'follow_genre_breakdown' };
    await expect(createVideoJobs({ personNames: ['佐野勇斗'], templateId: T, narrationMode: 'capcut', templateInput: { targetType: 'person', audio } })).rejects.toThrow(/同じテンプレート/);
    state.source = { ...silent, status: 'failed' };
    await expect(createVideoJobs({ personNames: ['佐野勇斗'], templateId: T, narrationMode: 'capcut', templateInput: { targetType: 'person', audio } })).rejects.toThrow(/完了した音声なし動画/);
    state.source = silent;
    await expect(createVideoJobs({ personNames: ['吉田仁人'], templateId: T, narrationMode: 'capcut', templateInput: { targetType: 'person', audio } })).rejects.toThrow(/違う人物/);
  });
});
