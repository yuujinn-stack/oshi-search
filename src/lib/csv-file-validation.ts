// CSVファイル選択の事前チェック（純粋関数・DOM非依存）。
// File オブジェクトそのものではなく { name, size } のみを受け取ることで、
// ブラウザ環境なしでもテストできるようにする。
import { MAX_CSV_FILE_BYTES } from '@/lib/csv-parse';

export interface CsvFileLike {
  name: string;
  size: number;
}

export type CsvFileValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateCsvFile(file: CsvFileLike): CsvFileValidation {
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, error: `CSVファイル（.csv）を選択してください: ${file.name}` };
  }
  if (file.size === 0) {
    return { ok: false, error: '空のファイルです。内容のあるCSVファイルを選択してください。' };
  }
  if (file.size > MAX_CSV_FILE_BYTES) {
    const maxMb = (MAX_CSV_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return { ok: false, error: `ファイルサイズが大きすぎます（上限${maxMb}MB）。` };
  }
  return { ok: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
