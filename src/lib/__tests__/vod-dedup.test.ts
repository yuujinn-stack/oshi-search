import { describe, it, expect } from 'vitest';
import { isConfirmedVodAvailability, normalizeProviderName, deduplicateProviders, filterPublicVodProviders, isPrimeVideoChannel, getVodProviderDisplayInfo } from '../vod-dedup';
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

  // ── Netflix 広告付きプラン ─────────────────────────────────────────────────
  it('"Netflix Standard with Ads" → "netflix"（料金プランは本体へ統一）', () => {
    expect(normalizeProviderName('Netflix Standard with Ads')).toBe('netflix');
  });

  it('"Netflix Standard with ads"（小文字 a）→ "netflix"', () => {
    expect(normalizeProviderName('Netflix Standard with ads')).toBe('netflix');
  });

  it('"Netflix 広告つきスタンダード" → "netflix"', () => {
    expect(normalizeProviderName('Netflix 広告つきスタンダード')).toBe('netflix');
  });

  it('"Netflix 広告付きスタンダード" → "netflix"', () => {
    expect(normalizeProviderName('Netflix 広告付きスタンダード')).toBe('netflix');
  });

  // ── Leminoプレミアム ──────────────────────────────────────────────────────
  it('"Leminoプレミアム" → "lemino"（料金プランは本体へ統一）', () => {
    expect(normalizeProviderName('Leminoプレミアム')).toBe('lemino');
  });

  it('"Amazon Prime Video（Leminoセレクト）" は "lemino" にならない（追加チャンネル）', () => {
    const result = normalizeProviderName('Amazon Prime Video（Leminoセレクト）');
    expect(result).not.toBe('lemino');
    expect(result).toContain('amazonchannel');
  });

  // ── 独立slug維持：購入・レンタルストア ────────────────────────────────────
  it('"Amazon Video" は "primevideo" にならない（独立slug維持）', () => {
    expect(normalizeProviderName('Amazon Video')).toBe('amazonvideo');
  });

  it('"Google Play Movies" は独立slug', () => {
    expect(normalizeProviderName('Google Play Movies')).toBe('googleplaymovies');
  });

  it('"Apple TV" は独立slug', () => {
    expect(normalizeProviderName('Apple TV')).toBe('appletv');
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

  it('"Netflix" と "Netflix Standard with Ads" が同一作品にある場合、1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Netflix', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Netflix Standard with Ads', source: 'openai_supplement' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('"Lemino" と "Leminoプレミアム" が同一作品にある場合、1件に集約される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Lemino', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Leminoプレミアム', source: 'openai_supplement' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Lemino');
  });

  it('"Amazon Video" と "Amazon Prime Video" は統合されない（独立slug）', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Amazon Video', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Amazon Prime Video', source: 'tmdb_watch_provider' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(2);
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

// ─── isPrimeVideoChannel ──────────────────────────────────────────────────────

describe('isPrimeVideoChannel', () => {
  // 追加チャンネル（true）
  it('"TELASA Amazon Channel" → true', () => {
    expect(isPrimeVideoChannel('TELASA Amazon Channel')).toBe(true);
  });
  it('"FOD Channel Amazon Channel" → true', () => {
    expect(isPrimeVideoChannel('FOD Channel Amazon Channel')).toBe(true);
  });
  it('"Amazon Prime Video（Leminoせれくと）" → true', () => {
    expect(isPrimeVideoChannel('Amazon Prime Video（Leminoせれくと）')).toBe(true);
  });
  it('"Amazon Prime Video (Leminoセレクト)"（半角括弧）→ true', () => {
    expect(isPrimeVideoChannel('Amazon Prime Video (Leminoセレクト)')).toBe(true);
  });
  it('"FODチャンネル for Prime Video" → true（for Prime Video 形式）', () => {
    expect(isPrimeVideoChannel('FODチャンネル for Prime Video')).toBe(true);
  });
  it('"NHKオンデマンド for Prime Video" → true', () => {
    expect(isPrimeVideoChannel('NHKオンデマンド for Prime Video')).toBe(true);
  });

  // 追加チャンネルでない（false）
  it('"Amazon Prime Video" → false（本体）', () => {
    expect(isPrimeVideoChannel('Amazon Prime Video')).toBe(false);
  });
  it('"Amazon Prime Video with Ads" → false（本体・広告プラン）', () => {
    expect(isPrimeVideoChannel('Amazon Prime Video with Ads')).toBe(false);
  });
  it('"Amazon Video" → false（購入・レンタルストア）', () => {
    expect(isPrimeVideoChannel('Amazon Video')).toBe(false);
  });
  it('"Hulu" → false', () => {
    expect(isPrimeVideoChannel('Hulu')).toBe(false);
  });
  it('"U-NEXT" → false', () => {
    expect(isPrimeVideoChannel('U-NEXT')).toBe(false);
  });
  it('"Lemino" → false', () => {
    expect(isPrimeVideoChannel('Lemino')).toBe(false);
  });
  it('"Leminoプレミアム" → false（料金プランは本体へ統合済み）', () => {
    expect(isPrimeVideoChannel('Leminoプレミアム')).toBe(false);
  });
  it('"Netflix" → false', () => {
    expect(isPrimeVideoChannel('Netflix')).toBe(false);
  });
  it('"Netflix Standard with Ads" → false', () => {
    expect(isPrimeVideoChannel('Netflix Standard with Ads')).toBe(false);
  });
  it('"Disney+" → false', () => {
    expect(isPrimeVideoChannel('Disney+')).toBe(false);
  });
  it('"TVer" → false', () => {
    expect(isPrimeVideoChannel('TVer')).toBe(false);
  });
  it('"Google Play Movies" → false', () => {
    expect(isPrimeVideoChannel('Google Play Movies')).toBe(false);
  });
  it('"Apple TV" → false', () => {
    expect(isPrimeVideoChannel('Apple TV')).toBe(false);
  });
});

// ─── getVodProviderDisplayInfo ────────────────────────────────────────────────

describe('getVodProviderDisplayInfo', () => {
  // ── Test 1: TELASA Amazon Channel ──────────────────────────────────────────
  it('TELASA Amazon Channel: displayName・shortName・badge・noticeText', () => {
    const info = getVodProviderDisplayInfo('TELASA Amazon Channel');
    expect(info.displayName).toBe('Prime Video内 TELASAチャンネル');
    expect(info.shortName).toBe('TELASA');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.badgeLabel).toBe('追加チャンネル');
    expect(info.noticeText).toBe('別途チャンネル登録が必要です。');
  });

  // ── Test 2: FODチャンネル for Prime Video ──────────────────────────────────
  it('FODチャンネル for Prime Video: 追加チャンネル判定・displayName', () => {
    const info = getVodProviderDisplayInfo('FODチャンネル for Prime Video');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).toBe('Prime Video内 FODチャンネル');
    expect(info.badgeLabel).toBe('追加チャンネル');
  });

  // ── Test 3: NHKオンデマンド for Prime Video ────────────────────────────────
  it('NHKオンデマンド for Prime Video: 追加チャンネル・displayName', () => {
    const info = getVodProviderDisplayInfo('NHKオンデマンド for Prime Video');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).toBe('Prime Video内 NHKオンデマンド');
    expect(info.noticeText).not.toBeNull();
  });

  // ── Test 4: Amazon Prime Video (Leminoせれくと) 半角括弧 ───────────────────
  it('"Amazon Prime Video (Leminoせれくと)": Prime Video本体でも Lemino本体でもない', () => {
    const info = getVodProviderDisplayInfo('Amazon Prime Video (Leminoせれくと)');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).not.toBe('Amazon Prime Video');
    expect(info.displayName).not.toBe('Lemino');
    expect(info.displayName).toContain('Prime Video内');
    expect(info.badgeLabel).toBe('追加チャンネル');
  });

  // ── Test 5: Amazon Prime Video（Leminoセレクト）全角括弧 ──────────────────
  it('"Amazon Prime Video（Leminoセレクト）"（全角）: 半角と同じ追加チャンネル判定', () => {
    const info = getVodProviderDisplayInfo('Amazon Prime Video（Leminoセレクト）');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).toContain('Prime Video内');
    expect(info.displayName).toContain('Lemino');
    expect(info.badgeLabel).toBe('追加チャンネル');
  });

  // ── Test 6: Amazon Prime Video 本体 ───────────────────────────────────────
  it('"Amazon Prime Video": 表示名は "Prime Video" に統一・追加チャンネルではない', () => {
    const info = getVodProviderDisplayInfo('Amazon Prime Video');
    expect(info.isPrimeVideoChannel).toBe(false);
    expect(info.displayName).toBe('Prime Video');
    expect(info.badgeLabel).toBeNull();
    expect(info.noticeText).toBeNull();
  });

  // ── Test 7: Amazon Prime Video with Ads ───────────────────────────────────
  it('"Amazon Prime Video with Ads": 追加チャンネルではない', () => {
    const info = getVodProviderDisplayInfo('Amazon Prime Video with Ads');
    expect(info.isPrimeVideoChannel).toBe(false);
    expect(info.badgeLabel).toBeNull();
  });

  // ── Test 8: Amazon Video ───────────────────────────────────────────────────
  it('"Amazon Video": 表示名は "Prime Video"・追加チャンネルではない（スラグは独立）', () => {
    const info = getVodProviderDisplayInfo('Amazon Video');
    expect(info.isPrimeVideoChannel).toBe(false);
    expect(info.displayName).toBe('Prime Video');
    expect(info.badgeLabel).toBeNull();
    expect(info.noticeText).toBeNull();
  });

  // ── Test 9: 通常VODサービス ────────────────────────────────────────────────
  const regularServices = [
    'Hulu', 'U-NEXT', 'Lemino', 'Leminoプレミアム',
    'Netflix', 'Netflix Standard with Ads', 'Disney+', 'TVer',
  ];
  for (const name of regularServices) {
    it(`"${name}": 追加チャンネルバッジ・補足文なし`, () => {
      const info = getVodProviderDisplayInfo(name);
      expect(info.isPrimeVideoChannel).toBe(false);
      expect(info.badgeLabel).toBeNull();
      expect(info.noticeText).toBeNull();
    });
  }

  // ── Test 10: データ保持（providerName 等を変更しない）──────────────────────
  it('getVodProviderDisplayInfo は VodProvider オブジェクトを変更しない', () => {
    const p = {
      providerId: 99,
      providerName: 'TELASA Amazon Channel',
      type: 'flatrate' as const,
      countryCode: 'JP',
      source: 'tmdb_watch_provider' as const,
      sourceUrl: 'https://example.com',
      confidence: 'high' as const,
      note: 'テストメモ',
    };
    const before = { ...p };
    getVodProviderDisplayInfo(p.providerName);
    expect(p.providerName).toBe(before.providerName);
    expect(p.sourceUrl).toBe(before.sourceUrl);
    expect(p.confidence).toBe(before.confidence);
    expect(p.note).toBe(before.note);
  });

  // ── Test 11: SEO — 追加チャンネルのみの作品に "Prime Videoで見放題" を出さない ─
  it('TELASA Amazon Channel の displayName は "Prime Video" 単体に一致しない', () => {
    const info = getVodProviderDisplayInfo('TELASA Amazon Channel');
    expect(info.displayName).not.toBe('Prime Video');
    expect(info.displayName).not.toBe('Amazon Prime Video');
    // "Prime Video内" を含むが、本体と誤認させない "内" が必須
    expect(info.displayName).toContain('内');
  });

  // ── FOD Channel Amazon Channel（実DBデータ形式）──────────────────────────
  it('"FOD Channel Amazon Channel": displayName="Prime Video内 FODチャンネル"', () => {
    const info = getVodProviderDisplayInfo('FOD Channel Amazon Channel');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).toBe('Prime Video内 FODチャンネル');
    expect(info.shortName).toBe('FOD');
  });
});

