import { neonSql } from '@/db/client';
import type { ServiceUsage, ServiceMetric } from './types';

const TABLE_CATEGORY: Record<string, string> = {
  persons:                '人物情報',
  person_meta:            '人物情報',
  group_meta:             '人物情報',
  works:                  '出演作品',
  products:               '楽天商品',
  verdicts:               'AI・手動判定',
  vod_providers:          'VOD配信情報',
  vod_intensive_persons:  'VOD配信情報',
  batch_meta:             'システム管理',
  import_history:         'システム管理',
  openai_usage_logs:      'システム管理',
  product_display_order:  'システム管理',
  system_usage_snapshots: 'システム管理',
};

interface TableStat {
  tableName: string;
  category: string;
  totalBytes: number;
  dataBytes: number;
  indexesBytes: number;
  rowCount: number;
}

interface NeonApiData {
  projectName: string;
  pgVersion: number;
  plan?: string;
  storageBytes?: number;
  storageLimitBytes?: number;
  computeSeconds?: number;
  computeQuotaSeconds?: number;
  dataTransferBytes?: number;
  dataTransferLimitBytes?: number;
}

async function fetchNeonInternalStats(): Promise<{ dbSizeBytes: number; tables: TableStat[] }> {
  const [sizeRows, tableRows] = await Promise.all([
    neonSql`SELECT pg_database_size(current_database()) AS db_size_bytes`,
    neonSql`
      SELECT
        t.relname AS table_name,
        pg_total_relation_size(t.oid) AS total_bytes,
        pg_relation_size(t.oid) AS data_bytes,
        pg_indexes_size(t.oid) AS indexes_bytes,
        COALESCE(s.n_live_tup, 0) AS row_count
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_stat_user_tables s
        ON s.relname = t.relname AND s.schemaname = 'public'
      WHERE n.nspname = 'public' AND t.relkind = 'r'
      ORDER BY total_bytes DESC
    `,
  ]);

  const dbSizeBytes = Number(sizeRows[0]?.db_size_bytes ?? 0);
  const tables: TableStat[] = tableRows.map((r) => ({
    tableName: String(r.table_name),
    category: TABLE_CATEGORY[String(r.table_name)] ?? 'その他',
    totalBytes: Number(r.total_bytes ?? 0),
    dataBytes: Number(r.data_bytes ?? 0),
    indexesBytes: Number(r.indexes_bytes ?? 0),
    rowCount: Number(r.row_count ?? 0),
  }));

  return { dbSizeBytes, tables };
}

async function fetchNeonApiStats(): Promise<NeonApiData | null> {
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  const res = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const body = await res.json();
  const p = body?.project;
  if (!p) return null;

  const quota = p.settings?.quota ?? {};
  return {
    projectName:           String(p.name ?? ''),
    pgVersion:             Number(p.pg_version ?? 0),
    plan:                  p.plan_id ? String(p.plan_id) : undefined,
    storageBytes:          p.data_storage_bytes_hour != null ? Number(p.data_storage_bytes_hour) : undefined,
    storageLimitBytes:     quota.logical_size_bytes != null ? Number(quota.logical_size_bytes) : undefined,
    computeSeconds:        p.compute_time_seconds != null ? Number(p.compute_time_seconds) : undefined,
    computeQuotaSeconds:   quota.compute_time_seconds != null ? Number(quota.compute_time_seconds) : undefined,
    dataTransferBytes:     p.data_transfer_bytes != null ? Number(p.data_transfer_bytes) : undefined,
    dataTransferLimitBytes: quota.data_transfer_bytes != null ? Number(quota.data_transfer_bytes) : undefined,
  };
}

function calcStatus(pct: number | null) {
  if (pct === null) return 'unknown' as const;
  if (pct >= 100) return 'exceeded' as const;
  if (pct >= 90) return 'critical' as const;
  if (pct >= 80) return 'warning' as const;
  if (pct >= 70) return 'alert' as const;
  return 'ok' as const;
}

