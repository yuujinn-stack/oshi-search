import { describe, it, expect } from 'vitest';
import {
  activePointRate, activeTimeSale, eventStatus, findBannedPhrases, formatJstAdmin, formatJstPost, isOfficialRakutenUrl, isOfficiallyConfirmed,
  isRakutenProductPageUrl, parseJstDateTimeLocal, productPageUrlOf, toJstDateTimeLocal, validateEventInput, validateLinkUpdate, xWeightedLength,
  type RakutenEvent,
} from '../rakuten-event/core';

// 楽天イベント管理の純粋関数（日本時間・開催状態・入力の検証・API の情報の扱い）。投稿文は rakuten-event-posts.test.ts
const JST = (s: string) => parseJstDateTimeLocal(s)!;

const event = (o: Partial<RakutenEvent> = {}): RakutenEvent => ({
  id: 7, name: '楽天お買い物マラソン', eventType: 'marathon',
  startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59'),
  officialUrl: 'https://event.rakuten.co.jp/campaign/point-up/marathon/', entryRequired: 'required', entryUrl: null,
  conditions: '1,000円（税込）以上のショップで買いまわり', benefit: 'ショップ買いまわりでポイント最大10倍', benefitConditions: 'ポイント上限あり',
  lastCheckedAt: JST('2026-11-05T09:00'), visibility: 'published', note: null, updatedBy: 'A', createdAt: 0, updatedAt: 0, ...o,
});

describe('日本時間', () => {
  it('入力値を日本時間の壁時計時刻として解釈し、表示も日本時間（実行環境のタイムゾーンに依存しない）', () => {
    expect(new Date(JST('2026-11-11T01:59')).toISOString()).toBe('2026-11-10T16:59:00.000Z');
    expect(toJstDateTimeLocal(JST('2026-11-11T01:59'))).toBe('2026-11-11T01:59');
    expect(formatJstAdmin(JST('2026-11-11T01:59'))).toBe('2026/11/11(水) 01:59');
    expect(formatJstPost(JST('2026-11-11T01:59'), JST('2026-11-05T00:00'))).toBe('11月11日(水) 1:59');
    expect(formatJstPost(JST('2027-01-01T00:00'), JST('2026-12-30T00:00'))).toBe('2027年1月1日(金) 0:00');
  });
  it('不正・存在しない日時は null', () => {
    for (const v of ['', '2026-11-11', '2026-02-30T10:00', '2026-13-01T00:00', '2026-11-11T24:00', 123, null]) expect(parseJstDateTimeLocal(v)).toBeNull();
  });
});

describe('開催状態', () => {
  const e = event();
  it('開始前・開催中・終了（終了日時ちょうどで終了）', () => {
    expect(eventStatus(e, e.startsAt - 1)).toBe('upcoming');
    expect(eventStatus(e, e.startsAt)).toBe('active');
    expect(eventStatus(e, e.endsAt - 1)).toBe('active');
    expect(eventStatus(e, e.endsAt)).toBe('ended');
  });
});

describe('公式URL', () => {
  it('楽天の https ページだけ。アフィリエイトの計測リンク・他ドメイン・http は不可', () => {
    expect(isOfficialRakutenUrl('https://event.rakuten.co.jp/campaign/')).toBe(true);
    expect(isOfficialRakutenUrl('https://item.rakuten.co.jp/shop/a/')).toBe(true);
    expect(isOfficialRakutenUrl('https://books.rakuten.co.jp/rb/1/')).toBe(true);
    expect(isOfficialRakutenUrl('https://hb.afl.rakuten.co.jp/hgc/x/')).toBe(false);
    expect(isOfficialRakutenUrl('https://a.r10.to/abc')).toBe(false);
    expect(isOfficialRakutenUrl('http://event.rakuten.co.jp/')).toBe(false);
    expect(isOfficialRakutenUrl('https://rakuten.co.jp.evil.example/')).toBe(false);
    expect(isOfficialRakutenUrl('https://user:pw@event.rakuten.co.jp/')).toBe(false);
  });
});

