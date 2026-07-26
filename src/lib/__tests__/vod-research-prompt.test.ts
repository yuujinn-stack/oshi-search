import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  buildVodResearchCsvRow,
  buildBatchVodResearchPrompt,
  VOD_RESEARCH_CSV_HEADER,
} from '../vod-research-prompt';

describe('csvEscape', () => {
  it('カンマ・改行・ダブルクオートを含む値をクオートする', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });
  it('通常の文字列はそのまま返す', () => {
    expect(csvEscape('タイトル')).toBe('タイトル');
  });
});

describe('VOD_RESEARCH_CSV_HEADER', () => {
  it('work-check・vod-recheck共通の列順を保持する', () => {
    expect(VOD_RESEARCH_CSV_HEADER).toBe('workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices');
  });
});

describe('buildVodResearchCsvRow', () => {
  it('7列をカンマ区切りで組み立てる', () => {
    const row = buildVodResearchCsvRow({
      workId: 'work-1',
      personName: '人物A',
      title: 'タイトル',
      workType: 'movie',
      releaseYear: 2020,
      roleName: '主演',
      currentVodServices: 'Netflix, Hulu',
    });
    expect(row).toBe('work-1,人物A,タイトル,movie,2020,主演,"Netflix, Hulu"');
  });

  it('releaseYear/roleNameがnullでも崩れない', () => {
    const row = buildVodResearchCsvRow({
      workId: 'work-1', personName: '人物A', title: 'タイトル', workType: 'tv',
      releaseYear: null, roleName: null, currentVodServices: '',
    });
    expect(row).toBe('work-1,人物A,タイトル,tv,,,');
  });

  it('日本語記号（『』・句読点等）を変更しない', () => {
    const row = buildVodResearchCsvRow({
      workId: 'ai-movie-映画『僕たちの嘘と真実』', personName: '人物A', title: '映画『僕たちの嘘と真実』',
      workType: 'movie', releaseYear: 2021, roleName: '', currentVodServices: 'U-NEXT',
    });
    expect(row).toContain('映画『僕たちの嘘と真実』');
  });
});

describe('buildBatchVodResearchPrompt', () => {
  const csv = `${VOD_RESEARCH_CSV_HEADER}\nwork-1,人物A,タイトル,movie,2020,,Netflix`;
  const prompt = buildBatchVodResearchPrompt(csv, 'vod-recheck');

  it('調査条件・対象サービス一覧・availabilityType一覧・出力形式を含む', () => {
    expect(prompt).toContain('条件');
    expect(prompt).toContain('推測禁止');
    expect(prompt).toContain('調査対象サービス');
    expect(prompt).toContain('Hulu / U-NEXT / Lemino / Netflix / Prime Video');
    expect(prompt).toContain('availabilityType は以下を使用');
    expect(prompt).toContain('flatrate（見放題）');
    expect(prompt).toContain('出力形式');
    expect(prompt).toContain('workId,vodService,availabilityType,confidence,sourceUrl,note');
  });

  it('「作品CSVここから/ここまで」の区切りでCSV全文を挟む（省略・切り捨てなし）', () => {
    expect(prompt).toContain('---作品CSVここから---');
    expect(prompt).toContain('---作品CSVここまで---');
    expect(prompt).toContain(csv);
    const fromIdx = prompt.indexOf('---作品CSVここから---');
    const toIdx = prompt.indexOf('---作品CSVここまで---');
    const embedded = prompt.slice(fromIdx + '---作品CSVここから---'.length, toIdx).trim();
    expect(embedded).toBe(csv);
  });

  it('csvDownloadSectionのファイル名にfilenameLabelを反映する', () => {
    expect(prompt).toContain('vod-recheck_VOD配信情報.csv');
  });
});
