import { describe, it, expect } from 'vitest';
import { buildLineShareUrl, buildShareText, buildXShareUrl } from '../oshi-vod/share';
import { buildOshiVodImageData } from '../oshi-vod/image-data';
import { computeOshiVodDiagnosis } from '../oshi-vod/core';
import { formatPersonList, formatIsoDate, formatMonthlyPrice, formatYen } from '../oshi-vod/format';
import { getVodPlanInfo } from '../vod-plan-info';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

function work(id: string, name: string, providers: string[]): WorkRecord {
  return {
    id, personName: name, title: id, normalizedTitle: id, type: 'tv', source: 'tmdb', confidenceScore: 1,
    status: 'auto_published', createdAt: 0, updatedAt: 0,
    vodProviders: providers.map((p): VodProvider => ({ providerId: 0, providerName: p, type: 'flatrate', countryCode: 'JP', source: 'manual_csv' })),
  };
}

describe('oshi-vod share / format / image-data', () => {
  it('人物名の短縮表記', () => {
    expect(formatPersonList(['A'])).toBe('A');
    expect(formatPersonList(['A', 'B', 'C'])).toBe('A・B・C');
    expect(formatPersonList(['A', 'B', 'C', 'D', 'E'])).toBe('A・B・Cほか2人');
  });

  it('シェア文（1位あり／なし）', () => {
    expect(buildShareText({ personNames: ['A', 'B'], topServiceLabel: 'U-NEXT' })).toContain('A・Bの出演作品を一番多く見られるのは「U-NEXT」');
    expect(buildShareText({ personNames: ['A'], topServiceLabel: null })).toContain('（A）');
  });

  it('X / LINE の共有URL（外部APIは使わずURLのみ）', () => {
    const x = new URL(buildXShareUrl('本文', 'https://oshi-search.jp/oshi-vod?p=A'));
    expect(x.origin).toBe('https://x.com');
    expect(x.searchParams.get('text')).toBe('本文');
    expect(x.searchParams.get('url')).toBe('https://oshi-search.jp/oshi-vod?p=A');
    expect(x.searchParams.get('hashtags')).toBe('推しサーチ');
    expect(buildLineShareUrl('https://oshi-search.jp/oshi-vod?p=A')).toBe(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent('https://oshi-search.jp/oshi-vod?p=A')}`,
    );
  });

  it('料金・日付の表示（推測で補完しない）', () => {
    expect(formatYen(2189)).toBe('2,189円');
    expect(formatIsoDate('2026-10-08')).toBe('2026/10/08');
    expect(formatIsoDate(null)).toBeNull();
    expect(formatIsoDate('2026/10/08')).toBeNull();
    const unext = getVodPlanInfo('unext');
    expect(formatMonthlyPrice(unext, true)).toBe('月額2,189円（税込）');
    expect(formatMonthlyPrice(unext, false)).toBeNull();
  });

  it('結果画像データは結果ページと同じ数値（1位・対象作品数・2サービス最適解）を含む', () => {
    const r = computeOshiVodDiagnosis([
      { name: 'A', works: [work('w1', 'A', ['U-NEXT', 'Hulu']), work('w2', 'A', ['U-NEXT']), work('w3', 'A', ['Hulu'])] },
      { name: 'B', works: [work('w4', 'B', ['Netflix'])] },
    ], { terminatedSlugs: new Set() });
    const d = buildOshiVodImageData(r);
    expect(d.personNames).toEqual(['A', 'B']);
    expect(d.paidTotal).toBe(4);
    expect(d.top!.services.map((s) => s.service)).toEqual(['hulu', 'unext']);
    expect(d.top!.tied).toBe(true);
    expect(d.top!.price).toBeNull(); // 同率時は料金を1つに決めない
    expect(d.pair!.unionCount).toBe(3);
  });
});
