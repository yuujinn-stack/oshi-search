import { describe, it, expect } from 'vitest';
import {
  BANNED_PHRASES, X_MAX, buildPersonLink, eventStatus, findBannedPhrases, formatJstAdmin, formatJstPost, generatePosts, isOfficialRakutenUrl,
  parseJstDateTimeLocal, toJstDateTimeLocal, validateEventInput, validateLinkUpdate, xWeightedLength,
  type RakutenEvent, type RakutenEventProduct,
} from '../rakuten-event/core';

// 楽天イベント管理の純粋関数（日本時間・開催状態・入力の検証・投稿文）
const JST = (s: string) => parseJstDateTimeLocal(s)!;

const event = (o: Partial<RakutenEvent> = {}): RakutenEvent => ({
  id: 7, name: '楽天お買い物マラソン', eventType: 'marathon',
  startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59'),
  officialUrl: 'https://event.rakuten.co.jp/campaign/point-up/marathon/', entryRequired: 'required', entryUrl: null,
  conditions: '1,000円（税込）以上のショップで買いまわり', benefit: 'ショップ買いまわりでポイント最大10倍', benefitConditions: 'ポイント上限あり',
  lastCheckedAt: JST('2026-11-05T09:00'), visibility: 'published', note: null, updatedBy: 'A', createdAt: 0, updatedAt: 0, ...o,
});
const link = (o: Partial<RakutenEventProduct> = {}): RakutenEventProduct => ({
  id: 1, eventId: 7, personName: '推しA', category: '写真集', productId: 'p1', productTitle: '推しA 1st写真集',
  checkStatus: 'needs_check', benefitScope: 'unknown', benefitNote: null, sourceUrl: null, checkedAt: null, checkedBy: null, note: null, updatedAt: 0, ...o,
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

describe('SNS投稿文', () => {
  const now = JST('2026-11-05T12:00');
  const gen = (o: { e?: Partial<RakutenEvent>; products?: RakutenEventProduct[]; nowMs?: number } = {}) =>
    generatePosts({ event: event(o.e), personName: '推しA', products: o.products ?? [], nowMs: o.nowMs ?? now });

  it('イベント名・正確な終了日時・エントリー・PR表記・推しサーチへのリンク（UTM付き）を含む', () => {
    const p = gen();
    for (const text of [p.x, p.threads, p.instagramFeed, p.instagramStory]) {
      expect(text).toContain('楽天お買い物マラソン');
      expect(text).toContain('11月11日(水) 1:59まで');
      expect(text).toContain('エントリーが必要');
      expect(text).toContain('PR');
    }
    expect(p.x).toContain('https://oshi-search.jp/person/%E6%8E%A8%E3%81%97A?utm_source=x&utm_medium=social&utm_campaign=rakuten_event_7');
    expect(p.threads).toContain('utm_source=threads');
    expect(p.instagramStory).toContain('utm_source=instagram&utm_medium=social&utm_campaign=rakuten_event_7&utm_content=story');
    expect(p.threads).toContain('楽天アフィリエイトを利用しています');
    expect(p.threads).toContain('参加条件：1,000円（税込）以上のショップで買いまわり');
    expect(p.blocked).toBeNull();
  });

  it('X は280以内（全角2・URL23で数える）', () => {
    const p = gen({ e: { benefit: 'あ'.repeat(200) } });
    expect(xWeightedLength(p.x)).toBeLessThanOrEqual(X_MAX);
    expect(p.x).not.toContain('あああ');
  });

  it('開催前は開始日時も入れる。終了したイベントは作らない', () => {
    expect(gen({ nowMs: JST('2026-11-01T00:00') }).x).toContain('11月4日(水) 20:00スタート');
    const ended = gen({ nowMs: JST('2026-11-11T01:59') });
    expect(ended.status).toBe('ended');
    expect(ended.blocked).toMatch(/終了/);
    expect(ended.x + ended.threads + ended.instagramFeed + ended.instagramStory).toBe('');
  });

  it('「最安値」等は生成しない。入力に含まれる項目は外して警告', () => {
    const p = gen({ e: { benefit: '今が最安値！ポイント10倍' } });
    for (const text of [p.x, p.threads, p.instagramFeed, p.instagramStory]) expect(findBannedPhrases(text)).toEqual([]);
    expect(p.threads).not.toContain('ポイント10倍');
    expect(p.warnings.join()).toMatch(/最安値/);
    // 通常の生成でも禁止表現が出ない
    const normal = gen({ products: [link({ checkStatus: 'confirmed', benefitScope: 'item', benefitNote: 'ポイント5倍' })] });
    for (const text of [normal.x, normal.threads, normal.instagramFeed, normal.instagramStory]) {
      for (const b of BANNED_PHRASES) expect(text).not.toContain(b);
    }
  });

  it('商品の特典は「確認済み・商品単体／ショップ単位」だけ。購入者条件・要確認・対象外は商品の特典として書かない', () => {
    const p = gen({
      products: [
        link({ id: 1, productId: 'p1', productTitle: '写真集A', checkStatus: 'confirmed', benefitScope: 'item', benefitNote: 'ポイント5倍' }),
        link({ id: 2, productId: 'p2', productTitle: 'CD-B', category: 'CD', checkStatus: 'confirmed', benefitScope: 'buyer_condition', benefitNote: '楽天カードで+2倍' }),
        link({ id: 3, productId: 'p3', productTitle: 'DVD-C', category: 'Blu-ray・DVD', checkStatus: 'needs_check' }),
        link({ id: 4, productId: 'p4', productTitle: 'グッズD', category: 'グッズ', checkStatus: 'excluded', note: '対象外' }),
        link({ id: 5, productId: 'p5', productTitle: '別人の写真集', personName: '推しB', checkStatus: 'confirmed', benefitScope: 'item' }),
      ],
    });
    expect(p.threads).toContain('・写真集A（商品の特典：ポイント5倍）');
    expect(p.threads).not.toContain('CD-B');
    expect(p.threads).not.toContain('楽天カードで+2倍');
    expect(p.threads).not.toContain('DVD-C');
    expect(p.threads).not.toContain('グッズD');
    expect(p.threads).not.toContain('別人の写真集');
    expect(p.warnings.join()).toMatch(/要確認/);
    expect(p.warnings.join()).toMatch(/購入者の条件/);
    expect(p.threads).toContain('購入者の条件');
  });

  it('価格は入れない・Instagram フィードはリンクではなくプロフィールへの案内', () => {
    // 商品の価格（products の price）は投稿文に入れない（管理者が入力した参加条件の金額はそのまま）
    const p = gen({ e: { conditions: null }, products: [link({ checkStatus: 'confirmed', benefitScope: 'item' })] });
    expect(p.threads).not.toMatch(/[¥￥]\s?\d|\d+円/);
    expect(p.instagramFeed).not.toContain('https://oshi-search.jp');
    expect(p.instagramFeed).toContain('プロフィールのリンク');
  });

  it('エントリー未確認・最終確認が古い・非公開は警告', () => {
    const p = gen({ e: { entryRequired: 'unknown', lastCheckedAt: JST('2026-11-04T00:00'), visibility: 'hidden' } });
    expect(p.threads).toContain('エントリーの要否は楽天の公式ページでご確認ください');
    const w = p.warnings.join('\n');
    expect(w).toMatch(/24時間以上/);
    expect(w).toMatch(/非公開/);
  });

  it('リンクは1カテゴリだけなら人物ページのそのタブへ', () => {
    expect(buildPersonLink('推しA', { eventId: 1, channel: 'x', categories: ['CD', 'CD'] })).toMatch(/#products-cd$/);
    expect(buildPersonLink('推しA', { eventId: 1, channel: 'x', categories: ['CD', 'グッズ'] })).not.toContain('#');
  });
});
