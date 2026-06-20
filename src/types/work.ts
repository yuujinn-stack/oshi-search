export type WorkStatus = 'auto_published' | 'needs_review' | 'hidden';
export type WorkType = 'movie' | 'tv';
export type WorkSource = 'tmdb' | 'openai_suggestion' | 'manual';

export type { VodProvider, VodProviderType, VodSource } from './vod';

export interface WorkRecord {
  id: string;
  personName: string;
  title: string;
  originalTitle?: string;      // 原題（英語等）
  normalizedTitle: string;
  type: WorkType;
  tmdbId?: number;
  source: WorkSource;
  releaseYear?: number;
  roleName?: string;
  overview?: string;
  posterUrl?: string;
  confidenceScore: number;     // 参考値のみ（公開判定には使わない）
  status: WorkStatus;
  // AI判定詳細
  aiDecision?: WorkStatus;               // AIが直接返した decision（status の根拠）
  aiSamePerson?: boolean;               // AI: 同一人物か
  aiReason?: string;
  aiRelation?: 'strong' | 'medium' | 'weak' | 'none';
  aiStatusRecommendation?: WorkStatus;   // 後方互換のため残存
  aiNeedsHumanReview?: boolean;
  usedAi?: boolean;
  // TMDb人物マッチング情報（誤取得検証用）
  tmdbMatchedPersonId?: number;
  tmdbMatchedPersonName?: string;
  checkedAt?: number;      // 管理者が手動でステータスを変更した日時
  // 配信サービス情報
  vodProviders?: import('./vod').VodProvider[];
  vodUpdatedAt?: number;      // 最後に配信情報チェックを実行した日時（プロバイダーなし含む）
  vodAiCheckedAt?: number;    // 最後に OpenAI 補完を実行した日時
  vodStatus?: 'found' | 'not_found'; // AI補完の最終結果（not_found = 調査したが配信なし）
  nextVodCheckAt?: number;    // 次回VODチェックを許可する日時（not_found 時に30日後を設定）
  // 配信情報条件付き再確認（vod-recheck Cron 機能用）
  lastVodCheckAt?: number;         // AI再確認Cronによる最終確認日時
  vodCheckSource?: 'csv' | 'ai' | 'tmdb' | 'manual'; // 最終確認ソース
  vodCheckStatus?: 'fresh' | 'needs_recheck' | 'checking' | 'checked' | 'failed';
  vodCheckError?: string;
  priorityRecheck?: boolean;       // 管理者が設定した優先再確認フラグ
  createdAt: number;
  updatedAt: number;
}