// ─── Prime Video 名称統一（表示層正規化） ─────────────────────────────────────

describe('Prime Video 名称統一 — getVodProviderDisplayInfo', () => {
  // 1. Amazon Prime Video → "Prime Video"
  it('Amazon Prime Video の displayName は "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Amazon Prime Video').displayName).toBe('Prime Video');
  });

  // 2. Amazon Prime Video with Ads → "Prime Video"
  it('Amazon Prime Video with Ads の displayName は "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Amazon Prime Video with Ads').displayName).toBe('Prime Video');
  });

  // 3. Amazonプライム・ビデオ → "Prime Video"
  it('Amazonプライム・ビデオ の displayName は "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Amazonプライム・ビデオ').displayName).toBe('Prime Video');
  });

  // 4. Prime Video → "Prime Video"
  it('Prime Video の displayName は "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Prime Video').displayName).toBe('Prime Video');
  });

  // 5. shortName も "Prime Video" に統一される
  it('Amazon Prime Video の shortName も "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Amazon Prime Video').shortName).toBe('Prime Video');
  });

  // 6. Amazon Video は表示名のみ "Prime Video"（スラグは "amazonvideo" 独立・追加チャンネルでない）
  it('Amazon Video の displayName は "Prime Video"（isPrimeVideoChannel:false, スラグは独立）', () => {
    const info = getVodProviderDisplayInfo('Amazon Video');
    expect(info.displayName).toBe('Prime Video');
    expect(info.isPrimeVideoChannel).toBe(false);
    expect(normalizeProviderName('Amazon Video')).toBe('amazonvideo');
  });

  // 7. 追加チャンネルは "Prime Video" 単体にならない
  it('TELASA Amazon Channel の displayName は "Prime Video" 単体でなく "Prime Video内 ..."', () => {
    const info = getVodProviderDisplayInfo('TELASA Amazon Channel');
    expect(info.displayName).not.toBe('Prime Video');
    expect(info.displayName).toContain('Prime Video内');
  });

  // 8. for Prime Video 形式の追加チャンネルも "Prime Video" 単体にならない
  it('NHKオンデマンド for Prime Video の displayName は "Prime Video" でなく "Prime Video内 ..."', () => {
    const info = getVodProviderDisplayInfo('NHKオンデマンド for Prime Video');
    expect(info.displayName).not.toBe('Prime Video');
    expect(info.displayName).toContain('Prime Video内');
  });

  // 9. Hulu などの通常サービスは providerName がそのまま表示名になる
  it('Hulu の displayName は "Hulu" のまま', () => {
    expect(getVodProviderDisplayInfo('Hulu').displayName).toBe('Hulu');
  });

  // 10. dTV は "dTV" のまま（Prime Video統一の影響を受けない）
  it('dTV の displayName は "dTV" のまま', () => {
    expect(getVodProviderDisplayInfo('dTV').displayName).toBe('dTV');
  });

  // 11. 正規化キーで providerWorkMap の集約が起きることを normalizeProviderName で確認
  it('Amazon Prime Video と Prime Video は normalizeProviderName で同一キーになる', () => {
    expect(normalizeProviderName('Amazon Prime Video')).toBe(normalizeProviderName('Prime Video'));
  });

  // 12. 有効サービスと unknown が混在した場合、unknown だけが除外される
  it('有効サービスと unknown が混在した場合、unknown だけが除外される', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Amazon Prime Video', type: 'flatrate', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'unknown', type: 'unknown' }),
      provider({ providerId: 3, providerName: 'Prime Video', type: 'flatrate', source: 'manual_csv' }),
      provider({ providerId: 4, providerName: 'UNKNOWN', type: 'rent' }),
    ];
    const result = filterPublicVodProviders(providers);
    // unknown は除外、Amazon Prime Video と Prime Video は同一サービスとして1件に集約
    expect(result).toHaveLength(1);
    expect(normalizeProviderName(result[0].providerName)).toBe('primevideo');
  });
});

