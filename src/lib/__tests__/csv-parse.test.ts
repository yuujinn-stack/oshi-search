import { describe, it, expect } from 'vitest';
import { parseCSV } from '../csv-parse';

describe('parseCSV', () => {
  it('2. UTF-8 BOM付きCSVを読み込める', () => {
    const csv = '﻿workId,vodService\nwork-1,Netflix';
    const rows = parseCSV(csv);
    expect(rows).toEqual([['workId', 'vodService'], ['work-1', 'Netflix']]);
  });

  it('3. 日本語記号（コーナーブラケット等）を含むworkIdが変化しない', () => {
    const workId = 'ai-movie-映画『僕たちの嘘と真実』';
    const csv = `workId,vodService\n${workId},U-NEXT`;
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe(workId);
    // コードポイントが完全一致すること（正規化・変換が起きていないこと）
    expect([...rows[1][0]].map((c) => c.codePointAt(0))).toEqual([...workId].map((c) => c.codePointAt(0)));
  });

  it('4. CRLFのCSVを読み込める', () => {
    const csv = 'workId,vodService\r\nwork-1,Netflix\r\nwork-2,Hulu';
    const rows = parseCSV(csv);
    expect(rows).toEqual([['workId', 'vodService'], ['work-1', 'Netflix'], ['work-2', 'Hulu']]);
  });

  it('5. ダブルクォートとカンマを含む値を解析できる', () => {
    const csv = 'workId,vodService,note\nwork-1,Netflix,"見放題, お得なプラン"\nwork-2,Hulu,"""special"" note"';
    const rows = parseCSV(csv);
    expect(rows[1]).toEqual(['work-1', 'Netflix', '見放題, お得なプラン']);
    expect(rows[2]).toEqual(['work-2', 'Hulu', '"special" note']);
  });

  it('補助列を含む調査対象CSV形式のヘッダーも解析できる（列順は無関係）', () => {
    const csv = [
      'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices,lastCheckedAt,recheckReason,priority,vodService,availabilityType',
      'work-1,森田ひかる,映画,movie,2021,,U-NEXT,,確認日なし,高,Netflix,flatrate',
    ].join('\n');
    const rows = parseCSV(csv);
    expect(rows[0]).toContain('vodService');
    expect(rows[0]).toContain('workId');
    expect(rows[1][rows[0].indexOf('vodService')]).toBe('Netflix');
  });

  it('空行は無視される', () => {
    const csv = 'workId,vodService\nwork-1,Netflix\n\n\nwork-2,Hulu';
    const rows = parseCSV(csv);
    expect(rows).toEqual([['workId', 'vodService'], ['work-1', 'Netflix'], ['work-2', 'Hulu']]);
  });
});
