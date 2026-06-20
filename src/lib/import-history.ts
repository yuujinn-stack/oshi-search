import { getRedis } from './redis';

const LIST_KEY = 'import:history';
const RECORD_PREFIX = 'import:history:';
const MAX_HISTORY = 200;
const TTL = 60 * 60 * 24 * 60; // 60日

export type ImportType = 'person_csv' | 'work_vod_csv' | 'vod_title_csv';
export type ImportStatus = 'completed' | 'partial_error' | 'failed';

export interface ImportRowResult {
  label: string;
  action: 'success' | 'skip' | 'error';
  reason?: string;
}

export interface ImportHistorySummary {
  historyId: string;
  importType: ImportType;
  executedAt: number;
  fileName?: string;
  totalRows: number;
  successCount: number;
  skipCount: number;
  errorCount: number;
  durationMs: number;
  status: ImportStatus;
}

export interface ImportHistory extends ImportHistorySummary {
  rows: ImportRowResult[];
  csvContent?: string;
}

function makeHistoryId(): string {
  return `ih_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseRecord(raw: unknown): ImportHistory | null {
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ImportHistory;
  } catch {
    return null;
  }
}

export async function saveImportHistory(
  data: Omit<ImportHistory, 'historyId'>,
): Promise<string> {
  const redis = getRedis();
  if (!redis) return '';

  const historyId = makeHistoryId();
  const record: ImportHistory = { historyId, ...data };

  await redis.set(`${RECORD_PREFIX}${historyId}`, JSON.stringify(record), { ex: TTL });
  await redis.lpush(LIST_KEY, historyId);
  await redis.ltrim(LIST_KEY, 0, MAX_HISTORY - 1);

  return historyId;
}

export async function getImportHistoryList(limit = 100): Promise<ImportHistorySummary[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids = await redis.lrange<string>(LIST_KEY, 0, limit - 1);
  if (!ids || ids.length === 0) return [];

  const records = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get(`${RECORD_PREFIX}${id}`);
      if (!raw) return null;
      const parsed = parseRecord(raw);
      if (!parsed) return null;
      // summary only — omit rows and csvContent
      const { rows: _rows, csvContent: _csv, ...summary } = parsed;
      return summary as ImportHistorySummary;
    }),
  );

  return records.filter((r): r is ImportHistorySummary => r !== null);
}

export async function getImportHistoryDetail(historyId: string): Promise<ImportHistory | null> {
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(`${RECORD_PREFIX}${historyId}`);
  if (!raw) return null;
  return parseRecord(raw);
}
