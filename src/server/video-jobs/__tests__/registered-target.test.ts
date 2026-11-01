import { beforeEach, describe, expect, it, vi } from 'vitest';

// 登録グループ紹介: ジョブ作成時の区間の作り直しと、CapCut 音声付きのジョブの付け直し。DB・登録データは偽物
const state = vi.hoisted(() => ({
  groups: [] as string[],
  persons: 0,
  queue: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/persons', () => ({
  getAllGroupsMerged: async () => state.groups,
  getAllPersonsMerged: async () => Array.from({ length: state.persons }, (_, i) => ({ name: `p${i}` })),
}));
vi.mock('@/lib/group-meta', () => ({ getAllGroupMetas: async () => [] }));
vi.mock('@/db/client', () => ({ db: { select: () => ({ from: () => ({ where: async () => state.queue.shift() ?? [] }) }) } }));
vi.mock('../job-store', () => ({
  VideoJobError: class VideoJobError extends Error {
    constructor(message: string, readonly status = 400) {
      super(message);
    }
  },
}));

beforeEach(() => {
  state.groups = ['乃木坂46', 'Snow Man', '嵐', 'M!LK', 'Number_i', 'Snow Man', ' '];
  state.persons = 373;
  state.queue = [];
});

describe('loadRegisteredTarget', () => {
  it('トップページと同じ一覧（同じ名前は1件・空は除く）とジャンル・人物数', async () => {
    const { loadRegisteredTarget } = await import('../registered-target');
    const t = await loadRegisteredTarget();
    expect(t.groups.map((g) => [g.name, g.category])).toEqual([
      ['乃木坂46', 'female'],
      ['Snow Man', 'male'],
      ['嵐', 'male'],
      ['M!LK', 'male'],
      ['Number_i', 'male'],
    ]);
    expect(t.personCount).toBe(373);
  });
});

describe('resolveRegisteredJobInput', () => {
  it('現在の登録データで区間を作り直す（画面の区間・件数は使わない）。台本が区間と合わなければ作らない', async () => {
    const { resolveRegisteredJobInput } = await import('../registered-target');
    const { buildRegisteredPlan, registeredCategoryOf } = await import('@/lib/video-registered-groups');
    const groups = ['乃木坂46', 'Snow Man', '嵐', 'M!LK', 'Number_i'].map((name) => ({ name, category: registeredCategoryOf(name), href: '' }));
    const plan = buildRegisteredPlan({ templateId: 'registered_groups_male', groups, personCount: 373, selection: { order: null, excluded: ['嵐'] } });
    if (!plan.ok) throw new Error('plan');
    const input = { version: 1 as const, templateCategory: 'registered_groups' as const, selection: { order: null, excluded: ['嵐'] }, lines: plan.lines };
    const r = await resolveRegisteredJobInput('registered_groups_male', '推しサーチ', input);
    expect(r.counts).toEqual({ persons: 373, groups: 5, shown: 3, excluded: 1 });
    expect(r.shownGroups).toEqual(['Snow Man', 'M!LK', 'Number_i']);
    expect(r.segments!.map((s) => s.kind)).toEqual(['hook', 'list', 'screen', 'outro']);
    expect(r.storyLinkUrl).toBeNull();
    await expect(resolveRegisteredJobInput('registered_groups_male', '推しサーチ', { ...input, lines: plan.lines.slice(1) })).rejects.toThrow(/台本が区間の構成と合いません/);
    await expect(resolveRegisteredJobInput('registered_groups_male', 'M!LK', input)).rejects.toThrow(/推しサーチ/);
    await expect(resolveRegisteredJobInput('follow_three_works', '推しサーチ', input)).rejects.toThrow(/登録グループ紹介のテンプレートではありません/);
    // 登録が変わって対象が無くなれば作らない
    state.groups = ['乃木坂46'];
    await expect(resolveRegisteredJobInput('registered_groups_male', '推しサーチ', input)).rejects.toThrow(/生成できません/);
  });

  it('ストーリーズは台本を使わず、リンクスタンプの推奨URLを付ける', async () => {
    const { resolveRegisteredJobInput } = await import('../registered-target');
    const r = await resolveRegisteredJobInput('story_registered_groups_all', '推しサーチ', { version: 1, templateCategory: 'registered_groups', selection: { order: null, excluded: [] }, lines: [{ id: '01-hook', text: 'x', kana: 'x' }] });
    expect(r.lines).toEqual([]);
    expect(r.storyLinkUrl).toBe('https://oshi-search.jp/');
    expect(r.counts?.shown).toBe(5);
  });
});

describe('applyRegisteredAudioSource', () => {
  const audio = { sourceJobId: 'ab12cd34-0000-4000-8000-000000000001', wavUrl: 'https://a.public.blob.vercel-storage.com/x.wav', srtUrl: 'https://a.public.blob.vercel-storage.com/x.srt' };
  const sourceInput = {
    version: 1,
    templateCategory: 'registered_groups',
    selection: { order: null, excluded: [] },
    lines: [{ id: '01-hook', text: 'あ', kana: 'あ' }, { id: '02-outro', text: 'い', kana: 'い' }],
    segments: [{ id: '01-hook', kind: 'hook', slotSeconds: 3 }, { id: '02-outro', kind: 'outro', slotSeconds: 3 }],
    title: 't',
    counts: { persons: 1, groups: 2, shown: 0, excluded: 0 },
    shownGroups: [],
  };
  const source = { id: audio.sourceJobId, templateId: 'registered_groups_progress', status: 'completed', narrationMode: 'none', personName: '推しサーチ', templateInput: sourceInput };

  it('元の音声なし動画の区間・台本・件数をそのまま使う（今の登録データで作り直さない）', async () => {
    const { applyRegisteredAudioSource } = await import('../registered-target');
    state.queue.push([source]);
    const r = await applyRegisteredAudioSource('registered_groups_progress', '推しサーチ', { version: 1, templateCategory: 'registered_groups', selection: { order: null, excluded: [] }, lines: [], audio });
    expect(r.segments).toEqual(sourceInput.segments);
    expect(r.lines).toEqual(sourceInput.lines);
    expect(r.counts).toEqual(sourceInput.counts);
    expect(r.audio).toEqual({ ...audio, sourceOutDir: null });
  });

  it('別テンプレート・未完了・音声付きの元ジョブ、ストーリーズには付けない', async () => {
    const { applyRegisteredAudioSource } = await import('../registered-target');
    const input = { version: 1 as const, templateCategory: 'registered_groups' as const, selection: { order: null, excluded: [] }, lines: [], audio };
    for (const bad of [{ templateId: 'registered_groups_all' }, { status: 'failed' }, { narrationMode: 'capcut' }]) {
      state.queue.push([{ ...source, ...bad }]);
      await expect(applyRegisteredAudioSource('registered_groups_progress', '推しサーチ', input)).rejects.toThrow(/完了した音声なし動画/);
    }
    await expect(applyRegisteredAudioSource('story_registered_groups_all', '推しサーチ', input)).rejects.toThrow(/リールだけ/);
  });
});
