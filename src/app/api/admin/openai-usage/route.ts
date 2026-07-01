import { NextResponse } from 'next/server';
import { getUsageLogs } from '@/lib/openai-usage';
import { FEATURE_LABELS, USD_TO_JPY, getModelPricing } from '@/lib/openai-pricing';

export const dynamic = 'force-dynamic';

export interface DayStat {
  date: string;
  count: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface FeatureStat {
  feature: string;
  label: string;
  count: number;
  successCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelStat {
  model: string;
  label: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function parsePeriod(p: URLSearchParams): { from: Date; to: Date } {
  const period = p.get('period') ?? 'month';
  const now = new Date();
  switch (period) {
    case 'today': {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      return { from, to: now };
    }
    case 'week': {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from, to: now };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from, to };
    }
    case 'custom': {
      const fromStr = p.get('from');
      const toStr = p.get('to');
      const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const to = toStr ? new Date(toStr + 'T23:59:59.999') : now;
      return { from, to };
    }
    default: // month
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { from, to } = parsePeriod(searchParams);
  const featureFilter = searchParams.get('feature') ?? '';
  const modelFilter = searchParams.get('model') ?? '';
  const personFilter = searchParams.get('person') ?? '';
  const format = searchParams.get('format') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = 100;

  let logs = await getUsageLogs(from, to);

  if (featureFilter) logs = logs.filter((e) => e.feature === featureFilter);
  if (modelFilter) logs = logs.filter((e) => e.model === modelFilter);
  if (personFilter) logs = logs.filter((e) => e.personName?.includes(personFilter));

  if (format === 'csv') {
    const rows: string[][] = [
      ['日時', '機能', 'モデル', '入力トークン', '出力トークン', `コスト(USD)`, `コスト(JPY/≒${USD_TO_JPY})`, '処理時間(ms)', '人物名', '成功', 'エラー'],
      ...logs.map((e) => [
        new Date(e.ts).toLocaleString('ja-JP'),
        FEATURE_LABELS[e.feature] ?? e.feature,
        e.model,
        String(e.inputTokens),
        String(e.outputTokens),
        e.estimatedCostUsd.toFixed(6),
        String(Math.round(e.estimatedCostUsd * USD_TO_JPY)),
        String(e.durationMs ?? ''),
        e.personName ?? '',
        e.success ? '成功' : '失敗',
        e.errorMessage ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    return new Response('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="openai-usage-${from.toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // Today's cost (always unfiltered)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayLogs = await getUsageLogs(todayStart, new Date());
  const todayCostUsd = todayLogs.reduce((s, e) => s + e.estimatedCostUsd, 0);

  // Aggregations
  const featureMap = new Map<string, FeatureStat>();
  for (const e of logs) {
    const s = featureMap.get(e.feature) ?? {
      feature: e.feature,
      label: FEATURE_LABELS[e.feature] ?? e.feature,
      count: 0, successCount: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
    };
    s.count++;
    if (e.success) s.successCount++;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.costUsd += e.estimatedCostUsd;
    featureMap.set(e.feature, s);
  }
  const byFeature = [...featureMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  const modelMap = new Map<string, ModelStat>();
  for (const e of logs) {
    const s = modelMap.get(e.model) ?? {
      model: e.model,
      label: getModelPricing(e.model).label,
      count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
    };
    s.count++;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.costUsd += e.estimatedCostUsd;
    modelMap.set(e.model, s);
  }
  const byModel = [...modelMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  const dayMap = new Map<string, DayStat>();
  for (const e of logs) {
    const date = new Date(e.ts).toISOString().slice(0, 10);
    const s = dayMap.get(date) ?? { date, count: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    s.count++;
    s.costUsd += e.estimatedCostUsd;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    dayMap.set(date, s);
  }
  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const totalCostUsd = logs.reduce((s, e) => s + e.estimatedCostUsd, 0);
  const totalInputTokens = logs.reduce((s, e) => s + e.inputTokens, 0);
  const totalOutputTokens = logs.reduce((s, e) => s + e.outputTokens, 0);

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      requestCount: logs.length,
      successCount: logs.filter((e) => e.success).length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalCostUsd,
      todayCostUsd,
      avgCostUsd: logs.length > 0 ? totalCostUsd / logs.length : 0,
    },
    byFeature,
    byModel,
    byDay,
    logs: logs.slice((page - 1) * pageSize, page * pageSize),
    totalLogs: logs.length,
    page,
    pageSize,
  });
}