describe('イベントの入力', () => {
  const base = {
    name: '楽天お買い物マラソン', eventType: 'marathon', startsAt: '2026-11-04T20:00', endsAt: '2026-11-11T01:59',
    officialUrl: 'https://event.rakuten.co.jp/campaign/', entryRequired: 'required', visibility: 'hidden',
  };
  it('正しい入力を受け付ける（空の任意項目は null）', () => {
    const r = validateEventInput({ ...base, conditions: '  ', lastCheckedAt: '' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.conditions).toBeNull(); expect(r.value.endsAt).toBe(JST('2026-11-11T01:59')); }
  });
  it('終了が開始以前・公式URLがアフィリエイトリンク・不明な種類は拒否', () => {
    expect(validateEventInput({ ...base, endsAt: '2026-11-04T20:00' }).ok).toBe(false);
    expect(validateEventInput({ ...base, officialUrl: 'https://hb.afl.rakuten.co.jp/hgc/x' }).ok).toBe(false);
    expect(validateEventInput({ ...base, eventType: 'x' }).ok).toBe(false);
    expect(validateEventInput({ ...base, name: 'a'.repeat(101) }).ok).toBe(false);
  });
  it('公開にするには公式URLと最終確認日時が必要', () => {
    expect(validateEventInput({ ...base, visibility: 'published' }).ok).toBe(false);
    expect(validateEventInput({ ...base, visibility: 'published', lastCheckedAt: '2026-11-05T09:00' }).ok).toBe(true);
    expect(validateEventInput({ ...base, visibility: 'published', officialUrl: '', lastCheckedAt: '2026-11-05T09:00' }).ok).toBe(false);
  });
});

describe('紐付けた商品の確認状態', () => {
  const ok = { checkStatus: 'confirmed', benefitScope: 'item', sourceUrl: 'https://item.rakuten.co.jp/shop/a/', checkedAt: '2026-11-05T10:00' };
  it('確認済みには公式の確認元URL・確認日時・特典の範囲が必要', () => {
    expect(validateLinkUpdate(ok).ok).toBe(true);
    expect(validateLinkUpdate({ ...ok, sourceUrl: '' }).ok).toBe(false);
    expect(validateLinkUpdate({ ...ok, sourceUrl: 'https://hb.afl.rakuten.co.jp/hgc/x' }).ok).toBe(false);
    expect(validateLinkUpdate({ ...ok, checkedAt: '' }).ok).toBe(false);
    expect(validateLinkUpdate({ ...ok, benefitScope: 'unknown' }).ok).toBe(false);
  });
  it('対象外には理由が必要（取得できなかっただけで対象外にしない）。要確認は条件なし', () => {
    expect(validateLinkUpdate({ checkStatus: 'excluded', benefitScope: 'unknown' }).ok).toBe(false);
    expect(validateLinkUpdate({ checkStatus: 'excluded', benefitScope: 'unknown', note: 'ショップが対象外と公式に記載' }).ok).toBe(true);
    expect(validateLinkUpdate({ checkStatus: 'needs_check', benefitScope: 'unknown' }).ok).toBe(true);
  });
});

