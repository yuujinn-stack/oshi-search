import { describe, it, expect } from 'vitest';
import { parseAndValidateImportCsv, detectVodRecheckCsvType } from '../vod-recheck-csv';
import { MAX_CSV_ROWS } from '../csv-parse';
import { buildVodRecheckExportCsv } from '../vod-recheck-csv-export';

describe('detectVodRecheckCsvType', () => {
  it('1. 調査対象CSVを自動判定できる（vodService列が存在しない）', () => {
    const csv = 'workId,personName,workTitle\nwork-1,森田ひかる,テスト作品';
    expect(detectVodRecheckCsvType(csv)).toBe('investigation_target');
  });

  it('1. 調査対象CSVを自動判定できる（vodService列はあるが全行空欄＝csv-export出力そのまま）', () => {
    const csv = buildVodRecheckExportCsv([{
      workId: 'work-1', personName: '森田ひかる', title: 'テスト作品', workType: 'movie',
      releaseYear: 2021, roleName: null, currentVodServices: 'U-NEXT', lastCheckedAt: '',
      recheckReason: '確認日なし', priority: '高',
    }]);
    expect(detectVodRecheckCsvType(csv)).toBe('investigation_target');
  });

  it('2. 調査結果CSVを自動判定できる（vodServiceに値がある行が1件でもある）', () => {
    const csv = 'workId,vodService\nwork-1,Netflix';
    expect(detectVodRecheckCsvType(csv)).toBe('investigation_result');
  });

  it('2. 一部の行だけvodServiceが埋まっていても調査結果CSVと判定する', () => {
    const csv = 'workId,vodService\nwork-1,\nwork-2,Hulu';
    expect(detectVodRecheckCsvType(csv)).toBe('investigation_result');
  });

  it('3. 判定不能CSVを拒否する（workId列がない）', () => {
    const csv = 'foo,bar\n1,2';
    expect(detectVodRecheckCsvType(csv)).toBe('unknown');
  });

  it('3. 判定不能CSVを拒否する（データ行が1行もない）', () => {
    const csv = 'workId,vodService';
    expect(detectVodRecheckCsvType(csv)).toBe('unknown');
  });

  it('3. 判定不能CSVを拒否する（空文字列）', () => {
    expect(detectVodRecheckCsvType('')).toBe('unknown');
  });
});

describe('parseAndValidateImportCsv', () => {
  it('7. workIdとvodServiceだけのCSVも受理できる', () => {
    const result = parseAndValidateImportCsv('workId,vodService\nwork-1,Netflix');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([{ workId: 'work-1', vodService: 'Netflix', availabilityType: 'unknown' }]);
    }
  });

  it('必須列がなければエラー', () => {
    const result = parseAndValidateImportCsv('foo,bar\n1,2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('workId');
  });

  it('workId・vodServiceが空の行はエラー', () => {
    const result = parseAndValidateImportCsv('workId,vodService\n,Netflix');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.[0]).toContain('必須');
  });

  it('不正なavailabilityTypeはエラー', () => {
    const result = parseAndValidateImportCsv('workId,vodService,availabilityType\nwork-1,Netflix,bogus');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.[0]).toContain('availabilityType');
  });

  it('availabilityType未指定時はunknownとして扱う', () => {
    const result = parseAndValidateImportCsv('workId,vodService\nwork-1,Netflix');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0].availabilityType).toBe('unknown');
  });

  it('日本語のavailabilityType表記（見放題等）も受理する', () => {
    const result = parseAndValidateImportCsv('workId,vodService,availabilityType\nwork-1,Netflix,見放題');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0].availabilityType).toBe('flatrate');
  });

  it('同じworkIdとvodServiceが重複する行を検出する（正規化名で判定・大文字小文字表記ゆれ）', () => {
    const result = parseAndValidateImportCsv('workId,vodService\nwork-1,Netflix\nwork-1,netflix');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.[0]).toContain('重複');
  });

  it('9. 同一作品の複数サービス行（別サービス名）は受理できる', () => {
    const result = parseAndValidateImportCsv('workId,vodService\nwork-1,Netflix\nwork-1,Hulu');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('同一workIdで同じサービスでも異なるworkIdなら重複扱いしない', () => {
    const result = parseAndValidateImportCsv('workId,vodService\nwork-1,Netflix\nwork-2,Netflix');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it('6. 補助列を含む調査対象CSV（csv-export形式）を受理できる', () => {
    const csv = [
      'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices,lastCheckedAt,recheckReason,priority,vodService,availabilityType',
      'work-1,森田ひかる,映画,movie,2021,,U-NEXT,,確認日なし,高,Netflix,flatrate',
    ].join('\n');
    const result = parseAndValidateImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].workId).toBe('work-1');
      expect(result.rows[0].vodService).toBe('Netflix');
      expect(result.rows[0].availabilityType).toBe('flatrate');
    }
  });

  it('8. CSV出力ファイルを編集して再取り込みできる（元の出力列＋vodService/availabilityTypeを追加）', () => {
    // /api/admin/vod-recheck/csv-export の出力ヘッダーに vodService・availabilityType を
    // 追記して再取り込みする想定（例: Excelで手動編集した場合）
    const exportHeaders = 'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices,lastCheckedAt,recheckReason,priority';
    const csv = `${exportHeaders},vodService,availabilityType\nai-movie-テスト作品,森田ひかる,テスト作品,movie,2021,,U-NEXT,,確認日なし,高,Hulu,rent`;
    const result = parseAndValidateImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].workId).toBe('ai-movie-テスト作品');
      expect(result.rows[0].vodService).toBe('Hulu');
      expect(result.rows[0].availabilityType).toBe('rent');
    }
  });

  it('13. 行数上限を超えた場合に拒否する', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `work-${i},Netflix`).join('\n');
    const result = parseAndValidateImportCsv(`workId,vodService\n${rows}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_CSV_ROWS));
  });

  it('行数上限ちょうどは許可する', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS }, (_, i) => `work-${i},Netflix`).join('\n');
    const result = parseAndValidateImportCsv(`workId,vodService\n${rows}`);
    expect(result.ok).toBe(true);
  });

  it('3. 日本語記号を含むworkIdが変化しない', () => {
    const workId = 'ai-movie-映画『僕たちの嘘と真実』';
    const result = parseAndValidateImportCsv(`workId,vodService\n${workId},U-NEXT`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0].workId).toBe(workId);
  });
});
