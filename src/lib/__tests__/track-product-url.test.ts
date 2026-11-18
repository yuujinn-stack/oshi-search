import { describe, test, expect, vi, beforeEach } from 'vitest';
import { isRakutenHost, isSafeHttpUrl, isStorableRakutenLinkUrl } from '../track-product-url';

// 正規の楽天リンク（形式の違うものを含む）。保存時に誤って拒否しないこと。
const LEGIT_RAKUTEN_URLS = [
  // 楽天API（楽天ブックス）が返すアフィリエイトURL
  'https://hb.afl.rakuten.co.jp/hgc/abcd1234.5678efgh.abcd1234.5678efgh/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F18221363%2F',
  // 楽天API（楽天市場）が返すアフィリエイトURL（追加パラメータ付き）
  'https://hb.afl.rakuten.co.jp/hgc/abcd1234.5678efgh.abcd1234.5678efgh/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fsample-shop%2Fitem-001%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fsample-shop%2Fi%2F10000001%2F&rafcid=wsc_i_is_0000000000000000000',
  // http のアフィリエイトURL
  'http://hb.afl.rakuten.co.jp/hgc/abcd1234.5678efgh/?pc=http%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F1%2F',
  // パス形式が /hgc/ 以外（形式未確認のもの）も、楽天のドメインなら保存する
  'https://hb.afl.rakuten.co.jp/ichiba/abcd1234.5678efgh/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2Fitem%2F',
  'https://hb.afl.rakuten.co.jp/hgc/abcd1234.5678efgh/_RTLink00000?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F1%2F',
  // 通常の商品URL
  'http://books.rakuten.co.jp/rb/17687609/',
  'https://books.rakuten.co.jp/rb/17687609/?l-id=search',
  'https://item.rakuten.co.jp/book/17687609/',
  'https://item.rakuten.co.jp/sample-shop/abc_1.2/',
  // 楽天の短縮URL
  'https://a.r10.to/hXXXXX',
  'https://r10.to/hXXXXX',
];

describe('isStorableRakutenLinkUrl（/api/track の保存時判定）', () => {
  test.each(LEGIT_RAKUTEN_URLS)('正規の楽天リンクは保存する: %s', (url) => {
    expect(isStorableRakutenLinkUrl(url)).toBe(true);
  });

  test.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://books.rakuten.co.jp/rb/1/',
    'https://example.com/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F1%2F',
    'https://hb.afl.rakuten.co.jp.example.com/hgc/x/?pc=y', // 末尾が別ドメイン
    'https://evilrakuten.co.jp/rb/1/', // サブドメインではない
    'https://rakuten.co.jp@example.com/', // 認証情報形式
    'https://user:pass@books.rakuten.co.jp/rb/1/',
    '/person/梅澤美波', // 相対URL
    '//example.com/a',
    'not a url',
    '',
    '   ',
  ])('不正・楽天以外の URL は保存しない: %s', (url) => {
    expect(isStorableRakutenLinkUrl(url)).toBe(false);
  });

  test('文字列以外・長すぎる URL は保存しない', () => {
    expect(isStorableRakutenLinkUrl(undefined)).toBe(false);
    expect(isStorableRakutenLinkUrl(null)).toBe(false);
    expect(isStorableRakutenLinkUrl(123)).toBe(false);
    expect(isStorableRakutenLinkUrl({ href: 'https://books.rakuten.co.jp/rb/1/' })).toBe(false);
    expect(isStorableRakutenLinkUrl(`https://books.rakuten.co.jp/rb/1/?q=${'a'.repeat(2100)}`)).toBe(false);
  });
});

describe('isRakutenHost', () => {
  test('楽天のドメインとサブドメイン（大文字・末尾ドットも同じ扱い）', () => {
    expect(isRakutenHost('rakuten.co.jp')).toBe(true);
    expect(isRakutenHost('HB.AFL.RAKUTEN.CO.JP')).toBe(true);
    expect(isRakutenHost('books.rakuten.co.jp.')).toBe(true);
    expect(isRakutenHost('a.r10.to')).toBe(true);
    expect(isRakutenHost('rakuten.co.jp.example.com')).toBe(false);
    expect(isRakutenHost('xr10.to')).toBe(false);
  });
});

