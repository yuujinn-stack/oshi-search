import { describe, it, expect } from 'vitest';
import {
  hasConfirmedStreaming,
  getWorkDecadeLabel,
  getAvailableDecades,
  getAvailableProviders,
  getWorkImageAspectGroup,
  filterAndSortWorks,
  isDefaultWorkFilter,
  DEFAULT_WORK_FILTER,
  type WorkFilterOptions,
} from '@/lib/work-filter';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';

function provider(overrides: Partial<VodProvider> = {}): VodProvider {
  return {
    providerId: 1,
    providerName: 'Netflix',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'tmdb_watch_provider',
    ...overrides,
  };
}

function work(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: overrides.id ?? 'w1',
    personName: '테스트',
    title: 'タイトル',
    normalizedTitle: 'タイトル',
    type: 'movie',
    source: 'tmdb',
    confidenceScore: 100,
    status: 'auto_published',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('hasConfirmedStreaming()', () => {
  it('flatrate/rent/buy/free の確定済みプロバイダーがあれば true', () => {
    for (const type of ['flatrate', 'rent', 'buy', 'free'] as const) {
      expect(hasConfirmedStreaming(work({ vodProviders: [provider({ type })] }))).toBe(true);
    }
  });

  it('unknown typeは配信ありとして扱わない', () => {
    expect(hasConfirmedStreaming(work({ vodProviders: [provider({ type: 'unknown' })] }))).toBe(false);
  });

  it('providerNameがunknownの場合は配信ありとして扱わない', () => {
    expect(hasConfirmedStreaming(work({ vodProviders: [provider({ providerName: 'unknown' })] }))).toBe(false);
  });

  it('hiddenフラグ付きは配信ありとして扱わない', () => {
    expect(hasConfirmedStreaming(work({ vodProviders: [provider({ hidden: true })] }))).toBe(false);
  });

  it('AI低確度は配信ありとして扱わない', () => {
    expect(
      hasConfirmedStreaming(
        work({ vodProviders: [provider({ source: 'openai_supplement', confidence: 'low' })] }),
      ),
    ).toBe(false);
  });

  it('vodProvidersが空・未設定なら false', () => {
    expect(hasConfirmedStreaming(work({ vodProviders: [] }))).toBe(false);
    expect(hasConfirmedStreaming(work({}))).toBe(false);
  });
});

describe('getWorkDecadeLabel()', () => {
  it('年から年代ラベルを算出する', () => {
    expect(getWorkDecadeLabel(2023)).toBe('2020年代');
    expect(getWorkDecadeLabel(2019)).toBe('2010年代');
    expect(getWorkDecadeLabel(1999)).toBe('1990年代');
  });

  it('releaseYearが無い場合は null', () => {
    expect(getWorkDecadeLabel(undefined)).toBeNull();
    expect(getWorkDecadeLabel(0)).toBeNull();
  });
});

describe('getAvailableDecades()', () => {
  it('存在する年代のみを新しい順で返す', () => {
    const works = [work({ releaseYear: 2021 }), work({ releaseYear: 2015 }), work({ releaseYear: 2022 })];
    expect(getAvailableDecades(works)).toEqual(['2020年代', '2010年代']);
  });
});

describe('getAvailableProviders()', () => {
  it('確定済みプロバイダーのみを重複除去して返す', () => {
    const works = [
      work({ vodProviders: [provider({ providerName: 'Netflix' })] }),
      work({ vodProviders: [provider({ providerName: 'Netflix' }), provider({ providerName: 'Hulu', providerId: 2 })] }),
      work({ vodProviders: [provider({ type: 'unknown' })] }),
    ];
    const result = getAvailableProviders(works);
    expect(result.map((p) => p.displayName).sort()).toEqual(['Hulu', 'Netflix']);
  });
});

describe('getWorkImageAspectGroup()', () => {
  it('TMDb画像は portrait', () => {
    expect(getWorkImageAspectGroup(work({ posterUrl: 'https://image.tmdb.org/t/p/w500/x.jpg' }))).toBe('portrait');
  });

  it('TMDb以外の画像は landscape', () => {
    expect(getWorkImageAspectGroup(work({ ogImageUrl: 'https://img.youtube.com/vi/x/0.jpg' }))).toBe('landscape');
  });

  it('画像が無い場合は none', () => {
    expect(getWorkImageAspectGroup(work({}))).toBe('none');
  });
});

describe('isDefaultWorkFilter()', () => {
  it('デフォルト値のときは true', () => {
    expect(isDefaultWorkFilter(DEFAULT_WORK_FILTER)).toBe(true);
  });

  it('いずれか1つでも変更されていれば false', () => {
    expect(isDefaultWorkFilter({ ...DEFAULT_WORK_FILTER, searchText: '映画' })).toBe(false);
    expect(isDefaultWorkFilter({ ...DEFAULT_WORK_FILTER, decade: '2020年代' })).toBe(false);
    expect(isDefaultWorkFilter({ ...DEFAULT_WORK_FILTER, providerSlug: 'netflix' })).toBe(false);
    expect(isDefaultWorkFilter({ ...DEFAULT_WORK_FILTER, sortMode: 'newest' })).toBe(false);
  });
});

describe('filterAndSortWorks()', () => {
  const streamingMovie = work({
    id: 's1',
    title: '配信中の映画',
    releaseYear: 2023,
    vodProviders: [provider({ providerName: 'Netflix' })],
    posterUrl: 'https://image.tmdb.org/t/p/w500/a.jpg',
  });
  const streamingDrama = work({
    id: 's2',
    title: '配信中のドラマ',
    releaseYear: 2021,
    vodProviders: [provider({ providerName: 'Hulu', providerId: 2 })],
    ogImageUrl: 'https://img.youtube.com/vi/y/0.jpg',
  });
  const noStreamingOld = work({
    id: 'n1',
    title: '配信なしの旧作',
    releaseYear: 2010,
    vodProviders: [provider({ type: 'unknown' })],
  });
  const noStreamingNew = work({
    id: 'n2',
    title: '配信なしの新作',
    releaseYear: 2024,
  });
  const allWorks = [noStreamingNew, streamingDrama, noStreamingOld, streamingMovie];

  it('デフォルト（streaming_first）では配信ありが必ず配信なしより前に来る', () => {
    const result = filterAndSortWorks(allWorks, DEFAULT_WORK_FILTER);
    const ids = result.map((w) => w.id);
    const streamingIdx = [ids.indexOf('s1'), ids.indexOf('s2')];
    const noStreamingIdx = [ids.indexOf('n1'), ids.indexOf('n2')];
    expect(Math.max(...streamingIdx)).toBeLessThan(Math.min(...noStreamingIdx));
  });

  it('unknownのみの作品はfilterAndSortWorksでも配信ありグループに入らない', () => {
    const result = filterAndSortWorks(allWorks, DEFAULT_WORK_FILTER);
    const ids = result.map((w) => w.id);
    expect(ids.indexOf('n1')).toBeGreaterThanOrEqual(ids.indexOf('s1'));
    expect(ids.indexOf('n1')).toBeGreaterThanOrEqual(ids.indexOf('s2'));
  });

  it('検索文字でタイトル部分一致絞り込みができる', () => {
    const result = filterAndSortWorks(allWorks, { ...DEFAULT_WORK_FILTER, searchText: 'ドラマ' });
    expect(result.map((w) => w.id)).toEqual(['s2']);
  });

  it('年代で絞り込みができる', () => {
    const result = filterAndSortWorks(allWorks, { ...DEFAULT_WORK_FILTER, decade: '2020年代' });
    expect(result.map((w) => w.id).sort()).toEqual(['n2', 's1', 's2']);
  });

  it('配信サービスで絞り込みができる', () => {
    const result = filterAndSortWorks(allWorks, { ...DEFAULT_WORK_FILTER, providerSlug: 'netflix' });
    expect(result.map((w) => w.id)).toEqual(['s1']);
  });

  it('検索・年代・配信サービス・並べ替えを同時に適用できる', () => {
    const movie2020s = work({
      id: 'm2020',
      title: '映画A',
      releaseYear: 2022,
      vodProviders: [provider({ providerName: 'Netflix' })],
    });
    const movie2020sOlder = work({
      id: 'm2020b',
      title: '映画B',
      releaseYear: 2020,
      vodProviders: [provider({ providerName: 'Netflix' })],
    });
    const movieWrongDecade = work({
      id: 'wrongDecade',
      title: '映画C',
      releaseYear: 2015,
      vodProviders: [provider({ providerName: 'Netflix' })],
    });
    const movieWrongProvider = work({
      id: 'wrongProvider',
      title: '映画D',
      releaseYear: 2021,
      vodProviders: [provider({ providerName: 'Hulu', providerId: 2 })],
    });
    const nonMovie = work({ id: 'nonMovie', title: 'ドラマX', releaseYear: 2021 });

    const options: WorkFilterOptions = {
      searchText: '映画',
      decade: '2020年代',
      providerSlug: 'netflix',
      sortMode: 'newest',
    };
    const result = filterAndSortWorks(
      [movie2020s, movie2020sOlder, movieWrongDecade, movieWrongProvider, nonMovie],
      options,
    );
    expect(result.map((w) => w.id)).toEqual(['m2020', 'm2020b']);
  });

  it('新しい順ソートでは配信優先を無視して年で並ぶ', () => {
    const result = filterAndSortWorks(allWorks, { ...DEFAULT_WORK_FILTER, sortMode: 'newest' });
    expect(result.map((w) => w.id)).toEqual(['n2', 's1', 's2', 'n1']);
  });

  it('古い順ソートでは配信優先を無視して年で並ぶ', () => {
    const result = filterAndSortWorks(allWorks, { ...DEFAULT_WORK_FILTER, sortMode: 'oldest' });
    expect(result.map((w) => w.id)).toEqual(['n1', 's2', 's1', 'n2']);
  });
});
