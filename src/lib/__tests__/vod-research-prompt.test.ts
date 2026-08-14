import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  buildVodResearchCsvRow,
  buildBatchVodResearchPrompt,
  buildChatgptFullSyncPrompt,
  buildChatgptFullSyncCsvRow,
  VOD_RESEARCH_CSV_HEADER,
  CHATGPT_FULL_SYNC_CSV_HEADER,
  CHATGPT_FULL_SYNC_TARGET_SERVICES,
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

describe('buildChatgptFullSyncPrompt（ChatGPT完全調査 → 完全同期用の新規プロンプト）', () => {
  const csv = `${VOD_RESEARCH_CSV_HEADER}\nwork-1,人物A,タイトル,movie,2020,,Netflix`;
  const prompt = buildChatgptFullSyncPrompt(csv, 'vod-recheck');

  it('対象14サービス（のぎ動画を含む）を明記する', () => {
    expect(CHATGPT_FULL_SYNC_TARGET_SERVICES.split(' / ').length).toBe(14);
    expect(prompt).toContain('のぎ動画');
    expect(prompt).toContain(CHATGPT_FULL_SYNC_TARGET_SERVICES);
  });

  it('完全同期の前提（CSVにないサービスは削除扱い）を明記する', () => {
    expect(prompt).toContain('完全な最新状態');
    expect(prompt).toContain('置き換え');
  });

  it('workIdを唯一の基準とし、タイトル再照合を禁止する旨を明記する', () => {
    expect(prompt).toContain('workId は必ず保持');
    expect(prompt).toContain('タイトルではなくworkIdを唯一の基準');
  });

  it('0件確認済みの出力方法を明記する（未調査と区別できるように）', () => {
    expect(prompt).toContain('vodService=unknown, availabilityType=unknown, confidence=high');
    expect(prompt).toContain('14サービスを確認したが現在配信を確認できず');
  });

  it('同名別作品で特定できない場合の出力方法を明記する（低confidence + 固定フレーズ）', () => {
    expect(prompt).toContain('vodService=unknown, availabilityType=unknown, confidence=low');
    expect(prompt).toContain('同名作品があり対象作品を確実に特定できず');
  });

  it('CSV全文を省略なく埋め込む', () => {
    const fromIdx = prompt.indexOf('---作品CSVここから---');
    const toIdx = prompt.indexOf('---作品CSVここまで---');
    const embedded = prompt.slice(fromIdx + '---作品CSVここから---'.length, toIdx).trim();
    expect(embedded).toBe(csv);
  });

  it('既存のbuildBatchVodResearchPrompt（work-check等で共有）は変更されていない', () => {
    const oldPrompt = buildBatchVodResearchPrompt(csv, 'vod-recheck');
    expect(oldPrompt).not.toContain('のぎ動画');
    expect(oldPrompt).not.toContain('同名作品があり対象作品を確実に特定できず');
  });

  it('groupNameを補助情報として使う旨・グループ一致だけで確定しない旨を明記する', () => {
    expect(prompt).toContain('groupName');
    expect(prompt).toContain('対象人物の絞り込みにのみ使用');
  });
});

describe('CHATGPT_FULL_SYNC_CSV_HEADER / buildChatgptFullSyncCsvRow', () => {
  it('既存のVOD_RESEARCH_CSV_HEADERにgroupName列を追加した独自ヘッダーを持つ（既存ヘッダーは変更しない）', () => {
    expect(CHATGPT_FULL_SYNC_CSV_HEADER).toBe('workId,personName,groupName,workTitle,workType,releaseYear,roleName,currentVodServices');
    expect(VOD_RESEARCH_CSV_HEADER).toBe('workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices');
  });

  it('groupNameを含む8列を組み立てる', () => {
    const row = buildChatgptFullSyncCsvRow({
      workId: 'work-1', personName: '人物A', groupName: '乃木坂46', title: 'タイトル',
      workType: 'tv', releaseYear: 2023, roleName: null, currentVodServices: 'Lemino',
    });
    expect(row).toBe('work-1,人物A,乃木坂46,タイトル,tv,2023,,Lemino');
  });

  it('groupNameが空文字でも崩れない', () => {
    const row = buildChatgptFullSyncCsvRow({
      workId: 'work-1', personName: '人物A', groupName: '', title: 'タイトル',
      workType: 'tv', releaseYear: null, roleName: null, currentVodServices: '',
    });
    expect(row).toBe('work-1,人物A,,タイトル,tv,,,');
  });
});
