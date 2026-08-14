import { describe, it, expect, vi, beforeEach } from 'vitest';

// getPublicWorkById は複数人物行を横断してvod_dataを合算するため、
// db.select().from().where().orderBy() のチェーンをモックする。
const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    return { from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) };
  };
  const selectFn = vi.fn(makeSelectChain);
  return { selectQueue, selectFn, makeSelectChain };
});

vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: mockState.selectFn },
}));

import { getPublicWorkById } from '../work-store';
import type { VodProvider } from '@/types/vod';

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Netflix',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'manual_csv',
    ...overrides,
  };
}

function dbWorkRow(personName: string, vodProviders: VodProvider[], vodUpdatedAt: number, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'tmdb-tv-228620',
    personName,
    title: 'アクトレス',
    originalTitle: null,
    normalizedTitle: 'アクトレス',
    type: 'tv',
    tmdbId: 228620,
    source: 'tmdb',
    releaseYear: 2020,
    roleName: null,
    overview: null,
    posterUrl: null,
    manualImageUrl: null,
    ogImageUrl: null,
    ogSourceUrl: null,
    ogImageFetchedAt: null,
    ogImageStatus: null,
    ogImageError: null,
    confidenceScore: '100',
    status: 'auto_published',
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    checkedAt: null,
    aiData: {},
    vodData: { vodProviders, vodUpdatedAt },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  mockState.selectQueue.length = 0;
  vi.clearAllMocks();
  mockState.selectFn.mockImplementation(mockState.makeSelectChain);
});

describe('getPublicWorkById（複数人物行のVOD情報を合算する）', () => {
  it('該当作品が存在しない場合はnull', async () => {
    mockState.selectQueue.push([]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    expect(work).toBeNull();
  });

  it('1行のみの場合はその行のvodProvidersをそのまま返す', async () => {
    mockState.selectQueue.push([
      dbWorkRow('人物A', [provider({ providerName: 'Hulu' })], 1000),
    ]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    expect(work?.vodProviders?.map((p) => p.providerName)).toEqual(['Hulu']);
  });

  it('複数人物行のvodProvidersを合算する（再現ケース: アクトレス）— 古い行のみのLeminoと新しい行のDisney+が両方残る', async () => {
    mockState.selectQueue.push([
      // ORDER BY vodUpdatedAt DESC で先頭に来る想定の新しい行（Disney+を含む）
      dbWorkRow('早川聖来', [
        provider({ providerName: 'Lemino', confidence: 'medium', source: 'openai_web_search' }),
        provider({ providerName: 'Disney+ (ディズニープラス)', confidence: 'high', source: 'openai_web_search' }),
      ], 5000),
      // 古い行（Leminoのみ確認済み、あとはunknown）
      dbWorkRow('伊藤理々杏', [
        provider({ providerName: 'Lemino', confidence: 'high', source: 'manual_csv' }),
        provider({ providerName: 'unknown', type: 'unknown' }),
      ], 1000),
    ]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    const names = (work?.vodProviders ?? []).map((p) => p.providerName).sort();
    expect(names).toContain('Disney+ (ディズニープラス)');
    expect(names.some((n) => n.includes('Lemino'))).toBe(true);
  });

  it('「最新行が unknown のみ」でも、別の行にある確認済みproviderは消えない（再現ケース: ひなくり2022型）', async () => {
    mockState.selectQueue.push([
      // 最新行（vodUpdatedAt最大）だが unknown のみで何も確認できていない
      dbWorkRow('人物B（最新チェックだが不明）', [
        provider({ providerName: 'unknown', type: 'unknown' }),
      ], 9000),
      // 古い行だが実際にHuluが確認済み
      dbWorkRow('人物A（古いが確認済み）', [
        provider({ providerName: 'Hulu', confidence: 'high', source: 'openai_web_search' }),
      ], 1000),
    ]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    const names = (work?.vodProviders ?? []).map((p) => p.providerName);
    expect(names).toContain('Hulu');
  });

  it('同じサービスが複数行に別ソースで存在する場合は既存のdeduplicateProviders基準で1件に絞られる', async () => {
    mockState.selectQueue.push([
      dbWorkRow('人物A', [
        provider({ providerName: 'Netflix', source: 'tmdb_watch_provider', updatedAt: 1000 }),
      ], 1000),
      dbWorkRow('人物B', [
        provider({ providerName: 'Netflix', source: 'manual_csv', updatedAt: 2000 }),
      ], 2000),
    ]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    const netflixEntries = (work?.vodProviders ?? []).filter((p) => p.providerName === 'Netflix');
    // tmdb_watch_provider の方がVOD_SOURCE_PRIORITYで優先されるため1件に統合される
    expect(netflixEntries).toHaveLength(1);
    expect(netflixEntries[0].source).toBe('tmdb_watch_provider');
  });
});
