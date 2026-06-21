export interface VodFetchDebugItem {
  title: string;
  workId: string;
  tmdbId?: number;
  workType: 'movie' | 'tv';
  jpExists: boolean;
  tmdbProviderCount: number;
  tmdbFlatrateCount: number;
  tmdbRentCount: number;
  tmdbBuyCount: number;
  tmdbAdsCount: number;
  tmdbReason?: string;
  aiCalled: boolean;
  aiCallReason: string;
  aiProviderCount: number;
  finalProviderCount: number;
  finalProviders: Array<{
    name: string;
    type: string;
    source: string;
    sourceLabel?: string;
    confidence?: string;
    officialUrl?: string;
    reason?: string;
    checkedDate?: string;
    note?: string;
    publicVisible: boolean;
    hiddenReason?: string;
  }>;
}

export interface Counts {
  total: number;
  published: number;
  review: number;
  hidden: number;
  noVod: number;
  noTmdbId: number;
  manualCsv: number;
  aiSupplement: number;
}

export interface DashboardStats {
  personCount: number;
  totalWorks: number;
  published: number;
  review: number;
  hidden: number;
  noVod: number;
  noTmdbId: number;
  manualCsv: number;
  aiSupplement: number;
}

export interface PersonWithCounts {
  name: string;
  group: string;
  counts: Counts;
}
