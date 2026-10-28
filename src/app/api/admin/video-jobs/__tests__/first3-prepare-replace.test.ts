import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 1作品だけ変更（手動選択）: 選んだ作品が、その人物の出演作品でなければ依頼しない

const created: Array<{ personName: string; slot: number; workId: string | null }> = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: async () => [{ name: '大橋和也' }, { name: '道枝駿佑' }] }));
vi.mock('@/server/video-jobs/first3-source', () => ({
  getFirst3ManualCandidates: async (personName: string) => ({
    personName,
    candidates:
      personName === '大橋和也'
        ? [{ id: 'tmdb-tv-296060', title: '君がトクベツ' }, { id: 'tmdb-tv-293435', title: 'リベンジ・スパイ' }]
        : [{ id: 'tmdb-tv-michieda', title: 'キャスター' }],
  }),
}));
const exclusions: Array<{ personName: string; action: string }> = [];
vi.mock('@/server/video-jobs/script-prep-store', async () => ({
  createScriptRequest: async () => 1,
  excludeOneAction: (slot: number, kind = 'exclude') => {
    if (![1, 2, 3].includes(slot)) throw Object.assign(new Error('bad slot'), { status: 400 });
    return `${kind === 'vod_check' ? 'vodcheck_one' : 'exclude_one'}|${slot}`;
  },
  unexcludeAction: (workId: string) => `unexclude|${encodeURIComponent(workId)}`,
  videoTitleAction: (workId: string, v: string | null) => `video_title|${encodeURIComponent(workId)}|${encodeURIComponent(v ?? '')}`,
  createExclusionRequest: async (personName: string, action: string) => {
    exclusions.push({ personName, action });
    return 1;
  },
  createReplaceOneRequest: async (personName: string, slot: number, workId: string | null) => {
    created.push({ personName, slot, workId });
    return 1;
  },
}));
vi.mock('@/server/video-jobs/job-store', () => ({
  VideoJobError: class extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));

const { POST } = await import('../first3-prepare/route');
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/video-jobs/first3-prepare', { method: 'POST', body: JSON.stringify(body) }));

describe('first3-prepare replace_one', () => {
  beforeEach(() => {
    created.length = 0;
  });
  it('その人物の出演作品なら依頼する', async () => {
    const res = await post({ action: 'replace_one', personName: '道枝駿佑', slot: 2, workId: 'tmdb-tv-michieda' });
    expect(res.status).toBe(200);
    expect(created).toEqual([{ personName: '道枝駿佑', slot: 2, workId: 'tmdb-tv-michieda' }]);
  });
  it('別の人物の出演作品は拒否し、依頼を作らない', async () => {
    const res = await post({ action: 'replace_one', personName: '道枝駿佑', slot: 2, workId: 'tmdb-tv-296060' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/道枝駿佑 の出演作品ではありません/);
    expect(created).toEqual([]);
  });
  it('おすすめに自動変更（作品IDなし）は出演作品の確認なしで依頼する', async () => {
    const res = await post({ action: 'replace_one', personName: '大橋和也', slot: 3, workId: null });
    expect(res.status).toBe(200);
    expect(created).toEqual([{ personName: '大橋和也', slot: 3, workId: null }]);
  });
});

describe('first3-prepare exclude_one / unexclude', () => {
  it('その枠の除外・除外の解除を依頼する', async () => {
    exclusions.length = 0;
    expect((await post({ action: 'exclude_one', personName: '大橋和也', slot: 2 })).status).toBe(200);
    expect((await post({ action: 'vodcheck_one', personName: '大橋和也', slot: 3 })).status).toBe(200);
    expect((await post({ action: 'unexclude', personName: '大橋和也', workId: 'tmdb-tv-296060' })).status).toBe(200);
    expect(exclusions).toEqual([
      { personName: '大橋和也', action: 'exclude_one|2' },
      { personName: '大橋和也', action: 'vodcheck_one|3' },
      { personName: '大橋和也', action: 'unexclude|tmdb-tv-296060' },
    ]);
  });
  it('登録されていない人物は依頼しない', async () => {
    exclusions.length = 0;
    expect((await post({ action: 'exclude_one', personName: '未登録', slot: 1 })).status).toBe(400);
    expect(exclusions).toEqual([]);
  });
});

describe('first3-prepare video_title', () => {
  it('その人物の出演作品だけ表示名を依頼する（別の人物の作品は拒否）', async () => {
    exclusions.length = 0;
    expect((await post({ action: 'video_title', personName: '大橋和也', workId: 'tmdb-tv-296060', videoTitle: '君トク' })).status).toBe(200);
    expect((await post({ action: 'video_title', personName: '大橋和也', workId: 'tmdb-tv-296060', videoTitle: null })).status).toBe(200);
    const bad = await post({ action: 'video_title', personName: '大橋和也', workId: 'tmdb-tv-michieda', videoTitle: 'x' });
    expect(bad.status).toBe(400);
    expect(exclusions).toEqual([
      { personName: '大橋和也', action: 'video_title|tmdb-tv-296060|%E5%90%9B%E3%83%88%E3%82%AF' },
      { personName: '大橋和也', action: 'video_title|tmdb-tv-296060|' },
    ]);
  });
});
