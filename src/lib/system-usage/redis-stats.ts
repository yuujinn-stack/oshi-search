import { getRedis } from '@/lib/redis';
import type { ServiceUsage, ServiceMetric } from './types';

const KEY_PREFIXES = [
  { prefix: 'person:view:',      label: '人物閲覧カウント' },
  { prefix: 'search:',           label: '検索ランキング' },
  { prefix: 'work:click:',       label: '作品クリック' },
  { prefix: 'work:meta:',        label: '作品メタ' },
  { prefix: 'product:click:',    label: '商品クリック' },
  { prefix: 'product:meta:',     label: '商品メタ' },
  { prefix: 'person:productClicks:', label: '人物別商品クリック' },
  { prefix: 'person:job:',       label: '人物ジョブキュー' },
  { prefix: 'batch:',            label: 'バッチ処理' },
  { prefix: 'vod:',              label: 'VOD' },
  { prefix: 'cache:',            label: 'キャッシュ' },
  { prefix: 'admin:',            label: '管理データ' },
  { prefix: 'persons:',          label: '人物リスト' },
  { prefix: 'group:',            label: 'グループ' },
];

const MAX_SCAN_KEYS = 500;
const SCAN_COUNT = 50;

interface RedisInternalStats {
  keyCount: number;
  memoryBytes: number | null;
  prefixBreakdown: Record<string, number>;
  isSampled: boolean;
  sampledKeys: number;
}

async function parseInfoMemory(): Promise<number | null> {
  // Call Upstash REST API directly for INFO memory — @upstash/redis has no info() method
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['INFO', 'memory']),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const infoStr = data?.result;
    if (typeof infoStr === 'string') {
      const match = infoStr.match(/used_memory:(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  } catch {
    // Upstash may not support all INFO sections
  }
  return null;
}

async function fetchRedisInternalStats(): Promise<RedisInternalStats> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis未接続（UPSTASH_REDIS_REST_URL未設定）');

  const [keyCount, memoryBytes] = await Promise.all([
    redis.dbsize(),
    parseInfoMemory(),
  ]);

  // SCAN-limited prefix analysis
  const rawCounts: Record<string, number> = {};
  let cursor = 0;
  let scanned = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { count: SCAN_COUNT });
    cursor = Number(nextCursor);
    scanned += keys.length;

    for (const key of keys) {
      let matched = false;
      for (const { prefix } of KEY_PREFIXES) {
        if (key.startsWith(prefix)) {
          rawCounts[prefix] = (rawCounts[prefix] ?? 0) + 1;
          matched = true;
          break;
        }
      }
      if (!matched) rawCounts['その他'] = (rawCounts['その他'] ?? 0) + 1;
    }

    if (scanned >= MAX_SCAN_KEYS) break;
  } while (cursor !== 0);

  const isSampled = scanned < keyCount && cursor !== 0;
  const prefixBreakdown: Record<string, number> = {};

  if (isSampled && scanned > 0) {
    // Scale up counts proportionally
    const ratio = keyCount / scanned;
    for (const [k, v] of Object.entries(rawCounts)) {
      prefixBreakdown[k] = Math.round(v * ratio);
    }
  } else {
    Object.assign(prefixBreakdown, rawCounts);
  }

  return { keyCount, memoryBytes, prefixBreakdown, isSampled, sampledKeys: scanned };
}

interface UpstashApiStats {
  maxDailyBandwidthBytes?: number;
  usedDailyBandwidthBytes?: number;
  maxDataSizeBytes?: number;
  usedDataSizeBytes?: number;
  maxDailyRequests?: number;
  plan?: string;
  region?: string;
}

