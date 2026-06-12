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
  aiReason?: string;
  checkedAt?: number;
  createdAt: number;
  updatedAt: number;
}