describe('Phase 2 の追加', () => {
  it('商品単体の特典の確認元は楽天の商品ページだけ（イベント告知ページは不可）', () => {
    const base = { checkStatus: 'confirmed', benefitScope: 'item', checkedAt: '2026-11-05T10:00' };
    expect(validateLinkUpdate({ ...base, sourceUrl: 'https://item.rakuten.co.jp/shop/item1/' }).ok).toBe(true);
    expect(validateLinkUpdate({ ...base, sourceUrl: 'https://books.rakuten.co.jp/rb/18000000/' }).ok).toBe(true);
    expect(validateLinkUpdate({ ...base, sourceUrl: 'https://event.rakuten.co.jp/campaign/point-up/marathon/' }).ok).toBe(false);
    expect(validateLinkUpdate({ ...base, sourceUrl: 'https://item.rakuten.co.jp/shop/' }).ok).toBe(false);
    // ショップ単位・購入者条件はイベントページでもよい
    expect(validateLinkUpdate({ ...base, benefitScope: 'buyer_condition', sourceUrl: 'https://event.rakuten.co.jp/campaign/card/pointday/' }).ok).toBe(true);
    expect(isRakutenProductPageUrl('https://hb.afl.rakuten.co.jp/hgc/x/?pc=https://item.rakuten.co.jp/a/b/')).toBe(false);
  });
  it('管理画面で開く商品ページ：アフィリエイトの計測リンクは遷移先の商品ページに（推測で作らない）', () => {
    expect(productPageUrlOf('https://hb.afl.rakuten.co.jp/hgc/abc.def/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fajewelry%2Fsrxl-300%2F&m=x')).toBe('https://item.rakuten.co.jp/ajewelry/srxl-300/');
    expect(productPageUrlOf('https://item.rakuten.co.jp/shop/a/')).toBe('https://item.rakuten.co.jp/shop/a/');
    expect(productPageUrlOf('https://a.r10.to/abc')).toBeNull();
    expect(productPageUrlOf('https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fexample.com%2F')).toBeNull();
    expect(productPageUrlOf(null)).toBeNull();
  });
  it('公式確認済み＝公式URLと最終確認日時の両方', () => {
    expect(isOfficiallyConfirmed(event())).toBe(true);
    expect(isOfficiallyConfirmed(event({ lastCheckedAt: null }))).toBe(false);
    expect(isOfficiallyConfirmed(event({ officialUrl: null }))).toBe(false);
  });
  it('ブラックフライデーを種類に追加', () => {
    expect(validateEventInput({ name: 'BF', eventType: 'black_friday', startsAt: '2026-11-20T00:00', endsAt: '2026-11-27T01:59', entryRequired: 'unknown', visibility: 'hidden' }).ok).toBe(true);
  });
  it('API の商品別ポイント倍率・タイムセールは期間内で2倍以上のときだけ有効', () => {
    const info = { itemCode: 's:a', itemName: '', itemPrice: 1000, availability: 1, pointRate: 5, pointRateStartTime: '2026-11-04 20:00', pointRateEndTime: '2026-11-11 01:59', saleStartTime: null, saleEndTime: null, shopName: null, fetchedAt: 0 };
    expect(activePointRate(info, JST('2026-11-05T00:00'))).toEqual({ rate: 5, endsAt: JST('2026-11-11T01:59') });
    expect(activePointRate(info, JST('2026-11-11T01:59'))).toBeNull();
    expect(activePointRate(info, JST('2026-11-01T00:00'))).toBeNull();
    expect(activePointRate({ ...info, pointRate: 1 }, JST('2026-11-05T00:00'))).toBeNull();
    expect(activeTimeSale({ ...info, saleStartTime: '2026-11-04 20:00', saleEndTime: '2026-11-05 01:59' }, JST('2026-11-05T00:00'))).toEqual({ endsAt: JST('2026-11-05T01:59') });
    expect(activeTimeSale(info, JST('2026-11-05T00:00'))).toBeNull();
  });
  it('X の文字数：URL は23、日本語は2、ラテン文字は1', () => {
    expect(xWeightedLength('abc')).toBe(3);
    expect(xWeightedLength('あいう')).toBe(6);
    expect(xWeightedLength('a https://oshi-search.jp/person/%E6%88%90?utm_source=x b')).toBe(1 + 1 + 23 + 1 + 1);
    expect(findBannedPhrases('今が一番安い・急いで')).toEqual(['一番安い', '急いで']);
  });
});
