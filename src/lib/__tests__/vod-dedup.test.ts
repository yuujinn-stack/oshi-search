import { describe, it, expect } from 'vitest';
import { isConfirmedVodAvailability } from '../vod-dedup';
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
    const result = providers.filter(isConfirmedVodAvailability);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Hulu');
  });

  // ─── unknown のみ ────────────────────────────────────────────────────────
  it('unknown のみのリストは空になる', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'unknown', type: 'unknown' }),
      provider({ providerId: 2, providerName: 'UNKNOWN', type: 'rent' }),
    ];
    expect(providers.filter(isConfirmedVodAvailability)).toHaveLength(0);
  });

  // ─── 正常系 ──────────────────────────────────────────────────────────────
  it('有効なサービス名 + 有効 type → true', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Netflix', type: 'flatrate' }))).toBe(true);
  });

  it('type="buy"（購入）は有効サービス名なら通過する', () => {
    expect(isConfirmedVodAvailability(provider({ providerName: 'Apple TV', type: 'buy' }))).toBe(true);
  });
});