// ─── Amazon Video 表示名統一（レンタル・購入） ────────────────────────────────

describe('Amazon Video 表示名統一', () => {
  // 1. Amazon Videoの公開表示名がPrime Videoになる
  it('Amazon Video の displayName は "Prime Video"', () => {
    expect(getVodProviderDisplayInfo('Amazon Video').displayName).toBe('Prime Video');
  });

  // 2. Amazon Videoのレンタルボタンが「Prime Videoでレンタルする」になる
  it('Amazon Video の displayName で "Prime Videoでレンタルする" が構成できる', () => {
    const info = getVodProviderDisplayInfo('Amazon Video');
    expect(info.isPrimeVideoChannel).toBe(false);
    // 作品ページのCTA: `${info.displayName}で${cfg.btnLabel}` → "Prime Videoでレンタルする"
    expect(`${info.displayName}でレンタルする`).toBe('Prime Videoでレンタルする');
  });

  // 3. availabilityType=rentが維持される
  it('Amazon Video(rent) は deduplicateProviders 後も type="rent" が維持される', () => {
    const p = provider({ providerId: 1, providerName: 'Amazon Video', type: 'rent' });
    const result = deduplicateProviders([p]);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Amazon Video');
    expect(result[0].type).toBe('rent');
  });

  // 4. Prime Video見放題とAmazon Videoレンタルが混在しても、提供形態が失われない
  it('Amazon Prime Video(flatrate)とAmazon Video(rent)は別エントリとして共存する', () => {
    const providers: VodProvider[] = [
      provider({ providerId: 1, providerName: 'Amazon Prime Video', type: 'flatrate', source: 'tmdb_watch_provider' }),
      provider({ providerId: 2, providerName: 'Amazon Video', type: 'rent', source: 'tmdb_watch_provider' }),
    ];
    const result = deduplicateProviders(providers);
    expect(result).toHaveLength(2);
    const types = result.map((p) => p.type);
    expect(types).toContain('flatrate');
    expect(types).toContain('rent');
  });

  // 5. Amazon追加チャンネルがPrime Video本体へ統合されない
  it('Amazon追加チャンネル(TELASA)は isPrimeVideoChannel=true、displayNameは "Prime Video内 ..."', () => {
    const info = getVodProviderDisplayInfo('TELASA Amazon Channel');
    expect(info.isPrimeVideoChannel).toBe(true);
    expect(info.displayName).not.toBe('Prime Video');
    expect(info.displayName).toContain('Prime Video内');
  });
});