async function fetchUpstashApiStats(): Promise<UpstashApiStats | null> {
  const apiKey = process.env.UPSTASH_API_KEY;
  const email = process.env.UPSTASH_EMAIL;
  const databaseId = process.env.UPSTASH_DATABASE_ID;
  if (!apiKey || !email || !databaseId) return null;

  const credential = Buffer.from(`${email}:${apiKey}`).toString('base64');
  const res = await fetch(`https://api.upstash.com/v2/redis/database/${databaseId}`, {
    headers: {
      Authorization: `Basic ${credential}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;
  const data = await res.json();

  return {
    maxDailyBandwidthBytes: data.max_daily_bandwidth != null ? Number(data.max_daily_bandwidth) : undefined,
    usedDailyBandwidthBytes: data.used_daily_bandwidth != null ? Number(data.used_daily_bandwidth) : undefined,
    maxDataSizeBytes: data.max_data_size != null ? Number(data.max_data_size) : undefined,
    usedDataSizeBytes: data.used_data_size != null ? Number(data.used_data_size) : undefined,
    maxDailyRequests: data.max_request_per_day != null ? Number(data.max_request_per_day) : undefined,
    plan: data.tier ? String(data.tier) : undefined,
    region: data.region ? String(data.region) : undefined,
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

export async function getRedisUsage(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();

  let internalStats: RedisInternalStats | null = null;
  let internalError: string | null = null;
  try {
    internalStats = await fetchRedisInternalStats();
  } catch (e) {
    internalError = String(e);
  }

  let apiStats: UpstashApiStats | null = null;
  try {
    apiStats = await fetchUpstashApiStats();
  } catch {
    // silently ignore
  }

  if (internalStats === null) {
    return {
      serviceId: 'redis',
      displayName: 'Upstash Redis',
      purpose: '閲覧・クリック集計、検索ランキング、ジョブキュー、短期キャッシュ',
      plan: apiStats?.plan ?? null,
      planSource: apiStats ? 'api' : 'unavailable',
      status: 'fetch_error',
      metrics: [],
      currentMonthlyCostUsd: null,
      projectedMonthlyCostUsd: null,
      costSource: 'unavailable',
      dashboardUrl: 'https://console.upstash.com',
      fetchedAt,
      fetchError: internalError,
      details: { upstashApiAvailable: apiStats !== null },
    };
  }

  const metrics: ServiceMetric[] = [];

  // Key count
  const maxKeys = apiStats?.maxDailyRequests != null ? null : null; // key count limit not directly comparable to daily requests
  metrics.push({
    label: 'キー数',
    value: internalStats.keyCount,
    unit: '件',
    limit: null,
    remaining: null,
    usagePercent: null,
    source: 'internal',
    isEstimated: false,
  });

  // Memory
  const memBytes = apiStats?.usedDataSizeBytes ?? internalStats.memoryBytes;
  const memLimit = apiStats?.maxDataSizeBytes ?? null;
  const memPct = memBytes != null && memLimit != null
    ? Math.round((memBytes / memLimit) * 100)
    : null;

  if (memBytes != null) {
    metrics.push({
      label: 'データサイズ',
      value: memBytes,
      unit: 'bytes',
      limit: memLimit,
      remaining: memLimit != null ? memLimit - memBytes : null,
      usagePercent: memPct,
      source: apiStats?.usedDataSizeBytes != null ? 'api' : 'internal',
      isEstimated: apiStats?.usedDataSizeBytes == null,
      note: apiStats?.usedDataSizeBytes == null
        ? 'used_memory（概算）。正確な値はUpstash APIで取得可（UPSTASH_API_KEY必要）'
        : undefined,
    });
  }

  // Daily bandwidth
  if (apiStats?.usedDailyBandwidthBytes != null) {
    const bwPct = apiStats.maxDailyBandwidthBytes
      ? Math.round((apiStats.usedDailyBandwidthBytes / apiStats.maxDailyBandwidthBytes) * 100)
      : null;
    metrics.push({
      label: '日次帯域使用量',
      value: apiStats.usedDailyBandwidthBytes,
      unit: 'bytes',
      limit: apiStats.maxDailyBandwidthBytes ?? null,
      remaining: apiStats.maxDailyBandwidthBytes != null
        ? apiStats.maxDailyBandwidthBytes - apiStats.usedDailyBandwidthBytes
        : null,
      usagePercent: bwPct,
      source: 'api',
      isEstimated: false,
    });
  }

  const worstPct = metrics
    .map((m) => m.usagePercent)
    .filter((p): p is number => p !== null)
    .reduce<number | null>((max, p) => (max === null || p > max ? p : max), null);

  return {
    serviceId: 'redis',
    displayName: 'Upstash Redis',
    purpose: '閲覧・クリック集計、検索ランキング、ジョブキュー、短期キャッシュ',
    plan: apiStats?.plan ?? null,
    planSource: apiStats ? 'api' : 'unavailable',
    status: calcStatus(worstPct),
    metrics,
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl: 'https://console.upstash.com',
    fetchedAt,
    fetchError: null,
    details: {
      keyCount: internalStats.keyCount,
      memoryBytes: internalStats.memoryBytes,
      prefixBreakdown: internalStats.prefixBreakdown,
      isSampled: internalStats.isSampled,
      sampledKeys: internalStats.sampledKeys,
      upstashApiAvailable: apiStats !== null,
      apiRegion: apiStats?.region,
    },
  };
}
