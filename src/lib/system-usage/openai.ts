import { getUsageLogs } from '@/lib/openai-usage';
import { FEATURE_LABELS } from '@/lib/openai-pricing';
import type { ServiceUsage, ServiceMetric } from './types';

function monthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function daysInMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export async function getOpenAIUsage(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();
  const now = new Date();
  const from = monthStart(now);

  let logs: Awaited<ReturnType<typeof getUsageLogs>> = [];
  let fetchError: string | null = null;
  try {
    logs = await getUsageLogs(from, now);
  } catch (e) {
    fetchError = String(e);
  }

  const budgetJpy = process.env.OPENAI_MONTHLY_BUDGET_JPY
    ? Number(process.env.OPENAI_MONTHLY_BUDGET_JPY)
    : null;
  const exchangeRate = process.env.USD_JPY_MANUAL_RATE
    ? Number(process.env.USD_JPY_MANUAL_RATE)
    : 150;

  const totalCostUsd = logs.reduce((s, e) => s + e.estimatedCostUsd, 0);
  const inputTokens = logs.reduce((s, e) => s + e.inputTokens, 0);
  const outputTokens = logs.reduce((s, e) => s + e.outputTokens, 0);
  const successCount = logs.filter((e) => e.success).length;

  const dayOfMonth = now.getDate();
  const totalDays = daysInMonth(now);
  const projectedCostUsd = dayOfMonth > 0 && logs.length > 0
    ? totalCostUsd * (totalDays / dayOfMonth)
    : null;

  const budgetUsd = budgetJpy != null ? budgetJpy / exchangeRate : null;
  const budgetPct = budgetUsd != null && budgetUsd > 0
    ? Math.round((totalCostUsd / budgetUsd) * 100)
    : null;

  const featureMap = new Map<string, { costUsd: number; requests: number }>();
  for (const e of logs) {
    const s = featureMap.get(e.feature) ?? { costUsd: 0, requests: 0 };
    s.costUsd += e.estimatedCostUsd;
    s.requests++;
    featureMap.set(e.feature, s);
  }
  const byFeature = [...featureMap.entries()]
    .map(([feature, s]) => ({
      feature,
      label: FEATURE_LABELS[feature] ?? feature,
      costUsd: s.costUsd,
      requests: s.requests,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const modelMap = new Map<string, { costUsd: number; requests: number }>();
  for (const e of logs) {
    const s = modelMap.get(e.model) ?? { costUsd: 0, requests: 0 };
    s.costUsd += e.estimatedCostUsd;
    s.requests++;
    modelMap.set(e.model, s);
  }
  const byModel = [...modelMap.entries()]
    .map(([model, s]) => ({ model, ...s }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const metrics: ServiceMetric[] = [
    {
      label: '今月のAPI費用',
      value: totalCostUsd,
      unit: 'USD',
      limit: budgetUsd,
      remaining: budgetUsd != null ? budgetUsd - totalCostUsd : null,
      usagePercent: budgetPct,
      source: 'internal',
      isEstimated: false,
      note: 'openai_usage_logs テーブルの推定値。公式金額は OpenAI ダッシュボード参照',
    },
    {
      label: '今月の入力トークン',
      value: inputTokens,
      unit: 'tokens',
      limit: null,
      remaining: null,
      usagePercent: null,
      source: 'internal',
      isEstimated: false,
    },
    {
      label: '今月の出力トークン',
      value: outputTokens,
      unit: 'tokens',
      limit: null,
      remaining: null,
      usagePercent: null,
      source: 'internal',
      isEstimated: false,
    },
    {
      label: '今月のリクエスト数',
      value: logs.length,
      unit: '件',
      limit: null,
      remaining: null,
      usagePercent: null,
      source: 'internal',
      isEstimated: false,
    },
  ];

  let status: ServiceUsage['status'] = 'ok';
  if (fetchError) status = 'fetch_error';
  else if (budgetPct != null && budgetPct >= 90) status = 'critical';
  else if (budgetPct != null && budgetPct >= 80) status = 'warning';
  else if (budgetPct != null && budgetPct >= 70) status = 'alert';

  return {
    serviceId: 'openai',
    displayName: 'OpenAI API',
    purpose: '商品AI判定・作品AI判定・作品AI補完・VOD AI調査',
    plan: null,
    planSource: 'unavailable',
    status,
    metrics,
    currentMonthlyCostUsd: totalCostUsd,
    projectedMonthlyCostUsd: projectedCostUsd,
    costSource: 'internal',
    dashboardUrl: 'https://platform.openai.com/usage',
    fetchedAt,
    fetchError,
    details: {
      requestCount: logs.length,
      successCount,
      successRate: logs.length > 0 ? Math.round((successCount / logs.length) * 100) : null,
      inputTokens,
      outputTokens,
      byFeature,
      byModel,
      budgetJpy,
      budgetUsd,
      exchangeRate,
      projectedCostUsd,
      note: 'コストは推定値（openai-pricing.ts の料金表ベース）。公式請求額と差異が生じる場合あり',
    },
  };
}
