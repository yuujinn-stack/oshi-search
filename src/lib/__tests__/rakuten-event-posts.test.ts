import { describe, it, expect } from 'vitest';
import { BANNED_PHRASES, INSTAGRAM_MAX, THREADS_MAX, X_MAX, findBannedPhrases, parseJstDateTimeLocal, xWeightedLength, type ItemCheckInfo, type RakutenEvent, type RakutenEventProduct } from '../rakuten-event/core';
import { PREVIEW_MARK, buildPersonLink, buildSiteLink, dealEvidence, generatePosts, personPath, postReadiness, threadsLength, type PostInput } from '../rakuten-event/posts';
import { candidateRegistered, fiveZeroCandidates, findDuplicateEvent, irregularCandidates } from '../rakuten-event/candidates';
import { candidatePriority } from '../rakuten-event/priority';

// 楽天イベントの投稿文（3つの型）・誤投稿の防止・イベント候補・重複登録・紹介候補の優先度
const JST = (s: string) => parseJstDateTimeLocal(s)!;
const NOW = JST('2026-11-05T12:00');

const event = (o: Partial<RakutenEvent> = {}): RakutenEvent => ({
  id: 7, name: '楽天お買い物マラソン（11月）', eventType: 'marathon',
  startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59'),
  officialUrl: 'https://event.rakuten.co.jp/campaign/point-up/marathon/', entryRequired: 'required', entryUrl: null,
  conditions: 'エントリーのうえ、ショップで買いまわり', benefit: 'ショップ買いまわりでポイント最大10倍', benefitConditions: '獲得上限あり',
  lastCheckedAt: JST('2026-11-05T09:00'), visibility: 'published', note: null, updatedBy: 'A', createdAt: 0, updatedAt: 0, ...o,
});
const link = (o: Partial<RakutenEventProduct> = {}): RakutenEventProduct => ({
  id: 1, eventId: 7, personName: '推しA', category: '写真集', productId: 'p1', productTitle: '推しA 1st写真集',
  checkStatus: 'needs_check', benefitScope: 'unknown', benefitNote: null, sourceUrl: null, checkedAt: null, checkedBy: null, note: null, updatedAt: 0, ...o,
});
const info = (o: Partial<ItemCheckInfo> = {}): ItemCheckInfo => ({
  itemCode: 'shop:p1', itemName: '', itemPrice: 3300, availability: 1, pointRate: 5, pointRateStartTime: '2026-11-04 20:00', pointRateEndTime: '2026-11-11 01:59',
  saleStartTime: null, saleEndTime: null, shopName: 'ショップ', fetchedAt: JST('2026-11-05T11:00'), ...o,
});
const person = { kind: 'person' as const, name: '推しA', path: personPath('推しA') };
const gen = (o: Partial<PostInput> = {}) => generatePosts({ event: event(), pattern: 'oshi', target: person, products: [], nowMs: NOW, ...o });
const texts = (p: ReturnType<typeof generatePosts>) => [p.x, p.threads, p.instagramFeed, p.instagramStory];
const confirmedA = link({ checkStatus: 'confirmed', benefitScope: 'item', sourceUrl: 'https://item.rakuten.co.jp/shop/p1/', checkedAt: NOW });

