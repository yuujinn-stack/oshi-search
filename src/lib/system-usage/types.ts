export type UsageSource = 'api' | 'internal' | 'estimated' | 'unavailable';
export type UsageStatus = 'ok' | 'warning' | 'alert' | 'critical' | 'exceeded' | 'fetch_error' | 'unknown';

export interface ServiceMetric {
  label: string;
  value: number | null;
  unit: string;
  limit: number | null;
  remaining: number | null;
  usagePercent: number | null;
  source: UsageSource;
  isEstimated: boolean;
  note?: string;
}

export interface ServiceUsage {
  serviceId: string;
  displayName: string;
  purpose: string;
  plan: string | null;
  planSource: UsageSource;
  status: UsageStatus;
  metrics: ServiceMetric[];
  currentMonthlyCostUsd: number | null;
  projectedMonthlyCostUsd: number | null;
  costSource: UsageSource;
  dashboardUrl: string | null;
  fetchedAt: string;
  fetchError: string | null;
  details: Record<string, unknown>;
}

export interface SnapshotPoint {
  recordedAt: string;
  value: number;
}

export interface SnapshotTrend {
  service: string;
  metric: string;
  unit: string;
  history: SnapshotPoint[];
  change7d: number | null;
  change30d: number | null;
  dailyAvgIncrease: number | null;
  projectedLimitDate: string | null;
  projectedMonthEnd: number | null;
  dataInsufficient: boolean;
}

export interface SystemUsageReport {
  generatedAt: string;
  cacheHit: boolean;
  cacheExpiresAt: string | null;
  services: ServiceUsage[];
  trends: SnapshotTrend[];
  totalEstimatedCostUsd: number | null;
  warningCount: number;
  fetchErrorCount: number;
}
