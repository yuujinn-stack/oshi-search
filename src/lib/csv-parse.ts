// RFC4180準拠の簡易CSVパーサー（BOM・改行コード対応）。
// フレームワーク非依存の純粋関数のため、サーバー（/api/admin/vod-recheck/csv-import）と
// クライアント（VodRecheckClient.tsx のファイル選択・行数表示）の両方から同じ実装を使う。
// これにより「ファイル選択」と「貼り付け」で解析結果が食い違うことを防ぐ。

// サーバー側 MAX_ROWS と同じ値をクライアント側の事前チェックにも使う（表示・検証を一致させる）
export const MAX_CSV_ROWS = 200;
// ファイルサイズ上限（200行×十分に余裕のある列幅を想定した目安）。クライアント・サーバー共通。
export const MAX_CSV_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export function parseCSV(content: string): string[][] {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
