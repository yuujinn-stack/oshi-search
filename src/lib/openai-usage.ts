import { db } from '@/db/client';
import { openaiUsageLogs } from '@/db/schema';
import { and, gte, lte } from 'drizzle-orm';
import { calcCostUsd } from '@/lib/openai-pricing';

export interface UsageLogEntry {
  ts: number;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs?: number;
  personName?: string;
  success: boolean;
  errorMessage?: string;
}

export async function logOpenAIUsage(params: {
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  personName?: string;
  success?: boolean;
  errorMessage?: string;
}): Promise<void> {
  const estimatedCostUsd = calcCostUsd(params.model, params.inputTokens, params.outputTokens);
  try {
    await db.insert(openaiUsageLogs).values({
      loggedAt:         new Date(),
      feature:          params.feature,
      model:            params.model,
      inputTokens:      params.inputTokens,
      outputTokens:     params.outputTokens,
      estimatedCostUsd: String(estimatedCostUsd),
      durationMs:       params.durationMs ?? null,
      personName:       params.personName ?? null,
      success:          params.success ?? true,
      errorMessage:     params.errorMessage ?? null,
    });
  } catch { /* logging failures must never break callers */ }
}

export async function getUsageLogs(from: Date, to: Date): Promise<UsageLogEntry[]> {
  const fromTs = new Date(from);
  fromTs.setHours(0, 0, 0, 0);
  const toTs = new Date(to);
  toTs.setHours(23, 59, 59, 999);

  try {
    const rows = await db.select()
      .from(openaiUsageLogs)
      .where(and(
        gte(openaiUsageLogs.loggedAt, fromTs),
        lte(openaiUsageLogs.loggedAt, toTs),
      ))
      .orderBy(openaiUsageLogs.loggedAt);

    return rows
      .map((r) => ({
        ts:               r.loggedAt.getTime(),
        feature:          r.feature,
        model:            r.model,
        inputTokens:      r.inputTokens,
        outputTokens:     r.outputTokens,
        estimatedCostUsd: Number(r.estimatedCostUsd ?? 0),
        durationMs:       r.durationMs ?? undefined,
        personName:       r.personName ?? undefined,
        success:          r.success,
        errorMessage:     r.errorMessage ?? undefined,
      }))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}
