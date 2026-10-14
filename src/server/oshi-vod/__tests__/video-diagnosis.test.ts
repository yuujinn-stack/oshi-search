import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { computeOshiVodDiagnosis } from '@/lib/oshi-vod/core';
import type { DiagnosisPersonInput } from '@/lib/oshi-vod/types';
import type { WorkRecord } from '@/types/work';
import { personVideoSlug } from '@/server/video-jobs/person-slug';

// 動画用の診断結果API（読み取りのみ）: slug → 登録人物の対応付け、診断ページと同じ loadOshiVodDiagnosis の利用、
// 生成できない条件（人物不存在・比較対象0件・取得失敗）のエラー、Worker認証付きルートの入力検証。
const state = vi.hoisted(() => ({
  persons: [] as Array<{ name: string; group: string }>,
  works: {} as Record<string, WorkRecord[]>,
  fail: false,
  calls: [] as string[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ db: {} }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: async () => state.persons }));
vi.mock('@/lib/oshi-vod/data', () => ({
  loadOshiVodDiagnosis: async (names: string[]) => {
    state.calls.push(names);
    if (state.fail) throw new Error('DB timeout');
    const persons: DiagnosisPersonInput[] = names.map((name) => ({ name, works: state.works[name] ?? [] }));
    return computeOshiVodDiagnosis(persons, { terminatedSlugs: new Set() });
  },
}));
vi.mock('@/server/video-jobs/worker-auth', () => ({
  verifyWorkerRequest: () => ({ ok: true, workerId: 'test-worker' }),
}));

function w(id: string, personName: string, providerName: string): WorkRecord {
  return {
    id,
    personName,
    title: id,
    normalizedTitle: id,
    type: 'movie',
    source: 'tmdb',
    confidenceScore: 1,
    status: 'auto_published',
    vodProviders: [{ providerId: 0, providerName, type: 'flatrate', countryCode: 'JP', source: 'manual_csv' }],
    createdAt: 0,
    updatedAt: 0,
  } as WorkRecord;
}

const NAMES = ['目黒蓮', '松村北斗', '京本大我'];
const SLUGS = NAMES.map(personVideoSlug);

beforeEach(() => {
  state.persons = [...NAMES, '森本慎太郎'].map((name) => ({ name, group: 'G' }));
  state.works = {
    目黒蓮: [w('m1', '目黒蓮', 'U-NEXT'), w('m2', '目黒蓮', 'Hulu')],
    松村北斗: [w('h1', '松村北斗', 'U-NEXT')],
    京本大我: [w('k1', '京本大我', 'Netflix')],
  };
  state.fail = false;
  state.calls = [];
});

describe('loadOshiVodVideoDiagnosis', () => {
  it('slugを登録人物へ対応付け、選択順のまま診断する', async () => {
    const { loadOshiVodVideoDiagnosis } = await import('../video-diagnosis');
    const d = await loadOshiVodVideoDiagnosis({ version: 1, personSlugs: [SLUGS[2], SLUGS[0], SLUGS[1]] });
    expect(state.calls).toEqual([['京本大我', '目黒蓮', '松村北斗']]);
    expect(d.persons.map((p) => [p.slug, p.name])).toEqual([[SLUGS[2], '京本大我'], [SLUGS[0], '目黒蓮'], [SLUGS[1], '松村北斗']]);
    expect(d.totals.paid).toBe(4);
    expect(d.byWorkCount[0]).toMatchObject({ service: 'unext', paidCount: 2, fractionText: '2 / 4作品', coverageText: '50%' });
  });

  it('別の3人では別の結果になる（固定値を返さない）', async () => {
    const { loadOshiVodVideoDiagnosis } = await import('../video-diagnosis');
    state.works['森本慎太郎'] = [w('s1', '森本慎太郎', 'Netflix'), w('s2', '森本慎太郎', 'Netflix')];
    const a = await loadOshiVodVideoDiagnosis({ version: 1, personSlugs: [SLUGS[0], SLUGS[1], SLUGS[2]] });
    const b = await loadOshiVodVideoDiagnosis({ version: 1, personSlugs: [SLUGS[2], personVideoSlug('森本慎太郎'), SLUGS[1]] });
    expect(a.byWorkCount[0].service).toBe('unext');
    expect(b.byWorkCount[0].service).toBe('netflix');
    expect(b.byWorkCount[0].fractionText).toBe('3 / 4作品');
    expect(a.byWorkCount[0].fractionText).toBe('2 / 4作品');
    expect(b.headline).not.toBe(a.headline);
  });

  it('登録されていない人物は明示的なエラー（404）', async () => {
    const { loadOshiVodVideoDiagnosis } = await import('../video-diagnosis');
    await expect(loadOshiVodVideoDiagnosis({ version: 1, personSlugs: [SLUGS[0], SLUGS[1], 'p-000000000000'] })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('p-000000000000'),
    });
    expect(state.calls).toEqual([]);
  });

  it('比較対象作品が0件なら生成しない（422）', async () => {
    const { loadOshiVodVideoDiagnosis } = await import('../video-diagnosis');
    state.works = {};
    await expect(loadOshiVodVideoDiagnosis({ version: 1, personSlugs: SLUGS as [string, string, string] })).rejects.toMatchObject({ status: 422 });
  });

  it('診断の取得に失敗したら架空の結果を返さずエラー（502）', async () => {
    const { loadOshiVodVideoDiagnosis } = await import('../video-diagnosis');
    state.fail = true;
    await expect(loadOshiVodVideoDiagnosis({ version: 1, personSlugs: SLUGS as [string, string, string] })).rejects.toMatchObject({ status: 502 });
  });
});

describe('POST /api/worker/oshi-vod-diagnosis', () => {
  async function call(body: unknown) {
    const { POST } = await import('@/app/api/worker/oshi-vod-diagnosis/route');
    const res = await POST(new NextRequest('http://localhost/api/worker/oshi-vod-diagnosis', { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, data: await res.json() };
  }

  it('3人のslugで診断結果を返す', async () => {
    const { status, data } = await call({ personSlugs: SLUGS });
    expect(status).toBe(200);
    expect(data.diagnosis.persons.map((p: { name: string }) => p.name)).toEqual(NAMES);
    expect(data.diagnosis.bestPair.services.length).toBeGreaterThan(0);
  });

  it('3人未満・重複・不正slugは400、人物不存在は404', async () => {
    expect((await call({ personSlugs: SLUGS.slice(0, 2) })).status).toBe(400);
    expect((await call({ personSlugs: [SLUGS[0], SLUGS[0], SLUGS[1]] })).status).toBe(400);
    expect((await call({ personSlugs: [SLUGS[0], SLUGS[1], '目黒蓮'] })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ personSlugs: [SLUGS[0], SLUGS[1], 'p-000000000000'] })).status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});
