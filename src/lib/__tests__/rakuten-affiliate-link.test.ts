import { describe, it, expect } from 'vitest';
import {
  affiliateLinkStatusOf,
  classifyRakutenLink,
  decideManualAffiliateUrl,
  describeLinkBeforeSave,
  isSameProductTitle,
  parseAffiliateUrl,
  productKeyOfLink,
  productKeyString,
  type AffiliateCandidate,
} from '../rakuten-affiliate-link';

const BOOKS_HGC = 'aaaa1111.bbbb2222.aaaa1111.cccc3333';
const SHOP_HGC = 'dddd4444.eeee5555.dddd4444.ffff6666';
const books = (n: string) => `https://books.rakuten.co.jp/rb/${n}/`;
const ichiba = (shop: string, code: string) => `https://item.rakuten.co.jp/${shop}/${code}/`;
const aff = (page: string, hgc = BOOKS_HGC, scheme = 'https') =>
  `${scheme}://hb.afl.rakuten.co.jp/hgc/${hgc}/?pc=${encodeURIComponent(page)}&m=${encodeURIComponent(page)}`;
const noIssuers = new Set<string>();

describe('リンクの種類の判定', () => {
  it('楽天アフィリエイトURL（https / http）', () => {
    expect(classifyRakutenLink(aff(books('18507785')))).toBe('affiliate');
    expect(classifyRakutenLink(aff(books('18279162').replace('https', 'http'), BOOKS_HGC, 'http'))).toBe('affiliate');
    expect(classifyRakutenLink(aff(ichiba('cocohouse', 'b01gg4vc32'), SHOP_HGC))).toBe('affiliate');
  });

  it('通常URL（楽天ブックス・楽天市場）をアフィリエイトURLと誤判定しない', () => {
    expect(classifyRakutenLink(books('18507785'))).toBe('books_plain');
    expect(classifyRakutenLink('http://books.rakuten.co.jp/rb/18507785/')).toBe('books_plain');
    expect(classifyRakutenLink(ichiba('cocohouse', 'b01gg4vc32'))).toBe('ichiba_plain');
    // ホストが違う／クエリに文字列が含まれるだけのものはアフィリエイトURLではない
    expect(classifyRakutenLink(`https://example.com/?u=https://hb.afl.rakuten.co.jp/hgc/${BOOKS_HGC}/?pc=x`)).toBe('other');
    expect(classifyRakutenLink(`https://hb.afl.rakuten.co.jp/hgc/${BOOKS_HGC}/`)).toBe('other'); // 遷移先なし
  });

  it('短縮URL・未設定・楽天以外', () => {
    expect(classifyRakutenLink('https://a.r10.to/hkQkHO')).toBe('short');
    expect(classifyRakutenLink('')).toBe('empty');
    expect(classifyRakutenLink(undefined)).toBe('empty');
    expect(classifyRakutenLink('https://www.amazon.co.jp/dp/xxx')).toBe('other');
  });

  it('同一性キー：楽天ブックスは商品番号、楽天市場は店舗＋商品コード（同じ店舗の別商品は別キー）', () => {
    expect(productKeyString(productKeyOfLink(aff(books('1'))))).toBe('books:1');
    expect(productKeyString(productKeyOfLink(ichiba('book', '1')))).toBe('books:1'); // 楽天市場上の楽天ブックス店
    expect(productKeyString(productKeyOfLink(ichiba('cocohouse', 'a1')))).not.toBe(productKeyString(productKeyOfLink(ichiba('cocohouse', 'b2'))));
    expect(parseAffiliateUrl(aff(ichiba('cocohouse', 'a1'), SHOP_HGC))?.hgc).toBe(SHOP_HGC);
  });
});

