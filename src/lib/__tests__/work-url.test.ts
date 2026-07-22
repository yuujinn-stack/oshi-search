import { describe, it, expect } from 'vitest';
import { getWorkPublicUrl } from '../work-url';

describe('getWorkPublicUrl', () => {
  // ── 正常系 ──────────────────────────────────────────────────────────────────

  it('有効な入力 → 正しいURL', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-12345', personName: '齋藤飛鳥' }))
      .toBe('/person/%E9%BD%8B%E8%97%A4%E9%A3%9B%E9%B3%A5/work/tmdb-tv-12345');
  });

  it('ASCII文字のworkIdとpersonName', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-movie-999', personName: 'TestPerson' }))
      .toBe('/person/TestPerson/work/tmdb-movie-999');
  });

  it('日本語workIdをエンコードする', () => {
    const url = getWorkPublicUrl({ workId: '映画テスト', personName: 'Alice' });
    expect(url).toBe('/person/Alice/work/%E6%98%A0%E7%94%BB%E3%83%86%E3%82%B9%E3%83%88');
  });

  it('スペース・記号を含むpersonNameをエンコードする', () => {
    const url = getWorkPublicUrl({ workId: 'work-1', personName: 'Name With Spaces' });
    expect(url).toBe('/person/Name%20With%20Spaces/work/work-1');
  });

  it('canonicalWorkId が指定された場合はworkIdより優先', () => {
    const url = getWorkPublicUrl({
      workId: 'old-id',
      personName: 'Alice',
      canonicalWorkId: 'new-id',
    });
    expect(url).toBe('/person/Alice/work/new-id');
  });

  it('canonicalWorkId が null の場合はworkIdを使用', () => {
    const url = getWorkPublicUrl({ workId: 'work-1', personName: 'Alice', canonicalWorkId: null });
    expect(url).toBe('/person/Alice/work/work-1');
  });

  // ── 無効入力 ──────────────────────────────────────────────────────────────

  it('personName が null の場合 → null', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: null })).toBeNull();
  });

  it('personName が undefined の場合 → null', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: undefined })).toBeNull();
  });

  it('personName が空文字の場合 → null', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: '' })).toBeNull();
  });

  it('personName がスペースのみの場合 → null', () => {
    expect(getWorkPublicUrl({ workId: 'tmdb-tv-1', personName: '   ' })).toBeNull();
  });

  it('workId が空文字の場合 → null', () => {
    expect(getWorkPublicUrl({ workId: '', personName: 'Alice' })).toBeNull();
  });

  it('workId がスペースのみの場合 → null', () => {
    expect(getWorkPublicUrl({ workId: '   ', personName: 'Alice' })).toBeNull();
  });

  it('canonicalWorkId が空文字 → workIdにフォールバック', () => {
    const url = getWorkPublicUrl({ workId: 'work-1', personName: 'Alice', canonicalWorkId: '' });
    expect(url).toBe('/person/Alice/work/work-1');
  });

  // ── 境界条件 ──────────────────────────────────────────────────────────────

  it('前後スペースはトリムされる', () => {
    const url = getWorkPublicUrl({ workId: '  work-1  ', personName: '  Alice  ' });
    expect(url).toBe('/person/Alice/work/work-1');
  });

  it('URLにDBアクセスを含まない（同期的に即座に返す）', () => {
    const start = Date.now();
    const url = getWorkPublicUrl({ workId: 'w1', personName: 'p1' });
    expect(Date.now() - start).toBeLessThan(10);
    expect(url).toBe('/person/p1/work/w1');
  });

  it('返却URLは常に /person/ で始まる', () => {
    const url = getWorkPublicUrl({ workId: 'w1', personName: 'p1' });
    expect(url).toMatch(/^\/person\//);
  });

  it('返却URLは /work/ セグメントを含む', () => {
    const url = getWorkPublicUrl({ workId: 'w1', personName: 'p1' });
    expect(url).toContain('/work/');
  });
});
