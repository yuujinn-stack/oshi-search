import { describe, it, expect } from 'vitest';
import { validateCsvFile, formatFileSize } from '../csv-file-validation';
import { MAX_CSV_FILE_BYTES } from '../csv-parse';

describe('validateCsvFile', () => {
  it('10. CSV以外のファイルを拒否する', () => {
    const result = validateCsvFile({ name: 'data.xlsx', size: 100 });
    expect(result.ok).toBe(false);
  });

  it('拡張子.txtも拒否する', () => {
    const result = validateCsvFile({ name: 'notes.txt', size: 100 });
    expect(result.ok).toBe(false);
  });

  it('11. 空ファイルを拒否する', () => {
    const result = validateCsvFile({ name: 'empty.csv', size: 0 });
    expect(result.ok).toBe(false);
  });

  it('12. ファイルサイズ上限を超えた場合に拒否する', () => {
    const result = validateCsvFile({ name: 'huge.csv', size: MAX_CSV_FILE_BYTES + 1 });
    expect(result.ok).toBe(false);
  });

  it('正常なCSVファイルは受理する', () => {
    const result = validateCsvFile({ name: 'vod-recheck.csv', size: 1234 });
    expect(result.ok).toBe(true);
  });

  it('拡張子は大文字小文字を区別しない', () => {
    const result = validateCsvFile({ name: 'DATA.CSV', size: 1234 });
    expect(result.ok).toBe(true);
  });

  it('上限ちょうどのサイズは許可する', () => {
    const result = validateCsvFile({ name: 'ok.csv', size: MAX_CSV_FILE_BYTES });
    expect(result.ok).toBe(true);
  });
});

describe('formatFileSize', () => {
  it('バイト・KB・MB単位を適切にフォーマットする', () => {
    expect(formatFileSize(500)).toBe('500B');
    expect(formatFileSize(2048)).toBe('2.0KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.00MB');
  });
});