describe('管理画面のリンク状態', () => {
  it('API商品・修正済みの手動商品は確認済み', () => {
    expect(affiliateLinkStatusOf({ itemUrl: books('1'), affiliateUrl: aff(books('1')) })).toBe('verified');
    expect(affiliateLinkStatusOf({ itemUrl: aff(ichiba('s', 'c'), SHOP_HGC), affiliateUrl: aff(ichiba('s', 'c'), SHOP_HGC) })).toBe('verified');
  });
  it('通常URL・短縮URL・未設定は要確認／未設定（以前の手動登録の保存形式も含む）', () => {
    expect(affiliateLinkStatusOf({ itemUrl: books('1'), affiliateUrl: books('1') })).toBe('plain_needs_review');
    expect(affiliateLinkStatusOf({ itemUrl: books('1'), affiliateUrl: '' })).toBe('plain_needs_review');
    expect(affiliateLinkStatusOf({ itemUrl: 'https://a.r10.to/x', affiliateUrl: 'https://a.r10.to/x' })).toBe('short_needs_review');
    expect(affiliateLinkStatusOf({ itemUrl: '', affiliateUrl: '' })).toBe('missing');
  });
  it('アフィリエイトURLの遷移先が商品URLと別の商品なら要確認', () => {
    expect(affiliateLinkStatusOf({ itemUrl: books('2'), affiliateUrl: aff(books('1')) })).toBe('unverified_affiliate');
  });
  it('保存前の案内文は、通常URL・短縮URLを正規リンクと誤解させない', () => {
    expect(describeLinkBeforeSave(books('1')).tone).toBe('warn');
    expect(describeLinkBeforeSave('https://a.r10.to/x').text).toContain('自動変換しません');
  });
});

describe('同一商品の名前', () => {
  it('全半角・空白の違いだけなら同じ', () => {
    expect(isSameProductTitle('劇薬中毒 (初回仕様限定盤 Type A CD＋DVD)', '劇薬中毒（初回仕様限定盤　Type A CD+DVD）')).toBe(true);
    expect(isSameProductTitle('【送料無料】櫻撮 VOL.01', '櫻撮　VOL．01')).toBe(true); // 盤種・特典を含まない【】付記は無視
  });
  it('【】内の特典表記の有無が違えば、特典違いの可能性があるため別扱い（安全側）', () => {
    expect(isSameProductTitle('【楽天ブックス限定特典】劇薬中毒 (初回仕様限定盤 Type A CD＋DVD)', '劇薬中毒 (初回仕様限定盤 Type A CD＋DVD)')).toBe(false);
  });
  it('初回盤A/B・通常盤・特典違いは別商品', () => {
    expect(isSameProductTitle('劇薬中毒 (初回仕様限定盤 Type A CD＋DVD)', '劇薬中毒 (初回仕様限定盤 Type B CD＋DVD)')).toBe(false);
    expect(isSameProductTitle('劇薬中毒 (初回仕様限定盤 Type A CD＋DVD)', '劇薬中毒 (通常盤)')).toBe(false);
    expect(isSameProductTitle('透明な覚悟(限定カバー)', '透明な覚悟')).toBe(false);
  });
});