export async function getNeonUsage(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();

  let internalStats: Awaited<ReturnType<typeof fetchNeonInternalStats>> | null = null;
  let internalError: string | null = null;
  try {
    internalStats = await fetchNeonInternalStats();
  } catch (e) {
    internalError = String(e);
  }

  let apiData: NeonApiData | null = null;
  try {
    apiData = await fetchNeonApiStats();
  } catch {
    // silently ignore Neon API failure
  }

  if (internalStats === null) {
    return {
      serviceId: 'neon',
      displayName: 'Neon PostgreSQL',
      purpose: '人物・作品・商品・判定・VOD情報などすべての永続データの正本',
      plan: apiData?.plan ?? null,
      planSource: apiData ? 'api' : 'unavailable',
      status: 'fetch_error',
      metrics: [],
      currentMonthlyCostUsd: null,
      projectedMonthlyCostUsd: null,
      costSource: 'unavailable',
      dashboardUrl: 'https://console.neon.tech',
      fetchedAt,
      fetchError: internalError,
      details: {},
    };
  }

  const metrics: ServiceMetric[] = [];

  // DB total size
  const dbSizeBytes = internalStats.dbSizeBytes;
  const storageLimitBytes = apiData?.storageLimitBytes ?? null;
  const storagePct = storageLimitBytes && dbSizeBytes
    ? Math.round((dbSizeBytes / storageLimitBytes) * 100)
    : null;

  metrics.push({
    label: 'ストレージ使用量',
    value: dbSizeBytes,
    unit: 'bytes',
    limit: storageLimitBytes,
    remaining: storageLimitBytes != null ? storageLimitBytes - dbSizeBytes : null,
    usagePercent: storagePct,
    source: storageLimitBytes != null ? 'api' : 'internal',
    isEstimated: false,
    note: storageLimitBytes == null ? 'Neon管理APIで上限取得可（NEON_API_KEY必要）' : undefined,
  });

  // Compute time
  if (apiData?.computeSeconds != null) {
    const computePct = apiData.computeQuotaSeconds
      ? Math.round((apiData.computeSeconds / apiData.computeQuotaSeconds) * 100)
      : null;
    metrics.push({
      label: 'コンピュート使用時間',
      value: apiData.computeSeconds,
      unit: 'seconds',
      limit: apiData.computeQuotaSeconds ?? null,
      remaining: apiData.computeQuotaSeconds != null
        ? apiData.computeQuotaSeconds - apiData.computeSeconds
        : null,
      usagePercent: computePct,
      source: 'api',
      isEstimated: false,
    });
  }

  // Data transfer
  if (apiData?.dataTransferBytes != null) {
    const transferPct = apiData.dataTransferLimitBytes
      ? Math.round((apiData.dataTransferBytes / apiData.dataTransferLimitBytes) * 100)
      : null;
    metrics.push({
      label: 'データ転送量',
      value: apiData.dataTransferBytes,
      unit: 'bytes',
      limit: apiData.dataTransferLimitBytes ?? null,
      remaining: apiData.dataTransferLimitBytes != null
        ? apiData.dataTransferLimitBytes - apiData.dataTransferBytes
        : null,
      usagePercent: transferPct,
      source: 'api',
      isEstimated: false,
    });
  }

  // Row counts per table
  const totalRows = internalStats.tables.reduce((s, t) => s + t.rowCount, 0);
  metrics.push({
    label: '総行数（概算）',
    value: totalRows,
    unit: '行',
    limit: null,
    remaining: null,
    usagePercent: null,
    source: 'internal',
    isEstimated: true,
    note: 'pg_stat_user_tables の n_live_tup（概算値）',
  });

  const worstPct = metrics
    .map((m) => m.usagePercent)
    .filter((p): p is number => p !== null)
    .reduce<number | null>((max, p) => (max === null || p > max ? p : max), null);

  return {
    serviceId: 'neon',
    displayName: 'Neon PostgreSQL',
    purpose: '人物・作品・商品・判定・VOD情報などすべての永続データの正本',
    plan: apiData?.plan ?? null,
    planSource: apiData ? 'api' : 'unavailable',
    status: calcStatus(worstPct),
    metrics,
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl: 'https://console.neon.tech',
    fetchedAt,
    fetchError: null,
    details: {
      tables: internalStats.tables,
      dbSizeBytes,
      neonApiAvailable: apiData !== null,
      neonApiData: apiData ?? undefined,
    },
  };
}
