import { describe, it, expect } from 'vitest';
import { shouldNoindexWork, looksLikeMojibake, safeTitleFallback } from '../seo-quality';

// 人物ページへの自動noindex判定は意図的に未実装（seo-quality.tsのコメント参照）。
// 作品0件だけを理由に低品質と断定しない方針のため、対応するテストも存在しない。

describe('shouldNoindexWork', () => {
  it('タイトル空文字 → noindex', () => {
    expect(shouldNoindexWork({ title: '', workId: 'tmdb-movie-123' })).toBe(true);
  });

  it('タイトルがnull → noindex', () => {
    expect(shouldNoindexWork({ title: null, workId: 'tmdb-movie-123' })).toBe(true);
  });

  it('タイトルがworkIdと同一（内部IDがそのままタイトルになっている） → noindex', () => {
    expect(shouldNoindexWork({ title: 'tmdb-movie-123', workId: 'tmdb-movie-123' })).toBe(true);
  });

  it('タイトルがtmdb-movie-xxx形式のプレースホルダー → noindex', () => {
    expect(shouldNoindexWork({ title: 'tmdb-tv-9999', workId: 'other-id' })).toBe(true);
  });

  it('正常なタイトル → index', () => {
    expect(shouldNoindexWork({ title: '正しい作品タイトル', workId: 'tmdb-movie-123' })).toBe(false);
  });
});

describe('looksLikeMojibake', () => {
  it('Unicode置換文字を含む → 文字化け候補', () => {
    expect(looksLikeMojibake('テスト�作品')).toBe(true);
  });

  it('C1制御文字を含む → 文字化け候補', () => {
    expect(looksLikeMojibake('テスト')).toBe(true);
  });

  it('通常の日本語タイトル → 文字化け候補ではない', () => {
    expect(looksLikeMojibake('正しい作品タイトル')).toBe(false);
  });

  it('null/undefined → 文字化け候補ではない', () => {
    expect(looksLikeMojibake(null)).toBe(false);
    expect(looksLikeMojibake(undefined)).toBe(false);
  });

  it('空文字 → 文字化け候補ではない', () => {
    expect(looksLikeMojibake('')).toBe(false);
  });
});

describe('safeTitleFallback', () => {
  it('タイトルがnull/空の場合はfallbackを返す（undefined｜推しサーチ等を防ぐ）', () => {
    expect(safeTitleFallback(null, 'この作品')).toBe('この作品');
    expect(safeTitleFallback(undefined, 'この作品')).toBe('この作品');
    expect(safeTitleFallback('', 'この作品')).toBe('この作品');
    expect(safeTitleFallback('   ', 'この作品')).toBe('この作品');
  });

  it('タイトルが存在する場合はそのまま返す', () => {
    expect(safeTitleFallback('正しいタイトル', 'この作品')).toBe('正しいタイトル');
  });
});