describe('手動登録の affiliateUrl の決定', () => {
  const cand = (page: string, title: string, o: Partial<AffiliateCandidate> = {}): AffiliateCandidate => ({ id: 'bk-x', title, affiliateUrl: aff(page), ...o });

  it('① 楽天APIが返した正規URLを最優先（楽天ブックス）', () => {
    const d = decideManualAffiliateUrl({ title: 'A', itemUrl: books('100'), apiAffiliateUrl: aff(books('100')), candidates: [], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'verified', source: 'api', affiliateUrl: aff(books('100')) });
  });

  it('① 楽天APIのURLでも遷移先が別商品なら使わない', () => {
    const d = decideManualAffiliateUrl({ title: 'A', itemUrl: books('100'), apiAffiliateUrl: aff(books('999')), candidates: [], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'plain_needs_review', affiliateUrl: '' });
  });

  it('① 楽天市場の商品（itemUrl 自体がAPI発行のアフィリエイトURL）', () => {
    const url = aff(ichiba('shop1', 'item1'), SHOP_HGC);
    const d = decideManualAffiliateUrl({ title: 'グッズ', itemUrl: url, apiAffiliateUrl: url, candidates: [], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'verified', source: 'api', affiliateUrl: url });
  });

  it('② 既存DBの同じ商品・同じ名前の正規URLを流用', () => {
    const d = decideManualAffiliateUrl({ title: '櫻撮 VOL.01', itemUrl: books('100'), candidates: [cand(books('100'), '櫻撮　VOL．01')], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'verified', source: 'existing_db', affiliateUrl: aff(books('100')) });
  });

  it('② 同名でも商品番号が違う商品のURLは使わない（同名の別商品）', () => {
    const d = decideManualAffiliateUrl({ title: '櫻撮 VOL.01', itemUrl: books('100'), candidates: [cand(books('200'), '櫻撮 VOL.01')], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'plain_needs_review', affiliateUrl: '' });
  });

  it('② 特典違い・盤違いの名前なら使わない', () => {
    const d = decideManualAffiliateUrl({ title: '透明な覚悟(限定カバー)', itemUrl: books('100'), candidates: [cand(books('100'), '透明な覚悟')], knownIssuerHgcs: noIssuers });
    expect(d.status).toBe('plain_needs_review');
  });

  it('② 楽天市場：同じ店舗の別商品のURLは使わない', () => {
    const d = decideManualAffiliateUrl({
      title: 'アクスタ', itemUrl: ichiba('shop1', 'item1'),
      candidates: [{ id: 'ic-x', title: 'アクスタ', affiliateUrl: aff(ichiba('shop1', 'item2'), SHOP_HGC) }],
      knownIssuerHgcs: noIssuers,
    });
    expect(d.status).toBe('plain_needs_review');
  });

  it('② 楽天市場：同じ店舗・同じ商品コード・同じ名前なら流用', () => {
    const url = aff(ichiba('shop1', 'item1'), SHOP_HGC);
    const d = decideManualAffiliateUrl({ title: 'アクスタ', itemUrl: ichiba('shop1', 'item1'), candidates: [{ id: 'ic-x', title: 'アクスタ', affiliateUrl: url }], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'verified', affiliateUrl: url });
  });

  it('② 異なるURLが複数あって決められなければ要確認（http/https の違いだけなら https）', () => {
    const one = decideManualAffiliateUrl({
      title: 'A', itemUrl: books('100'),
      candidates: [cand(books('100'), 'A', { affiliateUrl: aff(books('100'), BOOKS_HGC, 'http') }), cand(books('100'), 'A')],
      knownIssuerHgcs: noIssuers,
    });
    expect(one.affiliateUrl).toBe(aff(books('100')));
    const two = decideManualAffiliateUrl({
      title: 'A', itemUrl: books('100'),
      candidates: [cand(books('100'), 'A'), cand(books('100'), 'A', { affiliateUrl: aff(books('100'), 'zzzz9999.yyyy8888.zzzz9999.xxxx7777') })],
      knownIssuerHgcs: noIssuers,
    });
    expect(two).toMatchObject({ status: 'plain_needs_review', affiliateUrl: '' });
  });

  it('③ 正規URLが確認できなければ組み立てない（空＝要確認）', () => {
    const d = decideManualAffiliateUrl({ title: 'A', itemUrl: books('100'), candidates: [], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'plain_needs_review', affiliateUrl: '' });
  });

  it('⑤ 短縮URLは変換しない', () => {
    const d = decideManualAffiliateUrl({ title: 'A', itemUrl: 'https://a.r10.to/abc', candidates: [], knownIssuerHgcs: noIssuers });
    expect(d).toMatchObject({ status: 'short_needs_review', affiliateUrl: '' });
  });

  it('貼り付けたアフィリエイトURLは、発行元が既存のAPI発行URLと同じ場合だけ確認済み', () => {
    const url = aff(books('100'));
    expect(decideManualAffiliateUrl({ title: 'A', itemUrl: url, candidates: [], knownIssuerHgcs: new Set([BOOKS_HGC]) }).status).toBe('verified');
    expect(decideManualAffiliateUrl({ title: 'A', itemUrl: url, candidates: [], knownIssuerHgcs: noIssuers })).toMatchObject({ status: 'unverified_affiliate', affiliateUrl: '' });
  });

  it('商品URL未設定', () => {
    expect(decideManualAffiliateUrl({ title: 'A', itemUrl: '', candidates: [], knownIssuerHgcs: noIssuers }).status).toBe('missing');
  });
});
