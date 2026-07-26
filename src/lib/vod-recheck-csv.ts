// VOD再確認CSV取り込みの行解析・検証（純粋関数・DBアクセスなし）。
// /api/admin/vod-recheck/csv-import から呼ばれる。ファイル選択・貼り付けのどちらから
// 来たCSV文字列も同じ関数を通るため、検証結果が食い違うことはない。
import { parseCSV, MAX_CSV_ROWS } from '@/lib/csv-parse';
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { VodProviderType } from '@/types/vod';

export const AVAILABILITY_TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate', subscription: 'flatrate', 見放題: 'flatrate',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  free: 'free', 無料: 'free',
  unknown: 'unknown',
};

export interface ParsedImportRow {
  workId: string;
  vodService: string;
  availabilityType: VodProviderType;
  sourceUrl?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
}

export type ParseImportCsvResult =
  | { ok: true; rows: ParsedImportRow[] }
  | { ok: false; error: string; details?: string[] };

export function parseAndValidateImportCsv(csv: string): ParseImportCsvResult {
  const table = parseCSV(csv);
  if (table.length < 2) {
    return { ok: false, error: 'CSVにヘッダー行とデータ行が必要です' };
  }

  const header = table[0].map((h) => h.trim());
  const workIdIdx = header.indexOf('workId');
  const vodServiceIdx = header.indexOf('vodService');
  if (workIdIdx === -1 || vodServiceIdx === -1) {
    return { ok: false, error: '必須列 workId, vodService がヘッダーに見つかりません' };
  }
  const availIdx = header.indexOf('availabilityType');
  const sourceUrlIdx = header.indexOf('sourceUrl');
  const confidenceIdx = header.indexOf('confidence');
  const noteIdx = header.indexOf('note');

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    return { ok: false, error: `一度にインポートできるのは最大 ${MAX_CSV_ROWS} 行です（${dataRows.length}行が指定されました）` };
  }

  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];
  const seenPairs = new Set<string>(); // workId::正規化済みvodService（重複行の検出用）

  dataRows.forEach((cols, i) => {
    const workId = (cols[workIdIdx] ?? '').trim();
    const vodService = (cols[vodServiceIdx] ?? '').trim();
    if (!workId || !vodService) {
      errors.push(`${i + 2}行目: workId と vodService は必須です`);
      return;
    }
    const availRaw = (availIdx >= 0 ? cols[availIdx] : '')?.trim().toLowerCase() ?? '';
    const availabilityType = availRaw ? AVAILABILITY_TYPE_MAP[availRaw] : 'unknown';
    if (availRaw && !availabilityType) {
      errors.push(`${i + 2}行目: availabilityType の値が不正です（${cols[availIdx]}）`);
      return;
    }
    const dedupKey = `${workId}::${normalizeProviderName(vodService)}`;
    if (seenPairs.has(dedupKey)) {
      errors.push(`${i + 2}行目: 同じworkIdとvodServiceが重複しています`);
      return;
    }
    seenPairs.add(dedupKey);

    const confidenceRaw = (confidenceIdx >= 0 ? cols[confidenceIdx] : '')?.trim().toLowerCase();
    const confidence = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low' ? confidenceRaw : undefined;
    rows.push({
      workId,
      vodService,
      availabilityType: availabilityType ?? 'unknown',
      sourceUrl: sourceUrlIdx >= 0 ? (cols[sourceUrlIdx] ?? '').trim() || undefined : undefined,
      confidence,
      note: noteIdx >= 0 ? (cols[noteIdx] ?? '').trim() || undefined : undefined,
    });
  });

  if (errors.length > 0) {
    return { ok: false, error: 'CSVの内容にエラーがあります', details: errors };
  }

  return { ok: true, rows };
}
