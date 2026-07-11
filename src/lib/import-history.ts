import { db } from '@/db/client';
import { importHistory as importHistoryTable } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

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

export async function saveImportHistory(
  data: Omit<ImportHistory, 'historyId'>,
): Promise<string> {
  const historyId = makeHistoryId();
  try {
    await db.insert(importHistoryTable).values({
      historyId,
      importType:   data.importType,
      executedAt:   new Date(data.executedAt),
      fileName:     data.fileName ?? null,
      totalRows:    data.totalRows,
      successCount: data.successCount,
      skipCount:    data.skipCount,
      errorCount:   data.errorCount,
      durationMs:   data.durationMs,
      status:       data.status,
      rows:         data.rows,
      csvContent:   data.csvContent ?? null,
    });
  } catch (err) {
    console.error('[db] saveImportHistory failed:', String(err));
  }
  return historyId;
}

export async function getImportHistoryList(limit = 100): Promise<ImportHistorySummary[]> {
  try {
    const rows = await db.select({
      historyId:    importHistoryTable.historyId,
      importType:   importHistoryTable.importType,
      executedAt:   importHistoryTable.executedAt,
      fileName:     importHistoryTable.fileName,
      totalRows:    importHistoryTable.totalRows,
      successCount: importHistoryTable.successCount,
      skipCount:    importHistoryTable.skipCount,
      errorCount:   importHistoryTable.errorCount,
      durationMs:   importHistoryTable.durationMs,
      status:       importHistoryTable.status,
    })
      .from(importHistoryTable)
      .orderBy(desc(importHistoryTable.executedAt))
      .limit(limit);

    return rows.map((r) => ({
      historyId:    r.historyId,
      importType:   r.importType as ImportType,
      executedAt:   r.executedAt.getTime(),
      fileName:     r.fileName ?? undefined,
      totalRows:    r.totalRows,
      successCount: r.successCount,
      skipCount:    r.skipCount,
      errorCount:   r.errorCount,
      durationMs:   r.durationMs,
      status:       r.status as ImportStatus,
    }));
  } catch {
    return [];
  }
}

export async function getImportHistoryDetail(historyId: string): Promise<ImportHistory | null> {
  try {
    const rows = await db.select()
      .from(importHistoryTable)
      .where(eq(importHistoryTable.historyId, historyId));
    if (!rows.length) return null;
    const r = rows[0];
    return {
      historyId:    r.historyId,
      importType:   r.importType as ImportType,
      executedAt:   r.executedAt.getTime(),
      fileName:     r.fileName ?? undefined,
      totalRows:    r.totalRows,
      successCount: r.successCount,
      skipCount:    r.skipCount,
      errorCount:   r.errorCount,
      durationMs:   r.durationMs,
      status:       r.status as ImportStatus,
      rows:         (r.rows ?? []) as ImportRowResult[],
      csvContent:   r.csvContent ?? undefined,
    };
  } catch {
    return null;
  }
}
