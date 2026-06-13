export type VodProviderType = 'flatrate' | 'buy' | 'rent' | 'free' | 'ads' | 'unknown';
export type VodSource = 'tmdb_watch_provider' | 'openai_supplement' | 'openai_web_search' | 'manual' | 'manual_import';

export interface VodProvider {
  providerId: number;
  providerName: string;
  logoPath?: string;        // TMDb ロゴパス（例: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg"）
  displayPriority?: number;
  type: VodProviderType;    // flatrate=定額, buy=購入, rent=レンタル, free=無料, ads=広告付き, unknown=不明
  countryCode: string;      // 'JP'
  source: VodSource;
  sourceLabel?: string;     // 表示用ラベル（"TMDb" / "AI補完" / "AI Web検索補完" / "手動"）
  confidence?: 'high' | 'medium' | 'low';  // AI補完時の信頼度（low は公開ページ非表示）
  sourceUrl?: string;       // AI補完時の参照URL
  officialUrl?: string;     // Web検索で確認した配信ページURL
  reason?: string;          // AI判定理由（管理画面のみ表示）
  checkedDate?: string;     // 情報確認日 (YYYY-MM-DD)
  note?: string;            // 補足メモ
  link?: string;            // JustWatch URL（TMDb が返す作品ページへのリンク）
  createdAt?: number;
  updatedAt?: number;
}

// VodProviderType の日本語ラベル
export const VOD_TYPE_LABEL: Record<VodProviderType, string> = {
  flatrate: '見放題',
  rent: 'レンタル',
  buy: '購入',
  free: '無料',
  ads: '広告付き無料',
  unknown: '不明',
};
