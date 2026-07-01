import { getRedis } from '@/lib/redis';
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

// Storage: openai:usage:YYYY-MM-DD — Redis list (LPUSH), TTL 90 days
const KEY_PREFIX = 'openai:usage:';
const TTL_SECONDS = 90 * 24 * 60 * 60;

function dayKey(date: Date): string {
  return `${KEY_PREFIX}${date.toISOString().slice(0, 10)}`;
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
  const redis = getRedis();
  if (!redis) return;

  const entry: UsageLogEntry = {
    ts: Date.now(),
    feature: params.feature,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    estimatedCostUsd: calcCostUsd(params.model, params.inputTokens, params.outputTokens),
    durationMs: params.durationMs,
    personName: params.personName,
    success: params.success ?? true,
    errorMessage: params.errorMessage,
  };

  const key = dayKey(new Date());
  try {
    await redis.lpush(key, JSON.stringify(entry));
    await redis.expire(key, TTL_SECONDS);
  } catch { /* logging failures must never break callers */ }
}

export async function getUsageLogs(from: Date, to: Date): Promise<UsageLogEntry[]> {
  const redis = getRedis();
  if (!redis) return [];

  const fromTs = new Date(from);
  fromTs.setHours(0, 0, 0, 0);
  const toTs = new Date(to);
  toTs.setHours(23, 59, 59, 999);

  const keys: string[] = [];
  const d = new Date(fromTs);
  while (d <= toTs) {
    keys.push(dayKey(d));
    d.setDate(d.getDate() + 1);
  }

  const entries: UsageLogEntry[] = [];
  for (const key of keys) {
    try {
      const items = await redis.lrange(key, 0, -1);
      for (const item of items) {
        try {
          const entry = (typeof item === 'string' ? JSON.parse(item) : item) as UsageLogEntry;
          if (entry.ts >= fromTs.getTime() && entry.ts <= toTs.getTime()) {
            entries.push(entry);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip missing keys */ }
  }

  return entries.sort((a, b) => b.ts - a.ts);
}