describe('楽天に似せた別ドメインを拒否する（保存時）', () => {
  test.each([
    'https://rakuten.co.jp.evil.com/rb/1/',
    'https://books.rakuten.co.jp-evil.com/rb/1/',
    'https://rakuten-co-jp.com/rb/1/',
    'https://rakuten.co.jp.com/rb/1/',
    'https://rakuten.co/rb/1/',
    'https://rakuten.jp/rb/1/',
    'https://rakuten.com/rb/1/',
    'https://rakutenn.co.jp/rb/1/',
    'https://rakuten.co.jpn/rb/1/',
    'https://r10.to.evil.com/hXXXXX',
    'https://r10-to.com/hXXXXX',
    'https://xn--rakuen-n4a.co.jp/rb/1/', // IDN（Punycode）の見た目が似たドメイン
    'https://rаkuten.co.jp/rb/1/', // キリル文字の「а」
    'https://evil.com/#books.rakuten.co.jp',
    'https://evil.com/?u=https://books.rakuten.co.jp/rb/1/',
    'https://evil.com/books.rakuten.co.jp/rb/1/',
    'https://books.rakuten.co.jp@evil.com/rb/1/',
    'https://books.rakuten.co.jp%2eevil.com/rb/1/',
    'https://evil.com\\@books.rakuten.co.jp/',
  ])('拒否: %s', (url) => {
    expect(isStorableRakutenLinkUrl(url)).toBe(false);
  });

  test.each([
    'https://BOOKS.RAKUTEN.CO.JP/rb/1/',
    'https://books.rakuten.co.jp./rb/1/',
    'https://books.rakuten.co.jp:443/rb/1/',
    'https://ｂｏｏｋｓ.ｒａｋｕｔｅｎ.co.jp/rb/1/', // 全角はブラウザと同じく半角に正規化される
  ])('楽天のドメイン（表記ゆれ）は許可: %s', (url) => {
    expect(isStorableRakutenLinkUrl(url)).toBe(true);
  });
});

describe('isSafeHttpUrl（表示時の判定）', () => {
  test('http/https の URL はホストを問わず表示する（既存の正当なリンクを変えない）', () => {
    for (const url of LEGIT_RAKUTEN_URLS) expect(isSafeHttpUrl(url)).toBe(true);
    expect(isSafeHttpUrl('https://example.com/item')).toBe(true);
    // 保存時の長さ上限は表示には適用しない（保存済みの長いURLのリンク先を変えない）
    expect(isSafeHttpUrl(`https://books.rakuten.co.jp/rb/1/?q=${'a'.repeat(2100)}`)).toBe(true);
  });
  test('javascript: 等・空・文字列以外は表示しない', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,x')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });
});

// ── /api/track（type:'product'）の保存内容 ─────────────────────────────────
const calls: { op: string; args: unknown[] }[] = [];
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    pipeline: () => {
      const pipe = {
        incr: (...args: unknown[]) => { calls.push({ op: 'incr', args }); return pipe; },
        hset: (...args: unknown[]) => { calls.push({ op: 'hset', args }); return pipe; },
        exec: async () => [],
      };
      return pipe;
    },
  }),
}));

async function post(body: unknown) {
  const { POST } = await import('@/app/api/track/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/track', { method: 'POST', body: JSON.stringify(body) });
  return POST(req);
}

describe('/api/track type:product', () => {
  beforeEach(() => { calls.length = 0; });

  const base = { type: 'product', productId: 'bk-1', slug: '梅澤美波', title: 't', category: '写真集', imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' };

  test.each(LEGIT_RAKUTEN_URLS)('正規の楽天リンクは受け取った値のまま保存する: %s', async (affiliateUrl) => {
    const res = await post({ ...base, affiliateUrl });
    expect(res.status).toBe(200);
    const hset = calls.find((c) => c.op === 'hset')!;
    expect(hset.args[1]).toEqual({ title: 't', personSlug: '梅澤美波', category: '写真集', imageUrl: base.imageUrl, affiliateUrl });
  });

  test('楽天以外・javascript: の affiliateUrl は保存せず既存値も上書きしない（クリック数は加算する）', async () => {
    for (const affiliateUrl of ['https://example.com/a', 'javascript:alert(1)']) {
      calls.length = 0;
      const res = await post({ ...base, affiliateUrl });
      expect(res.status).toBe(200);
      expect(calls.filter((c) => c.op === 'incr').map((c) => c.args[0])).toEqual(['product:click:bk-1', 'person:productClicks:梅澤美波']);
      const meta = calls.find((c) => c.op === 'hset')!.args[1] as Record<string, string>;
      expect('affiliateUrl' in meta).toBe(false);
      expect(meta.title).toBe('t');
    }
  });

  test('affiliateUrl・imageUrl が空・未指定なら従来どおり空文字で保存する', async () => {
    await post({ ...base, imageUrl: '', affiliateUrl: '' });
    expect(calls.find((c) => c.op === 'hset')!.args[1]).toMatchObject({ imageUrl: '', affiliateUrl: '' });
    calls.length = 0;
    await post({ type: 'product', productId: 'bk-1', slug: 's', title: 't' });
    expect(calls.find((c) => c.op === 'hset')!.args[1]).toMatchObject({ imageUrl: '', affiliateUrl: '' });
  });

  test('http/https 以外の imageUrl は保存しない', async () => {
    await post({ ...base, imageUrl: 'javascript:alert(1)', affiliateUrl: LEGIT_RAKUTEN_URLS[0] });
    const meta = calls.find((c) => c.op === 'hset')!.args[1] as Record<string, string>;
    expect('imageUrl' in meta).toBe(false);
    expect(meta.affiliateUrl).toBe(LEGIT_RAKUTEN_URLS[0]);
  });

  test('saveMeta=false 相当（title なし）はメタデータを保存しない（従来どおり）', async () => {
    await post({ type: 'product', productId: 'bk-1', slug: '' });
    expect(calls.map((c) => c.op)).toEqual(['incr']);
  });
});
