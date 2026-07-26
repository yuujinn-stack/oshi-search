import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeonSql = vi.hoisted(() => vi.fn());
const mockResolveActiveWorkTargets = vi.hoisted(() => vi.fn());
const mockGetInactiveProviderSlugs = vi.hoisted(() => vi.fn());

vi.mock('@/db/client', () => ({
  neonSql: mockNeonSql,
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/vod-recheck-store', () => ({
  activeWorkFragment: () => ({ _stub: 'active-fragment' }),
  resolveActiveWorkTargets: mockResolveActiveWorkTargets,
}));
vi.mock('@/lib/provider-store', () => ({
  getInactiveProviderSlugs: mockGetInactiveProviderSlugs,
}));

import { resolveVodRecheckExportData } from '../vod-recheck-export-data';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInactiveProviderSlugs.mockResolvedValue(new Set(['dtv']));
});

describe('resolveVodRecheckExportData', () => {
  it('解決済みworkIdが0件ならneonSqlを呼ばず空を返す', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({ resolved: new Map(), unresolved: ['ghost-id'] });
    const result = await resolveVodRecheckExportData([{ personName: '人物A', workId: 'ghost-id' }]);
    expect(result.rows).toEqual([]);
    expect(result.unresolvedWorkIds).toEqual(['ghost-id']);
    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('currentVodServicesからunknown・dTVを除外し、有効サービスのみ結合する', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([['work-1', { canonicalWorkId: 'work-1', resolvedViaAlias: false, personNames: ['人物A'] }]]),
      unresolved: [],
    });
    mockNeonSql.mockResolvedValue([
      {
        person_name: '人物A', work_id: 'work-1', title: 'タイトル', type: 'movie', release_year: 2020, role_name: '主演',
        vod_data: {
          vodProviders: [
            { providerId: 1, providerName: 'Netflix', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' },
            { providerId: 2, providerName: 'dTV', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' },
            { providerId: 3, providerName: 'unknown', type: 'unknown', countryCode: 'JP', source: 'openai_web_search' },
          ],
        },
      },
    ]);
    const result = await resolveVodRecheckExportData([{ personName: '人物A', workId: 'work-1' }]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].currentVodServices).toBe('Netflix');
    expect(result.rows[0].roleName).toBe('主演');
    expect(result.rows[0].releaseYear).toBe(2020);
  });

  it('同一workIdに複数人物が紐づく場合は1行1人物で出力する', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([['work-1', { canonicalWorkId: 'work-1', resolvedViaAlias: false, personNames: ['人物A', '人物B'] }]]),
      unresolved: [],
    });
    mockNeonSql.mockResolvedValue([
      { person_name: '人物A', work_id: 'work-1', title: 'タイトル', type: 'movie', release_year: 2020, role_name: null, vod_data: { vodProviders: [] } },
      { person_name: '人物B', work_id: 'work-1', title: 'タイトル', type: 'movie', release_year: 2020, role_name: null, vod_data: { vodProviders: [] } },
    ]);
    const result = await resolveVodRecheckExportData([{ personName: '人物A', workId: 'work-1' }]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.personName)).toEqual(['人物A', '人物B']);
  });

  it('vodProvidersが空でもcurrentVodServicesは空文字になる（クラッシュしない）', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([['work-1', { canonicalWorkId: 'work-1', resolvedViaAlias: false, personNames: ['人物A'] }]]),
      unresolved: [],
    });
    mockNeonSql.mockResolvedValue([
      { person_name: '人物A', work_id: 'work-1', title: 'タイトル', type: 'movie', release_year: null, role_name: null, vod_data: {} },
    ]);
    const result = await resolveVodRecheckExportData([{ personName: '人物A', workId: 'work-1' }]);
    expect(result.rows[0].currentVodServices).toBe('');
    expect(result.rows[0].releaseYear).toBeNull();
  });
});
