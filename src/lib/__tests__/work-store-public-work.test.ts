import { describe, it, expect, vi, beforeEach } from 'vitest';

// getPublicWorkById は複数人物行を横断してvod_dataを合算するため、
// db.select().from().where() のチェーンをモックする。
// 代表行の選定は品質スコアに基づきJS側で行うため、DBクエリ自体にORDER BYはない。
const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    return { from: () => ({ where: () => Promise.resolve(rows) }) };
  };
  const selectFn = vi.fn(makeSelectChain);
  return { selectQueue, selectFn, makeSelectChain };
});

vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: mockState.selectFn },
}));

import { getPublicWorkById, computeWorkMetadataQualityScore, selectRepresentativeWorkRecord } from '../work-store';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

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

  it('overview/tmdbIdなしだがvodUpdatedAtが新しい行より、overview/tmdbIdありの行がtitle/overview/tmdbIdの代表として選ばれ、VODは両行から統合される', async () => {
    mockState.selectQueue.push([
      dbWorkRow('CSV由来の人物（最近VOD再確認）', [provider({ providerName: 'TVer' })], 9999999999999, {
        overview: null, tmdbId: null, posterUrl: null,
      }),
      dbWorkRow('TMDb由来の人物（VOD確認は古い）', [provider({ providerName: 'Hulu' })], 1, {
        overview: '実際のあらすじ本文', tmdbId: 228620, posterUrl: 'https://image.tmdb.org/poster.jpg',
      }),
    ]);
    const work = await getPublicWorkById('tmdb-tv-228620');
    expect(work?.overview).toBe('実際のあらすじ本文');
    expect(work?.tmdbId).toBe(228620);
    expect(work?.posterUrl).toBe('https://image.tmdb.org/poster.jpg');
    // VOD providerは代表行選択とは独立して全行から統合されるため、双方とも残る
    const names = (work?.vodProviders ?? []).map((p) => p.providerName).sort();
    expect(names).toEqual(['Hulu', 'TVer']);
  });
});

// ─── 代表行選択（作品metadata品質基準）のテスト ────────────────────────────────
function makeRecord(overrides: Partial<WorkRecord>): WorkRecord {
  const now = Date.now();
  return {
    id: 'tmdb-tv-1',
    personName: '人物A',
    title: 'テスト作品',
    normalizedTitle: 'テスト作品',
    type: 'tv',
    source: 'tmdb',
    confidenceScore: 100,
    status: 'auto_published',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('computeWorkMetadataQualityScore（人物固有情報・VOD情報を含めない品質スコア）', () => {
  it('tmdbId・overview・画像・releaseYearすべてありなら6点', () => {
    const r = makeRecord({ tmdbId: 1, overview: 'あらすじ', posterUrl: 'https://x/p.jpg', releaseYear: 2020 });
    expect(computeWorkMetadataQualityScore(r)).toBe(6);
  });

  it('画像の有無でスコアが1点変わる', () => {
    const withImage = makeRecord({ posterUrl: 'https://x/p.jpg' });
    const withoutImage = makeRecord({});
    expect(computeWorkMetadataQualityScore(withImage) - computeWorkMetadataQualityScore(withoutImage)).toBe(1);
  });

  it('ogImageUrl・manualImageUrlのいずれかだけでも画像ありとして加点される', () => {
    expect(computeWorkMetadataQualityScore(makeRecord({ ogImageUrl: 'https://x/og.jpg' }))).toBe(1);
    expect(computeWorkMetadataQualityScore(makeRecord({ manualImageUrl: 'https://x/m.jpg' }))).toBe(1);
  });

  it('releaseYearの有無でスコアが1点変わる', () => {
    const withYear = makeRecord({ releaseYear: 2020 });
    const withoutYear = makeRecord({});
    expect(computeWorkMetadataQualityScore(withYear) - computeWorkMetadataQualityScore(withoutYear)).toBe(1);
  });

  it('overviewが空文字のみの場合は加点しない（実質データなしのため）', () => {
    expect(computeWorkMetadataQualityScore(makeRecord({ overview: '   ' }))).toBe(0);
  });

  it('personName・roleNameが増えても品質スコアには一切影響しない', () => {
    const base = makeRecord({});
    const withLongRole = makeRecord({ personName: '出演者がとても多い作品の人物名', roleName: 'ゲスト出演・VTR出演・本人役として複数回登場' });
    expect(computeWorkMetadataQualityScore(base)).toBe(computeWorkMetadataQualityScore(withLongRole));
  });

  it('vodUpdatedAtやvodProvidersが存在しても品質スコアには一切影響しない', () => {
    const base = makeRecord({});
    const withVod = makeRecord({
      vodUpdatedAt: Date.now(),
      vodProviders: [{ providerId: 1, providerName: 'Netflix', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' }],
    });
    expect(computeWorkMetadataQualityScore(base)).toBe(computeWorkMetadataQualityScore(withVod));
  });
});

describe('selectRepresentativeWorkRecord（代表行の決定）', () => {
  it('vodUpdatedAtが新しくoverview/tmdbIdなしの行より、古くてもoverview/tmdbIdありの行が優先される', () => {
    const newButThin = makeRecord({ personName: '人物A', vodUpdatedAt: 9999999999999, tmdbId: undefined, overview: undefined });
    const oldButRich = makeRecord({ personName: '人物B', vodUpdatedAt: 1, tmdbId: 123, overview: 'あらすじ本文' });
    const result = selectRepresentativeWorkRecord([newButThin, oldButRich]);
    expect(result.personName).toBe('人物B');
  });

  it('品質スコアが同点の場合のみvodUpdatedAtで tie-break する', () => {
    const older = makeRecord({ personName: '人物A', tmdbId: 1, vodUpdatedAt: 100 });
    const newer = makeRecord({ personName: '人物B', tmdbId: 1, vodUpdatedAt: 200 });
    const result = selectRepresentativeWorkRecord([older, newer]);
    expect(result.personName).toBe('人物B');
  });

  it('品質スコアもvodUpdatedAtも同点の場合はpersonName昇順で決定的に選ばれる（何度実行しても同じ結果）', () => {
    const b = makeRecord({ personName: 'ｂ人物', tmdbId: 1, vodUpdatedAt: 100 });
    const a = makeRecord({ personName: 'ａ人物', tmdbId: 1, vodUpdatedAt: 100 });
    const result1 = selectRepresentativeWorkRecord([b, a]);
    const result2 = selectRepresentativeWorkRecord([a, b]);
    expect(result1.personName).toBe(result2.personName);
  });
});
