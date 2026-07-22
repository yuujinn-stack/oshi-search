import { describe, it, expect } from 'vitest';
import { getWorkPublicUrl } from '../work-url';

describe('getWorkPublicUrl', () => {
  // ── 正常系 ──────────────────────────────────────────────────────────────────

  it('有効なworkId → 正しいURL', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-12345' }))
      .toBe('/work/tmdb-tv-12345');
  });

  it('personNameは無視されてworkIdのみでURLを生成する', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-12345', personName: '齋藤飛鳥' }))
      .toBe('/work/tmdb-tv-12345');
  });

  it('ASCII文字のworkId', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-movie-999' }))
      .toBe('/work/tmdb-movie-999');
  });

  it('日本語workIdをエンコードする', () => {
    const url = getWorkPublicUrl({ workId: '映画テスト' });
    expect(url).toBe('/work/%E6%98%A0%E7%94%BB%E3%83%86%E3%82%B9%E3%83%88');
  });

  it('スペース・記号を含むworkIdをエンコードする', () => {
    const url = getWorkPublicUrl({ workId: 'work id/test' });
    expect(url).toBe('/work/work%20id%2Ftest');
  });

  it('canonicalWorkId が指定された場合はworkIdより優先', () => {
    const url = getWorkPublicUrl({
      workId: 'old-id',
      canonicalWorkId: 'new-id',
    });
    expect(url).toBe('/work/new-id');
  });

  it('canonicalWorkId が null の場合はworkIdを使用', () => {
    const url = getWorkPublicUrl({ workId: 'work-1', canonicalWorkId: null });
    expect(url).toBe('/work/work-1');
  });

  it('canonicalWorkId が空文字 → workIdにフォールバック', () => {
    const url = getWorkPublicUrl({ workId: 'work-1', canonicalWorkId: '' });
    expect(url).toBe('/work/work-1');
  });

  // ── 無効入力 ──────────────────────────────────────────────────────────────

  it('workId が空文字の場合 → null', () => {
    expect(getWorkPublicUrl({ workId: '' })).toBeNull();
  });

  it('workId がスペースのみの場合 → null', () => {
    expect(getWorkPublicUrl({ workId: '   ' })).toBeNull();
  });

  it('personName が null でも workId があれば URL を返す', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: null })).toBe('/work/tmdb-tv-1');
  });

  it('personName が undefined でも workId があれば URL を返す', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: undefined })).toBe('/work/tmdb-tv-1');
  });

  it('personName が空文字でも workId があれば URL を返す', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: '' })).toBe('/work/tmdb-tv-1');
  });

  it('canonicalWorkId もスペースのみ かつ workId もスペースのみ → null', () => {
    expect(getWorkPublicUrl({ workId: '   ', canonicalWorkId: '   ' })).toBeNull();
  });

  // ── 境界条件 ──────────────────────────────────────────────────────────────

  it('前後スペースはトリムされる', () => {
    const url = getWorkPublicUrl({ workId: '  work-1  ' });
    expect(url).toBe('/work/work-1');
  });

  it('URLにDBアクセスを含まない（同期的に即座に返す）', () => {
    const start = Date.now();
    const url = getWorkPublicUrl({ workId: 'w1' });
    expect(Date.now() - start).toBeLessThan(10);
    expect(url).toBe('/work/w1');
  });

  it('返却URLは常に /work/ で始まる', () => {
    const url = getWorkPublicUrl({ workId: 'w1' });
    expect(url).toMatch(/^\/work\//);
  });

  it('返却URLは /work/ セグメントのみを含む（/person/ セグメントなし）', () => {
    const url = getWorkPublicUrl({ workId: 'w1', personName: 'someActor' });
    expect(url).not.toContain('/person/');
  });

  it('workId のみで完全なURLが生成される', () => {
    const url = getWorkPublicUrl({ workId: 'tmdb-tv-999' });
    expect(url).toBe('/work/tmdb-tv-999');
  });

  it('canonicalWorkId が優先され workId は無視される', () => {
    const url = getWorkPublicUrl({ workId: 'ignored', canonicalWorkId: 'canonical' });
    expect(url).toBe('/work/canonical');
  });
});
