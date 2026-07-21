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
  // ── JP 末尾除去 ─────────────────────────────────────────────────────────
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

  // ── + → plus ────────────────────────────────────────────────────────────
  it('"Disney+" → "disneyplus"', () => {
    expect(normalizeProviderName('Disney+')).toBe('disneyplus');
  });

  // ── 通常ハイフン除去 ─────────────────────────────────────────────────────
  it('"U-NEXT" → "unext"', () => {
    expect(normalizeProviderName('U-NEXT')).toBe('unext');
  });

  // ── Unicode ハイフン除去（U+2010） ────────────────────────────────────────
  it('"U‐NEXT"（U+2010 HYPHEN）→ "unext"', () => {
    expect(normalizeProviderName('U‐NEXT')).toBe('unext');
  });

  it('"U–NEXT"（U+2013 EN DASH）→ "unext"', () => {
    expect(normalizeProviderName('U–NEXT')).toBe('unext');
  });

  // ── Amazon Prime Video 各種表記 ───────────────────────────────────────────
  it('"Amazon Prime Video" → "primevideo"', () => {
    expect(normalizeProviderName('Amazon Prime Video')).toBe('primevideo');
  });

  it('"Amazonプライム・ビデオ" → "primevideo"', () => {
    expect(normalizeProviderName('Amazonプライム・ビデオ')).toBe('primevideo');
  });

  it('"Amazon プライム・ビデオ" → "primevideo"（スペース入り）', () => {
    expect(normalizeProviderName('Amazon プライム・ビデオ')).toBe('primevideo');
  });

  it('"Amazon Prime Video with Ads" → "primevideo"', () => {
    expect(normalizeProviderName('Amazon Prime Video with Ads')).toBe('primevideo');
  });

  it('"prime video" → "primevideo"', () => {
    expect(normalizeProviderName('prime video')).toBe('primevideo');
  });

  // ── U-NEXT カナ ──────────────────────────────────────────────────────────
  it('"ユーネクスト" → "unext"', () => {
    expect(normalizeProviderName('ユーネクスト')).toBe('unext');
  });

  it('"U NEXT"（スペース区切り）→ "unext"', () => {
    expect(normalizeProviderName('U NEXT')).toBe('unext');
  });

  // ── Disney+ 各種表記 ──────────────────────────────────────────────────────
  it('"Disney Plus" → "disneyplus"', () => {
    expect(normalizeProviderName('Disney Plus')).toBe('disneyplus');
  });

  it('"DisneyPlus" → "disneyplus"', () => {
    expect(normalizeProviderName('DisneyPlus')).toBe('disneyplus');
  });

  it('"ディズニープラス" → "disneyplus"', () => {
    expect(normalizeProviderName('ディズニープラス')).toBe('disneyplus');
  });

  // ── ABEMA ────────────────────────────────────────────────────────────────
  it('"AbemaTV" → "abema"', () => {
    expect(normalizeProviderName('AbemaTV')).toBe('abema');
  });

  it('"ABEMA" → "abema"（そのまま）', () => {
    expect(normalizeProviderName('ABEMA')).toBe('abema');
  });

  // ── DMM TV ───────────────────────────────────────────────────────────────
  it('"DMMTV" → "dmmtv"', () => {
    expect(normalizeProviderName('DMMTV')).toBe('dmmtv');
  });

  it('"DMM TV" → "dmmtv"', () => {
    expect(normalizeProviderName('DMM TV')).toBe('dmmtv');
  });

  // ── Amazon JP パターン ────────────────────────────────────────────────────
  it('"Amazon Prime Video JP" → "primevideo"（jp除去後にエイリアス）', () => {
    expect(normalizeProviderName('Amazon Prime Video JP')).toBe('primevideo');
  });

  // ── Prime Video 追加チャンネル（primevideo本体にならないこと）────────────────
  it('"Amazon Prime Video（Leminoセレクト）" → primevideo 本体にはならない', () => {
    const result = normalizeProviderName('Amazon Prime Video（Leminoセレクト）');
    expect(result).not.toBe('primevideo');
  });

  it('"Amazon Prime Video（Leminoせれくと）" → amazonchannel サフィックス付きの独立slug', () => {
    const result = normalizeProviderName('Amazon Prime Video（Leminoセレクト）');
    expect(result).toContain('amazonchannel');
  });

  it('"Amazon Prime Video (Leminoセレクト)"（英括弧）→ primevideo 本体にはならない', () => {
    const result = normalizeProviderName('Amazon Prime Video (Leminoセレクト)');
    expect(result).not.toBe('primevideo');
    expect(result).toContain('amazonchannel');
  });

  it('"Amazon Prime Video（JP）" → パススルー扱いで "primevideo"', () => {
    expect(normalizeProviderName('Amazon Prime Video（JP）')).toBe('primevideo');
  });

  it('"FODチャンネル for Prime Video" → primevideo 本体にはならない（独立slug）', () => {
    const result = normalizeProviderName('FODチャンネル for Prime Video');
    expect(result).not.toBe('primevideo');
  });

  it('"NHKオンデマンド for Prime Video" → primevideo 本体にはならない（独立slug）', () => {
    const result = normalizeProviderName('NHKオンデマンド for Prime Video');
    expect(result).not.toBe('primevideo');
  });

  it('"Amazon Prime Video" 本体は引き続き "primevideo"', () => {
    expect(normalizeProviderName('Amazon Prime Video')).toBe('primevideo');
  });

  it('"Amazon Prime Video with Ads" 本体は引き続き "primevideo"', () => {
    expect(normalizeProviderName('Amazon Prime Video with Ads')).toBe('primevideo');
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

  it('"Prime Video" と "Amazon Prime Video" と "Amazonプライム・ビデオ" は1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Amazon Prime Video', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Amazonプライム・ビデオ', source: 'openai_supplement' }),
      provider({ providerId: 3, providerName: 'Prime Video', source: 'manual_csv' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    // TMDb ソースが最高優先度で勝者になる
    expect(result[0].providerName).toBe('Amazon Prime Video');
  });

  it('"ABEMA" と "AbemaTV" は1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'AbemaTV', source: 'openai_supplement' }),
      provider({ providerId: 2, providerName: 'ABEMA', source: 'tmdb_watch_provider' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('ABEMA');
  });

  it('重複除去後も winner のフィールド（confidence, sourceUrl, note）は保持される', () => {
    const providers: VodProvider[] = [
      provider({
        providerId: 1,
        providerName: 'Amazon Prime Video',
        source: 'tmdb_watch_provider',
        sourceUrl: 'https://example.com/tmdb',
        note: 'TMDbから取得',
        confidence: 'high',
      }),
      provider({
        providerId: 2,
        providerName: 'Amazonプライム・ビデオ',
        source: 'openai_supplement',
        confidence: 'medium',
      }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].sourceUrl).toBe('https://example.com/tmdb');
    expect(result[0].note).toBe('TMDbから取得');
    expect(result[0].confidence).toBe('high');
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
