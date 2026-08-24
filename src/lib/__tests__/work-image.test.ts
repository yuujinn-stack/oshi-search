import { describe, it, expect } from 'vitest';
import { getWorkDisplayImage, getWorkDisplayImageSource, getRenderableWorkImageUrl, isValidImageUrl, isPlausibleImageUrl } from '../work-image';

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

  // 実際に発生した回帰: Google画像検索結果ページのURL（/imgres）を「画像アドレスをコピー」で
  // 誤って手動画像URLに保存してしまうと、以前は正常表示できていたogImageUrlが隠れてしまう問題。
  // DBの値は変更せず、表示選択時にこの候補をスキップして次点へフォールバックする。
  it('手動画像がGoogle画像検索の結果ページURL(/imgres)の場合はスキップし、次点(TMDb画像)へフォールバックする', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: 'https://www.google.com/imgres?q=x&imgurl=https%3A%2F%2Fexample.com%2Freal.jpg',
      posterUrl: 'https://image.tmdb.org/poster.jpg',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });

  it('手動画像がGoogle検索結果ページURLで、TMDb画像も無い場合は自動取得OG画像へフォールバックする', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: 'https://www.google.com/imgres?q=x',
      ogImageUrl: 'https://img.happyon.jp/masthead.jpg',
    });
    expect(image).toBe('https://img.happyon.jp/masthead.jpg');
  });

  it('手動画像がBing画像検索の結果ページURLの場合もスキップする', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: 'https://www.bing.com/images/search?q=x',
      posterUrl: 'https://image.tmdb.org/poster.jpg',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });

  // Disney+審査対応: ogImageUrlがDisney公式配信基盤CDN(bamgrid.com)を指す場合は無許諾転載を
  // 避けるためスキップし、TMDb画像へフォールバックする。DBの値自体は変更しない。
  it('自動取得OG画像がDisney公式CDN(bamgrid.com)の場合はスキップし、TMDb画像へフォールバックする', () => {
    const image = getWorkDisplayImage({
      posterUrl: 'https://image.tmdb.org/poster.jpg',
      ogImageUrl: 'https://disney.images.edge.bamgrid.com/foo/bar.jpg',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });

  it('自動取得OG画像がDisney公式CDNで、TMDb画像も無い場合は画像なし(undefined)になる', () => {
    const image = getWorkDisplayImage({
      ogImageUrl: 'https://disney.images.edge.bamgrid.com/foo/bar.jpg',
    });
    expect(image).toBeUndefined();
  });

  it('手動画像がDisney公式CDNの場合もスキップする', () => {
    const image = getWorkDisplayImage({
      manualImageUrl: 'https://disney.images.edge.bamgrid.com/manual.jpg',
      posterUrl: 'https://image.tmdb.org/poster.jpg',
    });
    expect(image).toBe('https://image.tmdb.org/poster.jpg');
  });
});

describe('isPlausibleImageUrl', () => {
  it('通常の画像URLは妥当と判定する', () => {
    expect(isPlausibleImageUrl('https://image.tmdb.org/poster.jpg')).toBe(true);
    expect(isPlausibleImageUrl('https://www.nogizaka46.com/files/46/news/1.jpg')).toBe(true);
  });
  it('Google画像検索の結果ページURL(/imgres)は妥当ではないと判定する', () => {
    expect(isPlausibleImageUrl('https://www.google.com/imgres?q=x')).toBe(false);
  });
  it('Google検索ページURL(/search)も妥当ではないと判定する', () => {
    expect(isPlausibleImageUrl('https://www.google.com/search?q=x&tbm=isch')).toBe(false);
  });
  it('Bing画像検索の結果ページURLも妥当ではないと判定する', () => {
    expect(isPlausibleImageUrl('https://www.bing.com/images/search?q=x')).toBe(false);
  });
  it('形式が不正なURLは妥当ではないと判定する', () => {
    expect(isPlausibleImageUrl('not-a-url')).toBe(false);
  });
  it('Disney公式CDN(bamgrid.com)のURLは妥当ではないと判定する', () => {
    expect(isPlausibleImageUrl('https://disney.images.edge.bamgrid.com/foo.jpg')).toBe(false);
    expect(isPlausibleImageUrl('https://bamgrid.com/foo.jpg')).toBe(false);
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
  it('手動画像がGoogle検索結果ページURLの場合は manual ではなく実際に使われる候補を返す', () => {
    expect(getWorkDisplayImageSource({
      manualImageUrl: 'https://www.google.com/imgres?q=x',
      posterUrl: 'https://image.tmdb.org/a.jpg',
    })).toBe('tmdb');
  });
});

describe('getRenderableWorkImageUrl', () => {
  it('HTMLエンティティ &amp; を & へ復元する', () => {
    expect(getRenderableWorkImageUrl('https://example.com/a.jpg?w=600&amp;h=338')).toBe('https://example.com/a.jpg?w=600&h=338');
  });
  it('エンティティを含まないURLはそのまま返す', () => {
    expect(getRenderableWorkImageUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });
  it('undefinedはundefinedのまま返す', () => {
    expect(getRenderableWorkImageUrl(undefined)).toBeUndefined();
  });
  it('空文字はundefinedを返す', () => {
    expect(getRenderableWorkImageUrl('')).toBeUndefined();
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
