import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TrackedRakutenLink from '@/components/site/TrackedRakutenLink';

// トップ・グループ・作品ページの楽天リンクを TrackedRakutenLink に置き換えても、
// 出力される <a> の href・target・rel・class・style・子要素が従来と同じであることを確認する。
describe('TrackedRakutenLink', () => {
  test('受け取った属性をそのまま <a> に出力し、track 情報は属性に出さない', () => {
    const href = 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F1%2F';
    const html = renderToStaticMarkup(
      createElement(
        TrackedRakutenLink,
        {
          track: {
            productId: 'bk-1',
            personSlug: '梅澤美波',
            title: 't',
            category: '写真集',
            imageUrl: '',
            affiliateUrl: href,
            pageType: 'home',
            placement: 'home_popular_products',
            position: 1,
          },
          href,
          target: '_blank',
          rel: 'noopener noreferrer sponsored',
          className: 'theme-card',
          style: { display: 'flex' },
        },
        '楽天で見る →',
      ),
    );
    const expected = renderToStaticMarkup(
      createElement(
        'a',
        { href, target: '_blank', rel: 'noopener noreferrer sponsored', className: 'theme-card', style: { display: 'flex' } },
        '楽天で見る →',
      ),
    );
    expect(html).toBe(expected);
  });

  test('track=null（内部リンクのフォールバック）でも同じ <a> を出力する', () => {
    const html = renderToStaticMarkup(createElement(TrackedRakutenLink, { track: null, href: '/person/x' }, 'x'));
    expect(html).toBe('<a href="/person/x">x</a>');
  });
});
