export type WorkStatus = 'auto_published' | 'needs_review' | 'hidden';
export type WorkType = 'movie' | 'tv';
export type WorkSource = 'tmdb' | 'openai_suggestion' | 'manual';

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
  checkedAt?: number; // 管理者が手動でステータスを変更した日時
  createdAt: number;
  updatedAt: number;
}
