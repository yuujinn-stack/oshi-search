import type { ServiceUsage } from './types';

interface VercelProjectData {
  name: string;
  framework: string | null;
  nodeVersion: string | null;
  productionUrl: string | null;
  cronJobCount: number;
}

async function fetchVercelProject(): Promise<VercelProjectData | null> {
  const token = process.env.VERCEL_ACCESS_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;

  const teamId = process.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : '';
  const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return {
    name:           String(data.name ?? ''),
    framework:      data.framework ? String(data.framework) : null,
    nodeVersion:    data.nodeVersion ? String(data.nodeVersion) : null,
    productionUrl:  data.alias?.[0]?.domain ? `https://${data.alias[0].domain}` : null,
    cronJobCount:   Array.isArray(data.crons?.definitions) ? data.crons.definitions.length : 0,
  };
}

const VERCEL_CRON_PATHS = [
  '/api/cron/person-fetch',
  '/api/cron/refresh',
  '/api/cron/vod-recheck',
  '/api/cron/vod-refresh',
];

export async function getVercelUsage(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();
  const hasToken = !!(process.env.VERCEL_ACCESS_TOKEN && process.env.VERCEL_PROJECT_ID);

  let project: VercelProjectData | null = null;
  let fetchError: string | null = null;

  if (hasToken) {
    try {
      project = await fetchVercelProject();
      if (!project) fetchError = 'Vercel API からプロジェクト情報を取得できませんでした';
    } catch (e) {
      fetchError = String(e);
    }
  }

  const unavailableReason = !hasToken
    ? 'VERCEL_ACCESS_TOKEN または VERCEL_PROJECT_ID が未設定'
    : fetchError ?? undefined;

  return {
    serviceId: 'vercel',
    displayName: 'Vercel',
    purpose: 'Webサイト・API・管理画面のホスティング、Cron実行',
    plan: null,
    planSource: 'unavailable',
    status: fetchError ? 'fetch_error' : hasToken ? 'ok' : 'unknown',
    metrics: [],
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl: 'https://vercel.com/dashboard',
    fetchedAt,
    fetchError: !hasToken ? null : fetchError,
    details: {
      apiAvailable: project !== null,
      apiUnavailableReason: unavailableReason,
      projectName: project?.name,
      framework: project?.framework,
      nodeVersion: project?.nodeVersion,
      productionUrl: project?.productionUrl,
      cronJobCount: project?.cronJobCount ?? VERCEL_CRON_PATHS.length,
      cronPaths: VERCEL_CRON_PATHS,
      usageNote: 'Functions呼び出し数・CPU・帯域などはVercel Billing APIが必要です。Vercelプランによっては取得不可。',
      billingUrl: 'https://vercel.com/dashboard/usage',
    },
  };
}
