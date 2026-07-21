import { describe, it, expect } from 'vitest';
import { isConfirmedVodAvailability, normalizeProviderName, deduplicateProviders, filterPublicVodProviders } from '../vod-dedup';
import type { VodProvider } from '@/types/vod';

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Hulu',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'tmdb_watch_provider',
    ...overrides,
  };
}

describe('isConfirmedVodAvailability', () => {
  // ─── providerName が unknown 系 ─────────────────────────────────────────────
  it('providerName="unknown" → false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'unknown' }))).toBe(false);
  });

  it('providerName="UNKNOWN"（大文字）→ false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'UNKNOWN' }))).toBe(false);
  });

  it('providerName="Unknown"（先頭大文字）→ false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Unknown' }))).toBe(false);
  });

  it('providerName=" unknown "（前後スペース）→ false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: ' unknown ' }))).toBe(false);
  });

  it('providerName=""（空文字）→ false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: '' }))).toBe(false);
  });

  // ─── type が unknown ────────────────────────────────────────────────────────
  it('有効なサービス名でも type="unknown" → false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu', type: 'unknown' }))).toBe(false);
  });

  it('providerName="unknown" かつ type="unknown" → false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'unknown', type: 'unknown' }))).toBe(false);
  });

  it('providerName="unknown" かつ type="rent" → false', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'unknown', type: 'rent' }))).toBe(false);
  });

  // ─── hidden ──────────────────────────────────────────────────────────────
  it('hidden=true → false', () => {
    expect(isConfirmedVodAvailability(provider({ hidden: true }))).toBe(false);
  });

  // ─── AI confidence=low ──────────────────────────────────────────────────
  it('AI ソース + confidence=low → false', () => {
    expect(
      isConfirmedVodAvailability(
        provider({ source: 'openai_supplement', confidence: 'low' }),
      ),
    ).toBe(false);
  });

  it('AI ソース + confidence=medium → true', () => {
    expect(
      isConfirmedVodAvailability(
        provider({ source: 'openai_supplement', confidence: 'medium' }),
      ),
    ).toBe(true);
  });

  it('非 AI ソース + confidence=low でも → true（confidence=low は AI のみ除外）', () => {
    expect(
      isConfirmedVodAvailability(
        provider({ source: 'tmdb_watch_provider', confidence: 'low' }),
      ),
    ).toBe(true);
  });

  // ─── Hulu と unknown の混在 ────────────────────────────────────────────
  it('Hulu（有効）は通過する', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu' }))).toBe(true);
  });

  it('U-NEXT（有効）は通過する', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'U-NEXT', type: 'flatrate' }))).toBe(true);
  });

  it('Hulu と unknown の混在リストでフィルタすると Hulu のみ残る', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Hulu', type: 'flatrate' }),
      provider({ providerId: 2, providerName: 'unknown', type: 'unknown' }),
      provider({ providerId: 3, providerName: 'UNKNOWN', type: 'rent' }),
      provider({ providerId: 4, providerName: ' unknown ', type: 'buy' }),
    ];
    const result = providers.filter((p) => isConfirmedVodAvailability(p));
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Hulu');
  });

  // ─── unknown のみ ────────────────────────────────────────────────────────
  it('unknown のみのリストは空になる', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'unknown', type: 'unknown' }),
      provider({ providerId: 2, providerName: 'UNKNOWN', type: 'rent' }),
    ];
    expect(providers.filter((p) => isConfirmedVodAvailability(p))).toHaveLength(0);
  });

  // ─── 正常系 ──────────────────────────────────────────────────────────────
  it('有効なサービス名 + 有効 type → true', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Netflix', type: 'flatrate' }))).toBe(true);
  });

  it('type="buy"（購入）は有効サービス名なら通過する', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Apple TV', type: 'buy' }))).toBe(true);
  });

  // ─── terminatedSlugs による終了済みサービス除外 ────────────────────────
  it('terminatedSlugs に含まれるサービスは false', () => {
    const terminated = new Set(['hulu']);
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu' }), terminated)).toBe(false);
  });

  it('terminatedSlugs に "hulu" があれば "Hulu JP" も false（jp正規化）', () => {
    const terminated = new Set(['hulu']);
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu JP' }), terminated)).toBe(false);
  });

  it('terminatedSlugs に含まれないサービスは影響を受けない', () => {
    const terminated = new Set(['hulu']);
    expect(isConfirmedVodAvailability(provider({ providerName: 'Netflix' }), terminated)).toBe(true);
  });

  it('terminatedSlugs が空 Set の場合は従来通り動作する', () => {
    const terminated = new Set<string>();
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu' }), terminated)).toBe(true);
  });

  it('terminatedSlugs が undefined の場合は従来通り動作する', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Hulu' }), undefined)).toBe(true);
  });
});

describe('normalizeProviderName', () => {
  it('"Hulu JP" → "hulu"（末尾jp除去）', () => {
    expect(normalizeProviderName('Hulu JP')).toBe('hulu');
  });

  it('"U-NEXT JP" → "unext"（末尾jp除去 + ハイフン除去）', () => {
    expect(normalizeProviderName('U-NEXT JP')).toBe('unext');
  });

  it('"Netflix" → "netflix"（jpなしは変化なし）', () => {
    expect(normalizeProviderName('Netflix')).toBe('netflix');
  });

  it('"JP" のみの場合は除去しない（2文字未満ガード）', () => {
    expect(normalizeProviderName('JP')).toBe('jp');
  });

  it('"Disney+" → "disneyplus"', () => {
    expect(normalizeProviderName('Disney+')).toBe('disneyplus');
  });

  it('"U-NEXT" → "unext"', () => {
    expect(normalizeProviderName('U-NEXT')).toBe('unext');
  });
});

describe('deduplicateProviders', () => {
  it('"Hulu" と "Hulu JP" は同一サービスとして1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Hulu', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Hulu JP', source: 'openai_supplement' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Hulu');
  });

  it('"U-NEXT" と "U-NEXT JP" は同一サービスとして1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'U-NEXT JP', source: 'openai_supplement' }),
      provider({ providerId: 2, providerName: 'U-NEXT', source: 'tmdb_watch_provider' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('U-NEXT');
  });
});

describe('filterPublicVodProviders', () => {
  it('unknown と終了済みサービスを除外し重複を集約する', () => {
    const terminated = new Set(['hulu']);
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Netflix', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Hulu', source: 'tmdb_watch_provider' }),
      provider({ providerId: 3, providerName: 'unknown', type: 'unknown' }),
      provider({ providerId: 4, providerName: 'Netflix', source: 'openai_supplement' }),
    ];
    const result = filterPublicVodProviders(providers, terminated);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('terminatedSlugs を省略した場合は終了済み除外なしで動作する', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Hulu', source: 'tmdb_watch_provider' }),
    ];
    const result = filterPublicVodProviders(providers);
    expect(result).toHaveLength(1);
  });
});
