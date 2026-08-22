import { describe, it, expect } from 'vitest';
import {
  getDisplayWorkType,
  getDisplayWorkTypeTrace,
  normalizeDisplayWorkType,
  DISPLAY_WORK_TYPE_LABEL,
  DISPLAY_WORK_TYPE_ICON,
  DISPLAY_WORK_TYPE_ORDER,
} from '../work-display-type';
import type { WorkRecord, DisplayWorkType, WorkType } from '@/types/work';

function work(overrides: Partial<WorkRecord> & { type: WorkType }): WorkRecord {
  return {
    id: 'w-1',
    personName: '',
    title: '',
    normalizedTitle: '',
    source: 'tmdb',
    confidenceScore: 0,
    status: 'auto_published',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('getDisplayWorkType / getDisplayWorkTypeTrace — 優先順位', () => {
  it('workDisplayType が保存済みなら、タイトルに他カテゴリのキーワードが含まれていても最優先で返す', () => {
    const w = work({ type: 'tv', title: 'ライブ配信スペシャル', workDisplayType: 'documentary' });
    expect(getDisplayWorkType(w)).toBe('documentary');
    expect(getDisplayWorkTypeTrace(w)).toEqual({ result: 'documentary', rule: 'manual_override' });
  });

  it('ライブ・コンサートは舞台キーワード（THEATER等）より優先される', () => {
    const w = work({ type: 'tv', title: 'THEATER MILANO-Za LIVE 2024' });
    expect(getDisplayWorkType(w)).toBe('live');
  });

  it('ドキュメンタリーはタイトルまたはoverviewのどちらか一致すれば判定される', () => {
    const byTitle = work({ type: 'movie', title: '密着ドキュメント' });
    expect(getDisplayWorkTypeTrace(byTitle).rule).toBe('documentary');

    const byOverview = work({ type: 'movie', title: '無題', overview: '舞台裏に迫るドキュメンタリー' });
    expect(getDisplayWorkTypeTrace(byOverview).rule).toBe('documentary');
  });

  it('舞台キーワード「劇場」はライブキーワードに一致しない限り stage と判定される', () => {
    const w = work({ type: 'movie', title: '朗読劇 春の劇場' });
    expect(getDisplayWorkType(w)).toBe('stage');
  });

  it('回帰テスト（TYPE_MAPPING_BUG）: 「劇場版」を含むタイトルは stage ではなく movie と判定される', () => {
    // 修正前は STAGE_KEYWORDS の「劇場」が「劇場版」の部分文字列にも一致し、
    // stage(③) が movie(⑧) より先に確定してしまっていた。
    const w1 = work({ type: 'movie', title: '劇場版 名探偵ミステリー' });
    expect(getDisplayWorkType(w1)).toBe('movie');
    expect(getDisplayWorkTypeTrace(w1).rule).toBe('movie');

    const w2 = work({ type: 'anime', title: '○○ THE MOVIE 劇場版' });
    expect(getDisplayWorkType(w2)).toBe('movie');
  });

  it('「劇場版」を含んでいても、他の舞台キーワードが別に含まれていれば stage と判定される', () => {
    const w = work({ type: 'movie', title: '劇場版と同時上演の舞台◯◯ミュージカル' });
    expect(getDisplayWorkType(w)).toBe('stage');
  });

  it('アイドル番組はバラエティ・音楽番組キーワードより優先される', () => {
    // 「乃木坂工事中」はバラエティ的番組だが、専用キーワードで idol_show が先に確定する
    const w = work({ type: 'tv', title: '乃木坂工事中 #500' });
    expect(getDisplayWorkType(w)).toBe('idol_show');
  });

  it('ライブキーワードを含む音楽番組タイトルは、音楽番組(⑤)より先にライブ(①)として確定する', () => {
    const w = work({ type: 'tv', title: 'CDTV ライブ！ライブ！' });
    expect(getDisplayWorkType(w)).toBe('live');
  });

  it('音楽番組は該当キーワードで判定される', () => {
    const musicOnly = work({ type: 'tv', title: 'ミュージックステーション 3時間SP' });
    expect(getDisplayWorkType(musicOnly)).toBe('music');
  });

  it('ドラマ・バラエティ・映画・Web・アニメ声優は該当キーワードで判定される', () => {
    expect(getDisplayWorkType(work({ type: 'tv', title: '火曜ドラマ 探偵物語' }))).toBe('drama');
    expect(getDisplayWorkType(work({ type: 'tv', title: '水曜日のダウンタウン' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'movie', title: '劇場版 名探偵' }))).toBe('movie');
    expect(getDisplayWorkType(work({ type: 'tv', title: 'ABEMAオリジナル 特別企画' }))).toBe('web');
    expect(getDisplayWorkType(work({ type: 'anime', title: '○○ 声優インタビュー' }))).toBe('anime_voice');
  });
});

describe('getDisplayWorkType — 監査で確認済みの誤分類修正（本番overviewデータで確認済み）', () => {
  // 修正前は type='tv' のキーワード不一致により drama へフォールバックしていたが、
  // DB保存済みoverviewでジャンルが明記されているため、対応するキーワードを追加した。
  it('沸騰ワード10・有吉の壁・オードぜひ・ヒロミのおせっ買い・春日ロケーション・テレビギャングは variety と判定される', () => {
    expect(getDisplayWorkType(work({ type: 'tv', title: '沸騰ワード10' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'tv', title: '有吉の壁' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'tv', title: 'オードリーさん、ぜひ会ってほしい人がいるんです' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'tv', title: 'ヒロミのおせっ買い！' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'tv', title: '春日ロケーション' }))).toBe('variety');
    expect(getDisplayWorkType(work({ type: 'tv', title: 'テレビギャング' }))).toBe('variety');
  });

  it('乃木坂、逃避行。は idol_show と判定される', () => {
    expect(getDisplayWorkType(work({ type: 'tv', title: '乃木坂、逃避行。' }))).toBe('idol_show');
  });

  it('久保チャンネルは web と判定される', () => {
    expect(getDisplayWorkType(work({ type: 'tv', title: '久保チャンネル' }))).toBe('web');
  });
});

describe('getDisplayWorkType / getDisplayWorkTypeTrace — workType フォールバック（主要4種）', () => {
  it('type=tv でキーワード不一致の場合は drama へフォールバックする（trace で判別可能）', () => {
    const w = work({ type: 'tv', title: '第37話 新シリーズ' });
    expect(getDisplayWorkType(w)).toBe('drama');
    expect(getDisplayWorkTypeTrace(w).rule).toBe('type_fallback:tv');
  });

  it('type=movie でキーワード不一致の場合は movie へフォールバックする', () => {
    const w = work({ type: 'movie', title: '無題プロジェクト' });
    expect(getDisplayWorkType(w)).toBe('movie');
    expect(getDisplayWorkTypeTrace(w).rule).toBe('type_fallback:movie');
  });

  it('type=variety でキーワード不一致の場合は variety へフォールバックする', () => {
    const w = work({ type: 'variety', title: '不明な特番' });
    expect(getDisplayWorkType(w)).toBe('variety');
    expect(getDisplayWorkTypeTrace(w).rule).toBe('type_fallback:variety');
  });

  it('type=anime でキーワード不一致の場合は anime_voice へフォールバックする', () => {
    const w = work({ type: 'anime', title: '無題タイトル' });
    expect(getDisplayWorkType(w)).toBe('anime_voice');
    expect(getDisplayWorkTypeTrace(w).rule).toBe('type_fallback:anime');
  });
});

describe('getDisplayWorkType / getDisplayWorkTypeTrace — 安全なfallback（不正な組み合わせ）', () => {
  it('未知の workType（DB不整合等）は危険なカテゴリへ推測せず other になる', () => {
    // 実データ不整合を想定し、型システムを迂回して不正な workType を注入する
    const w = work({ type: 'unknown_type' as unknown as WorkType, title: '無題' });
    expect(getDisplayWorkType(w)).toBe('other');
    expect(getDisplayWorkTypeTrace(w).rule).toBe('other_fallback');
  });

  it('title・overviewが空文字/undefinedでもクラッシュせず安全に処理する', () => {
    const w = work({ type: 'tv', title: '' });
    expect(() => getDisplayWorkType(w)).not.toThrow();
    expect(getDisplayWorkType(w)).toBe('drama');
  });

  it('workDisplayType に不正な文字列が混入していても、そのまま返す（保存値を最優先するため）', () => {
    // アプリ内部では型で保証されるが、DB不整合を想定した安全性確認
    const w = work({ type: 'tv', workDisplayType: 'not_a_real_type' as unknown as DisplayWorkType });
    expect(getDisplayWorkTypeTrace(w).rule).toBe('manual_override');
  });
});

describe('normalizeDisplayWorkType — CSV正規化の安全なfallback', () => {
  it('有効な値はそのまま/日本語ラベルはマップ経由で DisplayWorkType に変換する', () => {
    expect(normalizeDisplayWorkType('drama')).toBe('drama');
    expect(normalizeDisplayWorkType('ライブ・コンサート')).toBe('live');
    expect(normalizeDisplayWorkType('ミュージカル')).toBe('stage');
  });

  it('空文字・空白のみ・未知の文字列は null を返す（推測しない）', () => {
    expect(normalizeDisplayWorkType('')).toBeNull();
    expect(normalizeDisplayWorkType('   ')).toBeNull();
    expect(normalizeDisplayWorkType('存在しないカテゴリ')).toBeNull();
    expect(normalizeDisplayWorkType('random-garbage-123')).toBeNull();
  });

  it('前後の空白はtrimしてから判定する', () => {
    expect(normalizeDisplayWorkType('  drama  ')).toBe('drama');
  });
});

describe('DISPLAY_WORK_TYPE_LABEL / ICON / ORDER — 網羅性', () => {
  it('全11カテゴリすべてに LABEL と ICON が定義されている', () => {
    for (const type of DISPLAY_WORK_TYPE_ORDER) {
      expect(DISPLAY_WORK_TYPE_LABEL[type]).toBeTruthy();
      expect(DISPLAY_WORK_TYPE_ICON[type]).toBeTruthy();
    }
  });

  it('DISPLAY_WORK_TYPE_ORDER はちょうど11件、重複なし', () => {
    expect(DISPLAY_WORK_TYPE_ORDER.length).toBe(11);
    expect(new Set(DISPLAY_WORK_TYPE_ORDER).size).toBe(11);
  });

  it('getDisplayWorkType の戻り値は必ず DISPLAY_WORK_TYPE_ORDER に含まれる（未知カテゴリを返さない）', () => {
    const types: WorkType[] = ['movie', 'tv', 'variety', 'anime'];
    for (const type of types) {
      const result = getDisplayWorkType(work({ type, title: 'キーワードに一致しないタイトル12345' }));
      expect(DISPLAY_WORK_TYPE_ORDER).toContain(result);
    }
  });
});
