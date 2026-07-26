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

// ── CSV種別自動判定（調査対象CSV / 調査結果CSV / 判定不能） ────────────────────
//
// 判定ルール:
//   - workId列が無い → unknown（判定不能）
//   - vodService列が無い → investigation_target（調査対象CSV。列自体が無い＝手入力していない）
//   - vodService列はあるが、全データ行で空欄 → investigation_target
//     （/api/admin/vod-recheck/csv-export が出力する未編集CSVはこのケースに該当する）
//   - vodService列があり、1行でも値が入っている → investigation_result（調査結果CSV）
//   - データ行が1行もない → unknown（判定に必要な情報がない）
export type VodRecheckCsvType = 'investigation_target' | 'investigation_result' | 'unknown';

export function detectVodRecheckCsvType(csv: string): VodRecheckCsvType {
  const table = parseCSV(csv);
  if (table.length < 1) return 'unknown';

  const header = table[0].map((h) => h.trim());
  if (!header.includes('workId')) return 'unknown';

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return 'unknown';

  const vodServiceIdx = header.indexOf('vodService');
  if (vodServiceIdx === -1) return 'investigation_target';

  const hasAnyVodService = dataRows.some((row) => (row[vodServiceIdx] ?? '').trim() !== '');
  return hasAnyVodService ? 'investigation_result' : 'investigation_target';
}

// ── 調査対象CSVからworkId列だけを抽出する ──────────────────────────────────────
// 調査対象CSVは vodService/availabilityType/confidence/sourceUrl/note が空欄（または列自体が無い）
// ため、既存の parseAndValidateImportCsv（vodService必須）は使えない。workIdのみ必須とする。
export type ParseTargetCsvResult =
  | { ok: true; workIds: string[] }
  | { ok: false; error: string };

export function parseInvestigationTargetCsv(csv: string): ParseTargetCsvResult {
  const table = parseCSV(csv);
  if (table.length < 2) {
    return { ok: false, error: 'CSVにヘッダー行とデータ行が必要です' };
  }

  const header = table[0].map((h) => h.trim());
  const workIdIdx = header.indexOf('workId');
  if (workIdIdx === -1) {
    return { ok: false, error: '必須列 workId がヘッダーに見つかりません' };
  }

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    return { ok: false, error: `一度にインポートできるのは最大 ${MAX_CSV_ROWS} 行です（${dataRows.length}行が指定されました）` };
  }

  const workIds = dataRows
    .map((row) => (row[workIdIdx] ?? '').trim())
    .filter((id) => id !== '');

  if (workIds.length === 0) {
    return { ok: false, error: 'workId列に有効な値がありません' };
  }

  return { ok: true, workIds: [...new Set(workIds)] };
}