describe('3つの型の投稿文', () => {
  it('どの型も冒頭で内容を示し、イベント名・終了日時・PR表記・推しサーチへのリンク（UTM）を含む', () => {
    for (const pattern of ['info', 'oshi'] as const) {
      const p = gen({ pattern });
      expect(p.blocked).toBeNull();
      for (const t of texts(p)) {
        expect(t).toContain('楽天お買い物マラソン（11月）');
        expect(t).toContain('PR');
      }
      expect(p.x).toContain('11月11日(水) 1:59まで');
      expect(p.x).toContain(`utm_source=x&utm_medium=social&utm_campaign=rakuten_event_7&utm_content=${pattern}`);
      expect(p.threads).toContain('utm_source=threads');
    }
    expect(gen({ pattern: 'info' }).x.split('\n')[0]).toBe('【PR】楽天お買い物マラソン（11月）の参加前チェック');
    expect(gen({ pattern: 'oshi' }).x.split('\n')[0]).toBe('【PR】推しAを応援している方へ｜楽天お買い物マラソン（11月）');
  });

  it('情報提供型は対象なしでも作れる（トップへの案内）。推し別・お得速報は対象が必要', () => {
    expect(gen({ pattern: 'info', target: null }).x).toContain('https://oshi-search.jp/?utm_source=x');
    expect(gen({ pattern: 'oshi', target: null }).blocked).toMatch(/人物またはグループ/);
  });

  it('お得速報型：商品単体（A）で確認済み＋商品ページの確認元＋根拠（APIの倍率・価格 or 確認した特典）がある商品だけ', () => {
    expect(gen({ pattern: 'deal', products: [link()] }).blocked).toMatch(/お得速報型を作れる商品がありません/);
    // 購入者条件（C）・ショップ（B）は使わない
    expect(gen({ pattern: 'deal', products: [{ ...confirmedA, benefitScope: 'buyer_condition' }], apiInfo: { 1: info() } }).blocked).not.toBeNull();
    expect(gen({ pattern: 'deal', products: [{ ...confirmedA, benefitScope: 'shop' }], apiInfo: { 1: info() } }).blocked).not.toBeNull();
    // 根拠が無い（API なし・特典の内容なし）
    expect(gen({ pattern: 'deal', products: [confirmedA] }).blocked).not.toBeNull();
    const p = gen({ pattern: 'deal', products: [confirmedA], apiInfo: { 1: info() } });
    expect(p.blocked).toBeNull();
    expect(p.threads).toContain('・推しA 1st写真集：ポイント5倍（11/11 1:59まで）／3,300円（11/5 11:00時点）');
    expect(p.threads).toContain('価格・倍率は確認時点の情報で、変わることがあります');
    // 速報型でも終了日時を必ず入れる（X も）
    expect(p.x).toContain('11月11日(水) 1:59まで');
    expect(xWeightedLength(p.x)).toBeLessThanOrEqual(X_MAX);
    // API の倍率が終わっていれば根拠にしない
    expect(gen({ pattern: 'deal', products: [confirmedA], apiInfo: { 1: info({ pointRateEndTime: '2026-11-05 10:00' }) } }).blocked).not.toBeNull();
    // 管理者が確認した特典の内容だけでも可
    expect(gen({ pattern: 'deal', products: [{ ...confirmedA, benefitNote: 'ポイント5倍（商品ページに記載）' }] }).threads).toContain('ポイント5倍（商品ページに記載）');
  });

  it('価格は API で根拠（倍率・タイムセール）がある商品にだけ出し、要確認・購入者条件の商品は特典として書かない', () => {
    const p = gen({ pattern: 'oshi', products: [link(), { ...confirmedA, id: 2, productId: 'p2', productTitle: '推しA CD', benefitScope: 'buyer_condition' }], apiInfo: { 1: info(), 2: info() } });
    for (const t of texts(p)) {
      expect(t).not.toMatch(/\d+円/);
      expect(t).not.toContain('推しA 1st写真集');
      expect(t).not.toContain('推しA CD');
    }
    expect(p.warnings.join()).toMatch(/要確認/);
    expect(p.warnings.join()).toMatch(/購入者条件/);
    expect(p.threads).toContain('イベントの対象かは各商品ページでご確認ください');
    expect(dealEvidence({ ...confirmedA, benefitScope: 'item' }, info({ pointRate: 1 }), NOW)).toBeNull();
  });

  it('グループの投稿はメンバーの商品だけを使い、グループページへリンク', () => {
    const p = gen({
      pattern: 'deal', target: { kind: 'group', name: 'G1', path: '/groups/g1' }, memberNames: ['推しA'],
      products: [confirmedA, { ...confirmedA, id: 9, personName: '他G', productTitle: '別グループの商品' }], apiInfo: { 1: info(), 9: info() },
    });
    expect(p.threads).toContain('推しA 1st写真集');
    expect(p.threads).not.toContain('別グループの商品');
    expect(p.x).toContain('https://oshi-search.jp/groups/g1?utm_source=x');
    expect(p.x).toContain('#G1');
  });

  it('禁止表現は生成しない（入力に含まれる項目は外す・商品名にあれば外す）', () => {
    const p = gen({ e: undefined, event: event({ benefit: '今が一番安い！絶対お得' }), pattern: 'info' } as Partial<PostInput> & { e?: undefined });
    for (const t of texts(p)) expect(findBannedPhrases(t)).toEqual([]);
    expect(p.warnings.join()).toMatch(/一番安い/);
    const d = gen({ pattern: 'deal', products: [confirmedA, { ...confirmedA, id: 2, productTitle: '最安値の写真集' }], apiInfo: { 1: info(), 2: info() } });
    for (const t of texts(d)) for (const b of BANNED_PHRASES) expect(t).not.toContain(b);
  });

  it('文字数：X は280（URL23・日本語2）、Threads は500（絵文字はバイト数）、Instagram は2200 に収める', () => {
    const long = event({ name: 'あ'.repeat(30), conditions: 'い'.repeat(300), benefit: 'う'.repeat(300), benefitConditions: 'え'.repeat(100) });
    for (const pattern of ['info', 'oshi'] as const) {
      const p = gen({ event: long, pattern });
      expect(xWeightedLength(p.x)).toBeLessThanOrEqual(X_MAX);
      expect(threadsLength(p.threads)).toBeLessThanOrEqual(THREADS_MAX);
      expect(p.instagramFeed.length).toBeLessThanOrEqual(INSTAGRAM_MAX);
    }
    expect(threadsLength('あ👆')).toBe(1 + 4);
    // 必須の行だけで上限を超える（極端に長いイベント名）ときは警告（画面ではコピー不可）
    const tooLong = gen({ event: event({ name: 'あ'.repeat(100) }), pattern: 'info' });
    expect(xWeightedLength(tooLong.x)).toBeGreaterThan(X_MAX);
    expect(tooLong.warnings.join()).toMatch(/X の文字数が上限/);
  });

  it('Instagram フィードは URL を入れずプロフィールのリンクへ案内。ストーリーズのURLは本文と別', () => {
    const p = gen();
    expect(p.instagramFeed).not.toMatch(/https?:\/\//);
    expect(p.instagramFeed).toContain('プロフィールのリンク');
    expect(p.instagramStory).not.toMatch(/https?:\/\//);
    expect(p.storyLinkUrl).toBe(buildSiteLink(personPath('推しA'), { eventId: 7, channel: 'instagram_story', pattern: 'oshi', categories: [] }));
    expect(p.storyLinkUrl).toContain('utm_content=story_oshi');
  });

  it('楽天のアフィリエイトURLは投稿文に入れない', () => {
    const p = gen({ pattern: 'deal', products: [confirmedA], apiInfo: { 1: info() } });
    for (const t of [...texts(p), p.storyLinkUrl]) expect(t).not.toMatch(/hb\.afl\.rakuten|a\.r10\.to|item\.rakuten\.co\.jp/);
  });
});

describe('誤投稿の防止', () => {
  it('終了したイベントは作らない', () => {
    const p = gen({ nowMs: JST('2026-11-11T01:59') });
    expect(p.blocked).toMatch(/終了/);
    expect(texts(p).join('') + p.storyLinkUrl).toBe('');
  });
  it('非公開・公式未確認・テスト用の名前はプレビュー扱い（blockers）', () => {
    expect(postReadiness(event(), NOW).blockers).toEqual([]);
    expect(postReadiness(event({ visibility: 'hidden' }), NOW).blockers.join()).toMatch(/非公開/);
    expect(postReadiness(event({ lastCheckedAt: null }), NOW).blockers.join()).toMatch(/未確認/);
    expect(postReadiness(event({ name: '【動作確認】マラソン' }), NOW).blockers.join()).toMatch(/テスト用/);
    expect(PREVIEW_MARK).toMatch(/投稿しないでください/);
  });
  it('最終確認が古い・エントリー未確認・まもなく終了は警告', () => {
    const w = postReadiness(event({ lastCheckedAt: JST('2026-11-01T00:00'), entryRequired: 'unknown' }), JST('2026-11-10T23:30')).warnings.join('\n');
    expect(w).toMatch(/24時間以上/);
    expect(w).toMatch(/エントリー/);
    expect(w).toMatch(/3時間を切って/);
  });
});

describe('イベント候補', () => {
  it('5と0のつく日：その月の 5・10・15・20・25・30 日、00:00〜23:59、公式URL付き', () => {
    const c = fiveZeroCandidates(2026, 11);
    expect(c.map((x) => x.startsAt)).toEqual(['2026-11-05T00:00', '2026-11-10T00:00', '2026-11-15T00:00', '2026-11-20T00:00', '2026-11-25T00:00', '2026-11-30T00:00']);
    expect(c[0]).toMatchObject({ eventType: 'five_zero', name: '5と0のつく日（11月5日）', endsAt: '2026-11-05T23:59', officialUrl: 'https://event.rakuten.co.jp/campaign/card/pointday/' });
    expect(c[0].hint).toMatch(/公式ページで確認/);
  });
  it('2月は30日なし（うるう年も）', () => {
    expect(fiveZeroCandidates(2027, 2).map((x) => x.startsAt.slice(8, 10))).toEqual(['05', '10', '15', '20', '25']);
    expect(fiveZeroCandidates(2028, 2).length).toBe(5);
  });
  it('不定期のイベントは日時なし。公式URLが確認できないもの（ブラックフライデー等）は空', () => {
    const c = irregularCandidates(2026, 11);
    expect(c.map((x) => x.eventType)).toEqual(['marathon', 'super_sale', 'black_friday', 'other']);
    expect(c.every((x) => x.startsAt === '' && x.endsAt === '')).toBe(true);
    expect(c.find((x) => x.eventType === 'black_friday')?.officialUrl).toBe('');
    expect(c.find((x) => x.eventType === 'marathon')?.officialUrl).toMatch(/^https:\/\/event\.rakuten\.co\.jp\//);
  });
  it('重複登録：同じ種類で期間が重なれば重複（5と0・マラソン等）。クーポン・その他は名前と開始が同じときだけ', () => {
    const existing = [
      { id: 1, name: '5と0のつく日（11月5日）', eventType: 'five_zero' as const, startsAt: JST('2026-11-05T00:00'), endsAt: JST('2026-11-05T23:59') },
      { id: 2, name: 'マラソン', eventType: 'marathon' as const, startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59') },
      { id: 3, name: 'クーポンA', eventType: 'coupon' as const, startsAt: JST('2026-11-01T00:00'), endsAt: JST('2026-11-30T23:59') },
    ];
    const [c5, c10] = fiveZeroCandidates(2026, 11);
    expect(candidateRegistered(existing, c5)?.id).toBe(1);
    expect(candidateRegistered(existing, c10)).toBeNull();
    expect(findDuplicateEvent(existing, { name: '別名のマラソン', eventType: 'marathon', startsAt: JST('2026-11-10T00:00'), endsAt: JST('2026-11-12T00:00') })?.id).toBe(2);
    expect(findDuplicateEvent(existing, { name: 'マラソン', eventType: 'marathon', startsAt: JST('2026-11-11T01:59'), endsAt: JST('2026-11-12T00:00') })).toBeNull();
    expect(findDuplicateEvent(existing, { name: 'クーポンB', eventType: 'coupon', startsAt: JST('2026-11-01T00:00'), endsAt: JST('2026-11-30T23:59') })).toBeNull();
    expect(findDuplicateEvent(existing, { name: 'クーポンA', eventType: 'coupon', startsAt: JST('2026-11-01T00:00'), endsAt: JST('2026-11-02T00:00') })?.id).toBe(3);
    // 更新時は自分自身を除く
    expect(findDuplicateEvent(existing, { name: 'マラソン', eventType: 'marathon', startsAt: JST('2026-11-04T20:00'), endsAt: JST('2026-11-11T01:59') }, 2)).toBeNull();
  });
});

describe('紹介候補の優先度', () => {
  const base = { category: '写真集', verdict: 'related', isUsed: false, itemCode: 'shop:a', linkedStatus: null, api: { code: 'unchecked' as const } };
  it('理由を必ず返し、APIで倍率を確認した商品を上に・在庫なしや非掲載・中古を下に', () => {
    const high = candidatePriority({ ...base, api: { code: 'ok', info: info() } }, NOW);
    const plain = candidatePriority(base, NOW);
    const noStock = candidatePriority({ ...base, api: { code: 'ok', info: info({ availability: 0, pointRate: 1 }) } }, NOW);
    const unpublished = candidatePriority({ ...base, verdict: 'uncertain' }, NOW);
    const used = candidatePriority({ ...base, category: '中古', isUsed: true }, NOW);
    expect(high.score).toBeGreaterThan(plain.score);
    expect(plain.score).toBeGreaterThan(noStock.score);
    expect(plain.score).toBeGreaterThan(unpublished.score);
    expect(plain.score).toBeGreaterThan(used.score);
    expect(high.reasons.join()).toMatch(/ポイント5倍.*特典の確認は別途必要/);
    expect(high.level).toBe('high');
  });
  it('商品コードなしは減点しない（APIで確認できないだけ）', () => {
    const noCode = candidatePriority({ ...base, itemCode: null, api: { code: 'no_item_code' } }, NOW);
    expect(noCode.score).toBe(candidatePriority(base, NOW).score);
    expect(noCode.reasons.join()).toMatch(/商品ページで確認/);
  });
});

describe('Phase 1 互換', () => {
  it('buildPersonLink は人物ページ（1カテゴリならタブ）', () => {
    expect(buildPersonLink('推しA', { eventId: 1, channel: 'x', categories: ['CD', 'CD'] })).toMatch(/\/person\/%E6%8E%A8%E3%81%97A\?utm_source=x&utm_medium=social&utm_campaign=rakuten_event_1#products-cd$/);
    expect(buildPersonLink('推しA', { eventId: 1, channel: 'x', categories: ['CD', 'グッズ'] })).not.toContain('#');
  });
});
