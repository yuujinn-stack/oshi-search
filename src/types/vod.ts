export type VodProviderType = 'flatrate' | 'buy' | 'rent' | 'free' | 'ads' | 'unknown';
export type VodSource = 'tmdb_watch_provider' | 'openai_supplement' | 'openai_web_search' | 'manual' | 'manual_csv' | 'ai_recheck';

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
  hidden?: boolean;         // 管理画面から手動で非表示にした場合 true（論理削除）
  manualApproval?: VodManualApproval; // 自動判定で保留された行を管理者が確認して承認した記録（CSV取り込み）
  createdAt?: number;
  updatedAt?: number;
}

/**
 * VOD CSV取り込みで「チャンネル疑い（保留）」になった Prime Video 行を、管理者が公式情報を確認して
 * 「Prime Video 本体の見放題（プライム会員料金のみ）」として承認した記録。
 */
export interface VodManualApproval {
  kind: 'prime_video_included';
  officialUrl: string;      // 確認に使った公式情報のURL
  reason: string;           // 確認理由
  approvedAt: string;       // 確認日時（ISO8601・サーバー時刻）
  heldCategory: 'channel' | 'rental' | 'ambiguous'; // 承認前の自動判定
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
