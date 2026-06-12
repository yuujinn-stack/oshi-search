export type WorkStatus = 'auto_published' | 'needs_review' | 'hidden';
export type WorkType = 'movie' | 'tv';
export type WorkSource = 'tmdb' | 'openai_suggestion' | 'manual';

export interface WorkRecord {
  id: string;
  personName: string;
  title: string;
  normalizedTitle: string;
  type: WorkType;
  tmdbId?: number;
  source: WorkSource;
  releaseYear?: number;
  roleName?: string;
  overview?: string;
  posterUrl?: string;
  confidenceScore: number;
  status: WorkStatus;
  // AI判定詳細
  aiReason?: string;
  aiRelation?: 'strong' | 'medium' | 'weak' | 'none'; // AIが判定した関連度
  aiStatusRecommendation?: WorkStatus;                 // AIが推奨したステータス
  aiNeedsHumanReview?: boolean;                        // AIが手動確認を推奨したか
  usedAi?: boolean;                                    // OpenAI APIを呼んだか（false=ルールベース）
  checkedAt?: number; // 管理者が手動でステータスを変更した日時（未設定=AI自動判定のみ）
  createdAt: number;
  updatedAt: number;
}
