import { describe, it, expect } from 'vitest';
import { getConfirmedProviders, getStreamingProviders, STREAMING_TYPES } from '../vod-availability';
import { deduplicateProviders, isConfirmedVodAvailability } from '../vod-dedup';
import type { VodProvider, VodProviderType, VodSource } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// ─── 置き換え前の実装（人物ページ・StreamingNowSection・site-ui/data.ts・グループページに
// ローカル関数として存在していたものをそのまま写したもの）。共通関数がこれと完全に同じ
// 結果を返すことを網羅的に検証する。 ────────────────────────────────────────────
function legacyPersonPageGetStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  ).filter((p) => ['flatrate', 'free', 'ads'].includes(p.type));
}
const LEGACY_STREAMING_TYPES = ['flatrate', 'free', 'ads'];
function legacyStreamingNowGetStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>) {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  ).filter((p) => LEGACY_STREAMING_TYPES.includes(p.type));
}
function legacyGroupPageGetPublicProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  );
}

function work(vodProviders: VodProvider[] | undefined): WorkRecord {
  return {
    id: 'tmdb-movie-1',
    personName: 'テスト',
    title: 'テスト作品',
    normalizedTitle: 'テスト作品',
    type: 'movie',
    source: 'tmdb',
    confidenceScore: 1,
    status: 'auto_published',
    vodProviders,
    createdAt: 0,
    updatedAt: 0,
  };
}

// 決定的な擬似乱数（テストの再現性のため）
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const NAMES = [
  'Hulu', 'U-NEXT', 'U-NEXT JP', 'Netflix', 'Netflix Standard with Ads', 'Amazon Prime Video',
  'Amazon Prime Video（Leminoせれくと）', 'FOD Channel Amazon Channel', 'Amazon Video', 'ABEMA', 'AbemaTV',
  'Lemino', 'TVer', 'YouTube', 'dTV', 'GYAO!', 'Paravi', 'unknown', '', 'Disney+', 'DMM TV', 'TELASA',
];
const TYPES: VodProviderType[] = ['flatrate', 'free', 'ads', 'rent', 'buy', 'unknown'];
const SOURCES: VodSource[] = ['tmdb_watch_provider', 'openai_supplement', 'openai_web_search', 'manual', 'manual_csv', 'ai_recheck'];

function randomProviders(rand: () => number): VodProvider[] {
  const n = Math.floor(rand() * 8);
  return Array.from({ length: n }, (_, i) => ({
    providerId: i,
    providerName: NAMES[Math.floor(rand() * NAMES.length)],
    type: TYPES[Math.floor(rand() * TYPES.length)],
    countryCode: 'JP',
    source: SOURCES[Math.floor(rand() * SOURCES.length)],
    confidence: (['high', 'medium', 'low', undefined] as const)[Math.floor(rand() * 4)],
    hidden: rand() < 0.15 ? true : undefined,
    updatedAt: Math.floor(rand() * 1000),
  }));
}

describe('vod-availability: 置き換え前の実装との完全一致', () => {
  const terminatedVariants = [new Set<string>(), new Set(['dtv', 'gyao', 'paravi']), new Set(['hulu', 'abema'])];
  const rand = rng(42);
  const cases = Array.from({ length: 2000 }, () => randomProviders(rand));

  it('getStreamingProviders は人物ページ・StreamingNowSection・site-ui の旧実装と同一', () => {
    for (const providers of cases) {
      for (const terminated of terminatedVariants) {
        const w = work(providers);
        const expected = legacyPersonPageGetStreamingProviders(w, terminated);
        expect(getStreamingProviders(w, terminated)).toEqual(expected);
        expect(legacyStreamingNowGetStreamingProviders(w, terminated)).toEqual(expected);
      }
    }
  });

  it('getConfirmedProviders はグループページの旧 getPublicProviders と同一', () => {
    for (const providers of cases) {
      for (const terminated of terminatedVariants) {
        const w = work(providers);
        expect(getConfirmedProviders(w.vodProviders, terminated)).toEqual(legacyGroupPageGetPublicProviders(w, terminated));
      }
    }
  });

  it('vodProviders 未定義でも空配列', () => {
    expect(getStreamingProviders(work(undefined), new Set())).toEqual([]);
    expect(getConfirmedProviders(undefined, new Set())).toEqual([]);
  });

  it('STREAMING_TYPES は見放題・無料・広告付きのみ', () => {
    expect([...STREAMING_TYPES]).toEqual(['flatrate', 'free', 'ads']);
  });
});
