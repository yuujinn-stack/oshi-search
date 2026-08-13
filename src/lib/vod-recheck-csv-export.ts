// /api/admin/vod-recheck/csv-export のCSV組み立て（純粋関数）。
// 出力ヘッダーは workId,personName,workTitle,workType,releaseYear,roleName,
// currentVodServices,lastCheckedAt,recheckReason,priority,
// vodService,availabilityType,confidence,sourceUrl,note の順。
// 末尾5列（vodService/availabilityType/confidence/sourceUrl/note）は取り込み用の
// 入力欄として最初から空欄で出力する。これにより利用者はダウンロードしたCSVを
// そのままNumbers/Excelで開き、空欄を埋めて再度アップロードできる
// （/api/admin/vod-recheck/csv-import の必須列 workId, vodService と同じ列名・順序）。
//
// D-1: daysSinceChecked・staleStatus は既存の取り込み用5列（vodService〜note）の
// さらに後ろに追加した参照用の列。/api/admin/vod-recheck/csv-import は列名で
// workId/vodService等だけを参照するため、末尾に列を追加しても取り込み処理には
// 影響しない（既存5列の列名・順序はそのまま維持している）。
export const VOD_RECHECK_EXPORT_HEADERS = [
  'workId', 'personName', 'workTitle', 'workType', 'releaseYear', 'roleName',
  'currentVodServices', 'lastCheckedAt', 'recheckReason', 'priority',
  'vodService', 'availabilityType', 'confidence', 'sourceUrl', 'note',
  'daysSinceChecked', 'staleStatus',
];

export interface VodRecheckExportRowInput {
  workId: string;
  personName: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  roleName: string | null;
  currentVodServices: string;
  lastCheckedAt: string;
  recheckReason: string;
  priority: string;
  daysSinceChecked?: string;
  staleStatus?: string;
}

function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildVodRecheckExportRow(input: VodRecheckExportRowInput): string {
  return [
    input.workId,
    input.personName,
    input.title,
    input.workType,
    input.releaseYear != null ? String(input.releaseYear) : '',
    input.roleName ?? '',
    input.currentVodServices,
    input.lastCheckedAt,
    input.recheckReason,
    input.priority,
    '', '', '', '', '', // vodService, availabilityType, confidence, sourceUrl, note（取り込み用・空欄）
    input.daysSinceChecked ?? '',
    input.staleStatus ?? '',
  ].map(csvEscape).join(',');
}

export function buildVodRecheckExportCsv(rows: VodRecheckExportRowInput[]): string {
  return '﻿' + [VOD_RECHECK_EXPORT_HEADERS.join(','), ...rows.map(buildVodRecheckExportRow)].join('\n');
}
