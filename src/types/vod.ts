export type VodProviderType = 'flatrate' | 'buy' | 'rent' | 'free' | 'ads';
export type VodSource = 'tmdb_watch_provider' | 'manual';

export interface VodProvider {
  providerId: number;
  providerName: string;
  logoPath?: string;        // TMDb ロゴパス（例: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg"）
  displayPriority?: number;
  type: VodProviderType;    // flatrate=定額, buy=購入, rent=レンタル, free=無料, ads=広告付き
  countryCode: string;      // 'JP'
  source: VodSource;
  link?: string;            // JustWatch URL（TMDb が返す作品ページへのリンク）
}
