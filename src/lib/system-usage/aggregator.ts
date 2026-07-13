import { getRedis } from '@/lib/redis';
import { getNeonUsage } from './neon';
import { getRedisUsage } from './redis-stats';
import { getOpenAIUsage } from './openai';
import { getVercelUsage } from './vercel';
import { getTMDbInfo, getRakutenInfo } from './external-apis';
import { getSnaphotTrends } from './snapshot';
import type { ServiceUsage, SystemUsageReport } from './types';

const CACHE_KEY = 'cache:system-usage:v1';
const CACHE_TTL_SEC = 1800; // 30 minutes
const RATE_LIMIT_KEY = 'cache:system-usage:last-refresh';
const RATE_LIMIT_SEC = 60;

function makeErrorService(serviceId: string, displayName: string, purpose: string, dashboardUrl: string | null, error: unknown): ServiceUsage {
  return {
    serviceId,
    displayName,
    purpose,
    plan: null,
    planSource: 'unavailable',
    status: 'fetch_error',
    metrics: [],
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl,
    fetchedAt: new Date().toISOString(),
    fetchError: String(error),
    details: {},
  };
}

const FALLBACKS: Array<Pick<ServiceUsage, 'serviceId' | 'displayName' | 'purpose' | 'dashboardUrl'>> = [
  { serviceId: 'neon',    displayName: 'Neon PostgreSQL', purpose: '永続データの正本',                        dashboardUrl: 'https://console.neon.tech' },
  { serviceId: 'redis',   displayName: 'Upstash Redis',   purpose: '集計・ジョブキュー・キャッシュ',              dashboardUrl: 'https://console.upstash.com' },
  { serviceId: 'openai',  displayName: 'OpenAI API',      purpose: 'AI判定・補完・調査',                      dashboardUrl: 'https://platform.openai.com/usage' },
  { serviceId: 'vercel',  displayName: 'Vercel',          purpose: 'ホスティング・Cron',                      dashboardUrl: 'https://vercel.com/dashboard' },
  { serviceId: 'tmdb',    displayName: 'TMDb API',         purpose: '作品・人物メタデータ',                    dashboardUrl: 'https://www.themoviedb.org/settings/api' },
  { serviceId: 'rakuten', displayName: '楽天API',          purpose: '商品検索',                              dashboardUrl: 'https://webservice.rakuten.co.jp/app/list' },
];

async function fetchFresh(): Promise<Omit<SystemUsageReport, 'cacheHit' | 'cacheExpiresAt'>> {
  const fetchers = [
    getNeonUsage(),
    getRedisUsage(),
    getOpenAIUsage(),
    getVercelUsage(),
    getTMDbInfo(),
    getRakutenInfo(),
  ];

  const settled = await Promise.allSettled(fetchers);

  const services: ServiceUsage[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const fb = FALLBACKS[i];
    return makeErrorService(fb.serviceId, fb.displayName, fb.purpose, fb.dashboardUrl, result.reason);
  });

  const trends = await getSnaphotTrends(services).catch(() => []);

  const totalCost = services
    .map((s) => s.currentMonthlyCostUsd)
    .filter((c): c is number => c !== null)
    .reduce((a, b) => a + b, 0);

  const warningStatuses: ServiceUsage['status'][] = ['warning', 'alert', 'critical', 'exceeded'];
  const warningCount = services.filter((s) => warningStatuses.includes(s.status)).length;
  const fetchErrorCount = services.filter((s) => s.status === 'fetch_error').length;

  return {
    generatedAt: new Date().toISOString(),
    services,
    trends,
    totalEstimatedCostUsd: totalCost,
    warningCount,
    fetchErrorCount,
  };
}

export async function getSystemUsageReport(forceRefresh = false): Promise<SystemUsageReport> {
  const redis = getRedis();

  if (!forceRefresh && redis) {
    try {
      const cached = await redis.get<string>(CACHE_KEY);
      if (cached) {
        const report = JSON.parse(typeof cached === 'string' ? cached : JSON.stringify(cached)) as SystemUsageReport;
        return { ...report, cacheHit: true };
      }
    } catch {
      // cache miss — proceed to fetch
    }
  }

  const fresh = await fetchFresh();
  const expiresAt = new Date(Date.now() + CACHE_TTL_SEC * 1000).toISOString();
  const report: SystemUsageReport = { ...fresh, cacheHit: false, cacheExpiresAt: expiresAt };

  if (redis) {
    try {
      await redis.set(CACHE_KEY, JSON.stringify(report), { ex: CACHE_TTL_SEC });
    } catch {
      // cache write failure is non-fatal
    }
  }

  return report;
}

export async function checkRefreshRateLimit(): Promise<{ allowed: boolean; remainingSeconds: number }> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remainingSeconds: 0 };

  const ttl = await redis.ttl(RATE_LIMIT_KEY).catch(() => 0);
  if (ttl > 0) return { allowed: false, remainingSeconds: ttl };
  return { allowed: true, remainingSeconds: 0 };
}

export async function setRefreshRateLimit(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(RATE_LIMIT_KEY, '1', { ex: RATE_LIMIT_SEC }).catch(() => null);
}

export async function clearCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(CACHE_KEY).catch(() => null);
}
