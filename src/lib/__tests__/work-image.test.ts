import { describe, it, expect } from 'vitest';
import { getWorkDisplayImage, getWorkDisplayImageSource, isValidImageUrl } from '../work-image';

describe('getWorkDisplayImage — 画像優先順位', () => {
  it('手動画像が最優先される', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: 'https://example.com/manual.jpg',
      posterUrl: 'https://image.tmdb.org/poster.jpg',
      ogImageUrl: 'https://lemino.docomo.ne.jp/logo.png',
    });
    expect(image).toBe('https://example.com/manual.jpg');
  });

  it('手動画像が無い場合はTMDb画像(posterUrl)を使う', () => {
    const image = getWorkDisplayImage({
      posterUrl: 'https://image.tmdb.org/poster.jpg',
      ogImageUrl: 'https://lemino.docomo.ne.jp/logo.png',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });

  it('手動画像・TMDb画像とも無い場合は自動取得OG画像(ogImageUrl)を使う', () => {
    const image = getWorkDisplayImage({
      ogImageUrl: 'https://example.com/og.jpg',
    });
    expect(image).toBe('https://example.com/og.jpg');
  });

  it('どれも無い場合はundefined（呼び出し側がプレースホルダーを表示する）', () => {
    expect(getWorkDisplayImage({})).toBeUndefined();
  });

  it('空文字は「未設定」として扱われ、次の優先順位へフォールバックする', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: '',
      posterUrl: 'https://image.tmdb.org/poster.jpg',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });
});

describe('getWorkDisplayImageSource', () => {
  it('手動画像ありなら manual', () => {
    expect(getWorkDisplayImageSource({ manualImageUrl: 'https://example.com/a.jpg' })).toBe('manual');
  });
  it('TMDb画像のみなら tmdb', () => {
    expect(getWorkDisplayImageSource({ posterUrl: 'https://image.tmdb.org/a.jpg' })).toBe('tmdb');
  });
  it('OG画像のみなら auto', () => {
    expect(getWorkDisplayImageSource({ ogImageUrl: 'https://example.com/a.jpg' })).toBe('auto');
  });
  it('どれも無ければ none', () => {
    expect(getWorkDisplayImageSource({})).toBe('none');
  });
});

describe('isValidImageUrl', () => {
  it('http/httpsの絶対URLを受理する', () => {
    expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
    expect(isValidImageUrl('http://example.com/image.jpg')).toBe(true);
  });
  it('プロトコルの無い文字列は拒否する', () => {
    expect(isValidImageUrl('example.com/image.jpg')).toBe(false);
  });
  it('相対パスは拒否する', () => {
    expect(isValidImageUrl('/images/foo.jpg')).toBe(false);
  });
  it('空文字は拒否する', () => {
    expect(isValidImageUrl('')).toBe(false);
  });
  it('http/https以外のプロトコルは拒否する（javascript:等の混入防止）', () => {
    expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('data:image/png;base64,abc')).toBe(false);
    expect(isValidImageUrl('ftp://example.com/a.jpg')).toBe(false);
  });
});
