import { describe, it, expect } from 'vitest';
import { buildVodRecheckExportCsv, buildVodRecheckExportRow, VOD_RECHECK_EXPORT_HEADERS } from '../vod-recheck-csv-export';
import { parseCSV } from '../csv-parse';
import { parseAndValidateImportCsv } from '../vod-recheck-csv';

function sampleRow(overrides: Partial<Parameters<typeof buildVodRecheckExportRow>[0]> = {}) {
  return {
    workId: 'work-1',
    personName: '森田ひかる',
    title: 'テスト作品',
    workType: 'movie',
    releaseYear: 2021,
    roleName: null,
    currentVodServices: 'U-NEXT',
    lastCheckedAt: '',
    recheckReason: '確認日なし',
    priority: '高',
    ...overrides,
  };
}

describe('1. CSV出力に入力用5列が含まれる', () => {
  it('ヘッダーが指定された順序で workId から note まで15列そろっている', () => {
    expect(VOD_RECHECK_EXPORT_HEADERS).toEqual([
      'workId', 'personName', 'workTitle', 'workType', 'releaseYear', 'roleName',
      'currentVodServices', 'lastCheckedAt', 'recheckReason', 'priority',
      'vodService', 'availabilityType', 'confidence', 'sourceUrl', 'note',
    ]);
  });
});

describe('2. 入力用5列が空欄で出力される', () => {
  it('vodService/availabilityType/confidence/sourceUrl/noteが空文字で出力される', () => {
    const csv = buildVodRecheckExportCsv([sampleRow()]);
    const table = parseCSV(csv);
    const header = table[0];
    const row = table[1];
    for (const col of ['vodService', 'availabilityType', 'confidence', 'sourceUrl', 'note']) {
      expect(row[header.indexOf(col)]).toBe('');
    }
  });
});

describe('4. 日本語やカンマを含むタイトルでもCSV列が崩れない', () => {
  it('カンマ・ダブルクォート・日本語を含むタイトルでも列数が維持される', () => {
    const csv = buildVodRecheckExportCsv([
      sampleRow({ title: '映画「テスト,作品」"特別編"', workId: 'ai-movie-映画『僕たちの嘘と真実』' }),
    ]);
    const table = parseCSV(csv);
    expect(table[1]).toHaveLength(VOD_RECHECK_EXPORT_HEADERS.length);
    expect(table[1][VOD_RECHECK_EXPORT_HEADERS.indexOf('workTitle')]).toBe('映画「テスト,作品」"特別編"');
    expect(table[1][VOD_RECHECK_EXPORT_HEADERS.indexOf('workId')]).toBe('ai-movie-映画『僕たちの嘘と真実』');
  });
});

describe('3. 出力したCSVへ結果を記入し、そのまま取り込みプレビューできる', () => {
  it('出力CSVの空欄を埋めた内容がparseAndValidateImportCsvでそのまま解析できる', () => {
    const exported = buildVodRecheckExportCsv([sampleRow({ workId: 'work-1' })]);
    const table = parseCSV(exported);
    const header = table[0];
    const row = [...table[1]];
    // Numbers/Excelで空欄を埋める操作を模擬
    row[header.indexOf('vodService')] = 'Netflix';
    row[header.indexOf('availabilityType')] = 'flatrate';
    row[header.indexOf('sourceUrl')] = 'https://example.com';

    const filledCsv = [header.join(','), row.join(',')].join('\n');
    const result = parseAndValidateImportCsv(filledCsv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([{
        workId: 'work-1',
        vodService: 'Netflix',
        availabilityType: 'flatrate',
        sourceUrl: 'https://example.com',
        confidence: undefined,
        note: undefined,
      }]);
    }
  });

  it('補助列（workTitle等）は取り込み時に無視される', () => {
    const exported = buildVodRecheckExportCsv([sampleRow({ workId: 'work-1', title: '調査対象タイトル' })]);
    const table = parseCSV(exported);
    const header = table[0];
    const row = [...table[1]];
    row[header.indexOf('vodService')] = 'Hulu';

    const filledCsv = [header.join(','), row.join(',')].join('\n');
    const result = parseAndValidateImportCsv(filledCsv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].workId).toBe('work-1');
      expect(result.rows[0].vodService).toBe('Hulu');
    }
  });
});

describe('5. 同じworkIdの行を複製して複数サービスを取り込める', () => {
  it('出力した1行を複製し、それぞれ別サービスを入力して取り込める', () => {
    const exported = buildVodRecheckExportCsv([sampleRow({ workId: 'work-1' })]);
    const table = parseCSV(exported);
    const header = table[0];
    const baseRow = table[1];

    const row1 = [...baseRow];
    row1[header.indexOf('vodService')] = 'Netflix';
    row1[header.indexOf('availabilityType')] = 'flatrate';

    const row2 = [...baseRow];
    row2[header.indexOf('vodService')] = 'Hulu';
    row2[header.indexOf('availabilityType')] = 'rent';

    const filledCsv = [header.join(','), row1.join(','), row2.join(',')].join('\n');
    const result = parseAndValidateImportCsv(filledCsv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(2);
      expect(result.rows.map((r) => r.vodService)).toEqual(['Netflix', 'Hulu']);
      expect(result.rows.every((r) => r.workId === 'work-1')).toBe(true);
    }
  });
});

describe('BOM・複数行の全体組み立て', () => {
  it('先頭にBOMが付与され、複数行が正しく連結される', () => {
    const csv = buildVodRecheckExportCsv([
      sampleRow({ workId: 'work-1' }),
      sampleRow({ workId: 'work-2', personName: '井上梨名' }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const table = parseCSV(csv);
    expect(table).toHaveLength(3); // header + 2 rows
  });
});
