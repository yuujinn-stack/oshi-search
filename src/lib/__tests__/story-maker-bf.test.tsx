import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BF_FRAME_H,
  BF_MAX_ITEMS,
  BF_NO_CONDITION,
  BF_SALE_ID,
  BF_STORY_MAX_ITEMS,
  bfStoryItems,
  bfCategoryLine,
  bfPageItems,
  bfSaleCorner,
  bfSlideCount,
  calcDiscount,
  checkedAtLabel,
  isApprovalUsable,
  maxOffRate,
  parseYen,
  verifyBfItem,
  type BfApprovedItem,
  type BfSaleCandidate,
  type BfSlideData,
  type BfVerificationInput,
} from '@/lib/story-maker/bf-sale';
import { DEFAULT_DESIGN, STORY_TEMPLATES, bfStructureSlides, editSlotIndex, isBfTemplate, fillStoryText, getStoryTemplate, linkTargetOptions, structureSlides, type StoryTarget } from '@/lib/story-maker/templates';
import { computeStoryMetrics, parseStoryPostRecord, storyRecordsToCsv, StoryRecordError } from '@/lib/story-maker/metrics';
import { isAutoSupported, memberPickMode } from '@/lib/story-maker/auto';
import { findBannedPhrases } from '@/lib/rakuten-event/core';
import { StorySlide } from '@/app/admin/story-maker/StorySlide';

const DURING = Date.parse('2026-11-20T12:00:00+09:00');
const BEFORE = Date.parse('2026-11-19T19:59:00+09:00');
const AFTER = Date.parse('2026-11-25T01:59:00+09:00');

const candidate: BfSaleCandidate = {
  productId: 'p1',
  title: 'Snow Man LIVE TOUR Blu-ray 初回盤',
  section: 'Blu-ray・DVD',
  pageUrl: 'https://item.rakuten.co.jp/shop-a/item-1/',
  thumbUrl: null,
  storedPrice: 9900,
};
const okInput: BfVerificationInput = {
  priceLabel: '通常価格', regularPrice: '9,900', salePrice: '7920', sourceUrl: 'https://item.rakuten.co.jp/shop-a/item-1/?s-id=x',
  discountKind: 'price-cut', conditions: '', confirmed: true, checkedBy: '棚原',
};

function approvedItem(over: Partial<BfApprovedItem> = {}): BfApprovedItem {
  const r = verifyBfItem(candidate, okInput, DURING);
  if (!r.ok) throw new Error(r.errors.join());
  // 署名はサーバーが付ける（ここは形だけ。署名の検証は story-maker-bf-approval.test.ts）
  return { ...r.item, signature: '0'.repeat(64), ...over };
}

describe('楽天BF：承認欄の検証（推測で数字を作らない）', () => {
  it('入力された2つの価格だけから値下げ額・割引率（切り捨て）を計算する', () => {
    const r = verifyBfItem(candidate, okInput, DURING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item).toMatchObject({ regularPrice: 9900, salePrice: 7920, offAmount: 1980, offRate: 20, saleId: BF_SALE_ID, checkedBy: '棚原' });
    expect(calcDiscount(3000, 2001)).toEqual({ offAmount: 999, offRate: 33 }); // 33.3% → 33
    expect(calcDiscount(1000, 1).offRate).toBe(99); // 99.9% → 99（100%と書かない）
  });

  it('値下げが無い・価格が不正・確認元が商品ページでない・チェック/確認者なしは承認しない', () => {
    const bad = (patch: Partial<BfVerificationInput>) => verifyBfItem(candidate, { ...okInput, ...patch }, DURING);
    expect(bad({ salePrice: '9900' }).ok).toBe(false);
    expect(bad({ salePrice: '12000' }).ok).toBe(false);
    expect(bad({ regularPrice: '' }).ok).toBe(false);
    expect(bad({ regularPrice: '1000.5' }).ok).toBe(false);
    expect(bad({ regularPrice: '10000', salePrice: '9950' }).ok).toBe(false); // 0.5% は 1%未満
    expect(bad({ sourceUrl: 'https://event.rakuten.co.jp/campaign/point-up/blackfriday/' }).ok).toBe(false);
    expect(bad({ sourceUrl: 'https://hb.afl.rakuten.co.jp/hgc/xxx/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop-a%2Fitem-1%2F' }).ok).toBe(false);
    expect(bad({ sourceUrl: 'https://item.rakuten.co.jp/shop-b/other/' }).ok).toBe(false); // 別の商品のページ
    expect(bad({ confirmed: false }).ok).toBe(false);
    expect(bad({ checkedBy: '  ' }).ok).toBe(false);
  });

  it('ポイント倍率・買いまわりだけ・クーポン時だけの商品は値引き商品として承認しない。根拠URL・確認日時・適用条件を持つ', () => {
    const bad = (patch: Partial<BfVerificationInput>) => verifyBfItem(candidate, { ...okInput, ...patch }, DURING);
    const points = bad({ discountKind: 'points-only' });
    expect(points.ok).toBe(false);
    if (!points.ok) expect(points.errors.join()).toContain('ポイント倍率・買いまわり');
    expect(bad({ discountKind: 'coupon-only' }).ok).toBe(false);
    expect(bad({ discountKind: '' }).ok).toBe(false);
    // 条件付きの値下げは適用条件が必須
    expect(bad({ discountKind: 'price-cut-conditional', conditions: ' ' }).ok).toBe(false);
    const cond = bad({ discountKind: 'price-cut-conditional', conditions: '先着500個限定' });
    expect(cond.ok && cond.item).toMatchObject({ discountKind: 'price-cut-conditional', conditions: '先着500個限定', sourceUrl: okInput.sourceUrl, checkedAt: new Date(DURING).toISOString() });
    const plainCut = bad({});
    expect(plainCut.ok && plainCut.item.conditions).toBe(BF_NO_CONDITION);
  });

  it('商品データに商品ページが無い候補は、楽天の商品ページURLなら確認元にできる', () => {
    const r = verifyBfItem({ ...candidate, pageUrl: null }, { ...okInput, sourceUrl: 'https://books.rakuten.co.jp/rb/12345678/' }, DURING);
    expect(r.ok).toBe(true);
  });

  it('セールの開催中だけ承認でき、24時間・セール終了で使えなくなる', () => {
    expect(verifyBfItem(candidate, okInput, BEFORE).ok).toBe(false);
    expect(verifyBfItem(candidate, okInput, AFTER).ok).toBe(false);
    const item = approvedItem();
    expect(isApprovalUsable(item, DURING + 60_000)).toBe(true);
    expect(isApprovalUsable(item, DURING + 24 * 3600_000)).toBe(false);
    expect(isApprovalUsable(item, AFTER)).toBe(false);
    expect(isApprovalUsable({ ...item, saleId: 'other-sale' }, DURING)).toBe(false);
    expect(isApprovalUsable({ ...item, checkedAt: new Date(BEFORE).toISOString() }, DURING)).toBe(false);
  });

  it('最大割引率は渡した（採用した）商品だけから。商品が無ければ数字を出さない', () => {
    expect(maxOffRate([])).toBeNull();
    expect(maxOffRate([{ offRate: 20 }, { offRate: 35 }, { offRate: 10 }])).toBe(35);
    expect(parseYen('¥1,980')).toBe(1980);
    expect(parseYen('1980円')).toBe(1980);
    expect(parseYen('0')).toBeNull();
    expect(parseYen('-5')).toBeNull();
    expect(checkedAtLabel([{ checkedAt: '2026-11-20T03:05:00.000Z' }, { checkedAt: '2026-11-20T05:00:00.000Z' }])).toBe('11/20 12:05');
  });

  it('セール期間はトップの特設コーナーと同じ設定（SALE_CORNERS）を使う', () => {
    const sale = bfSaleCorner();
    expect(sale?.startsAt).toBe(Date.parse('2026-11-19T20:00:00+09:00'));
    expect(sale?.endsAt).toBe(AFTER);
  });
});

describe('楽天BF：テンプレートと投稿データ', () => {
  it('商品3件まで3枚・4〜6件で4枚（表紙＋商品ページ1〜2枚＋最終ページ）。商品は1ページ3件', () => {
    expect([0, 1, 3, 4, 6].map(bfSlideCount)).toEqual([3, 3, 3, 4, 4]);
    expect(BF_MAX_ITEMS).toBe(6);
    expect(bfStructureSlides(2).map((d) => d.layout)).toEqual(['bf-cover', 'bf-products', 'bf-products', 'bf-final']);
    expect(bfPageItems([1, 2, 3, 4, 5], 0)).toEqual([1, 2, 3]);
    expect(bfPageItems([1, 2, 3, 4, 5], 1)).toEqual([4, 5]);
    // 文言の編集はページの種類で持つ（商品ページが増えても最終ページの文言がずれない）
    expect(bfStructureSlides(2).map((d, i) => editSlotIndex(d, i))).toEqual([0, 1, 1, 2]);
    expect(structureSlides(getStoryTemplate('goods'), 3).map((d, i) => editSlotIndex(d, i))).toEqual([0, 1, 2]);
  });

  it('既存5テンプレートの後ろに、フィード（1350）の固定テンプレートとして追加する', () => {
    expect(STORY_TEMPLATES.map((t) => t.id)).toEqual(['vod', 'goods', 'request', 'card', 'goodsmaking', 'bf', 'bfstory']);
    const bf = getStoryTemplate('bf');
    expect(bf.title).toBe('楽天BF・推し別セール紹介');
    expect(bf.fixed).toBe(true);
    expect(bf.frameHeight).toBe(BF_FRAME_H);
    for (const n of [1, 2, 3] as const) expect(structureSlides(bf, n).map((d) => d.layout)).toEqual(['bf-cover', 'bf-products', 'bf-final']);
    expect(STORY_TEMPLATES.filter((t) => t.id !== 'bf' && t.id !== 'bfstory').every((t) => !t.fixed && t.frameHeight === undefined)).toBe(true);
    expect(isAutoSupported('bf')).toBe(false);
    expect(memberPickMode('bf', { type: 'group', name: 'Snow Man', pagePath: '/groups/snow-man' })).toBeNull();
  });

  it('プロフィールのリンク用のURLは人物・グループページ（公開ページ）', () => {
    const g: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snow-man' };
    expect(linkTargetOptions('bf', g).map((o) => o.path)).toEqual(['/groups/snow-man', '/']);
  });

  it('投稿データの記録に承認内容を保存し、不正な内容は保存しない', () => {
    const base = {
      id: 'abcdef123', postedAt: '2026-11-20T20:00', templateId: 'bf', targetName: 'Snow Man', targetType: 'group', slideCount: 3,
      reach: [], linkSlide: 3, utmCampaign: 'story_bf_sale', utmContent: 'snowman_3p', url: 'https://oshi-search.jp/groups/snow-man',
    };
    const item = approvedItem();
    const rec = parseStoryPostRecord({ ...base, saleItems: [item] });
    expect(rec.saleItems?.[0]).toMatchObject({ regularPrice: 9900, salePrice: 7920, offRate: 20, sourceUrl: item.sourceUrl, checkedBy: '棚原' });
    // 割引率は保存時にも価格から計算し直す（送られた値を信用しない）
    expect(parseStoryPostRecord({ ...base, saleItems: [{ ...item, offRate: 90 }] }).saleItems?.[0].offRate).toBe(20);
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, salePrice: 9900 }] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, sourceUrl: 'https://example.com/' }] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, saleItems: Array(7).fill(item) })).toThrow(StoryRecordError);
    expect(parseStoryPostRecord({ ...base, saleItems: Array(6).fill(item) }).saleItems).toHaveLength(6);
    // 根拠URL・確認日時・適用条件を保存し、ポイント・クーポンだけの商品・種類の無い記録は保存しない
    expect(rec.saleItems?.[0]).toMatchObject({ discountKind: 'price-cut', conditions: BF_NO_CONDITION, checkedAt: item.checkedAt });
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, discountKind: 'points-only' }] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, discountKind: undefined }] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, discountKind: 'price-cut-conditional', conditions: '' }] })).toThrow(StoryRecordError);
    // 他のテンプレートには付けない
    expect(parseStoryPostRecord({ ...base, templateId: 'goods', slideCount: 1, linkSlide: 1, saleItems: [item] }).saleItems).toBeUndefined();
  });

  it('4枚の記録は楽天BFだけ。既存の1〜3枚の記録の形（リーチ3つ）・CSVの列は変わらない', () => {
    const base = {
      id: 'abcdef123', postedAt: '2026-11-20T20:00', templateId: 'bf', targetName: 'Snow Man', targetType: 'group',
      linkSlide: 4, utmCampaign: 'story_bf_sale', utmContent: 'snowman_3p', url: 'https://oshi-search.jp/groups/snow-man',
    };
    const rec4 = parseStoryPostRecord({ ...base, slideCount: 4, reach: [1000, 800, 600, 500], linkTaps: 20 });
    expect(rec4.slideCount).toBe(4);
    expect(rec4.reach).toEqual([1000, 800, 600, 500]);
    expect(computeStoryMetrics(rec4).retention).toBe(0.5);
    expect(computeStoryMetrics(rec4).linkReach).toBe(500);
    expect(() => parseStoryPostRecord({ ...base, slideCount: 5, reach: [] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, templateId: 'goods', slideCount: 4, reach: [] })).toThrow('投稿枚数は1〜3枚です。');
    // 既存（3枚以下）の記録はリーチ3つのまま
    const old = parseStoryPostRecord({ ...base, templateId: 'goods', slideCount: 2, linkSlide: 2, reach: [100, 80, 999] });
    expect(old.reach).toEqual([100, 80, null]);
    const csvOld = storyRecordsToCsv([old]);
    expect(csvOld.split('\n')[0]).not.toContain('4枚目リーチ');
    expect(csvOld.split('\n')[0].split(',')).toHaveLength(19);
    const csv4 = storyRecordsToCsv([old, rec4]).split('\n');
    expect(csv4[0].endsWith(',4枚目リーチ')).toBe(true);
    expect(csv4[2].endsWith(',500')).toBe(true);
    expect(csv4[1].endsWith(',')).toBe(true);
  });
});

describe('楽天BF：画像（黒×ゴールド・1080×1350）', () => {
  const bf = getStoryTemplate('bf');
  const target: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snow-man' };
  const items = [
    { ...approvedItem(), imageSrc: 'data:image/png;base64,AAAA' },
    { ...approvedItem({ productId: 'p2', title: '写真集', section: '写真集・書籍', priceLabel: 'メーカー希望小売価格', regularPrice: 3300, salePrice: 2310, offAmount: 990, offRate: 30 }), imageSrc: null },
  ];
  const sale: BfSlideData = { items, maxRate: maxOffRate(items), periodLabel: '11/19 20:00〜11/25 1:59', checkedLabel: '11/20 12:00' };
  const render = (i: number, s: BfSlideData | undefined = sale) => {
    const def = structureSlides(bf, 3)[i];
    const text = Object.fromEntries(Object.entries(def.text).map(([k, v]) => [k, fillStoryText(v, target)])) as unknown as typeof def.text;
    return renderToStaticMarkup(<StorySlide decoration={bf.decoration} def={def} text={text} design={DEFAULT_DESIGN} index={i} total={3} image={null} showGuide templateId="bf" sale={s} />);
  };
  const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

  it('表紙：名前と、採用した商品から計算した最大割引率を大きく表示する', () => {
    const html = render(0);
    expect(html).toContain('height:1350px');
    expect(plain(html)).toContain('Snow Man');
    expect(plain(html)).toMatch(/最大 30 %OFF/);
    expect(plain(html)).toContain('楽天ブラックフライデー');
    expect(plain(html)).toContain('PR（楽天アフィリエイト広告を含みます）');
    // 承認済みの商品が無いときは割引率の数字を出さない
    expect(plain(render(0, { ...sale, items: [], maxRate: null }))).not.toMatch(/\d+ ?%OFF/);
  });

  it('商品ページ：画像・価格の表記・セール価格・値下げ額・割引率。画像が無い商品は架空の画像を描かない', () => {
    const text = plain(render(1));
    expect(text).toContain('通常価格 ¥9,900');
    expect(text).toContain('¥7,920');
    expect(text).toContain('¥1,980 OFF');
    expect(text).toContain('20%OFF');
    expect(text).toContain('メーカー希望小売価格 ¥3,300'); // 表記を「通常価格」に書き換えない
    expect(text).toContain('11/20 12:00時点で楽天の商品ページで確認');
    expect(render(1).match(/<img /g)?.length).toBe(1);
  });

  it('最終ページ：プロフィールのリンクから推しサーチへ。ガイド・リンクスタンプの枠は描かない', () => {
    const html = render(2);
    expect(plain(html)).toContain('プロフィールのリンクから');
    expect(plain(html)).toContain('推しサーチ');
    expect(html).not.toContain('data-guide');
  });

  it('商品4〜6件：商品ページ2枚（1ページ目に1〜3件目・2ページ目に4〜6件目）。条件付きの値下げは適用条件を出す', () => {
    const six = Array.from({ length: 5 }, (_, n) => ({ ...approvedItem({ productId: `q${n}`, title: `商品${n + 1}番`, offRate: 10 + n }), imageSrc: null }));
    six[4] = { ...six[4], discountKind: 'price-cut-conditional', conditions: '先着500個限定' };
    const s6: BfSlideData = { ...sale, items: six, maxRate: maxOffRate(six) };
    const defs = bfStructureSlides(2);
    const r = (i: number) => {
      const def = defs[i];
      const text = Object.fromEntries(Object.entries(def.text).map(([k, v]) => [k, fillStoryText(v, target)])) as unknown as typeof def.text;
      return plain(renderToStaticMarkup(<StorySlide decoration={bf.decoration} def={def} text={text} design={DEFAULT_DESIGN} index={i} total={4} image={null} showGuide={false} templateId="bf" sale={s6} />));
    };
    expect(r(0)).toMatch(/最大 14 %OFF/);
    expect(r(0)).toContain('1 / 4');
    expect(r(1)).toContain('（1/2）');
    expect(r(1)).toContain('商品1番');
    expect(r(1)).toContain('商品3番');
    expect(r(1)).not.toContain('商品4番');
    expect(r(2)).toContain('（2/2）');
    expect(r(2)).toContain('商品4番');
    expect(r(2)).toContain('条件：先着500個限定');
    expect(r(2)).not.toContain('商品1番');
    expect(r(1)).not.toContain('条件：'); // 条件なしの値下げには出さない
    expect(r(3)).toContain('プロフィールのリンクから');
    for (const i of [0, 1, 2, 3]) expect(findBannedPhrases(r(i))).toEqual([]);
  });

  it('デザイン：表紙は採用した商品の種類だけを出す。商品画像は縦横比を保ち文字を重ねない。最終ページに矢印を使わない', () => {
    expect(bfCategoryLine(['Blu-ray・DVD', '写真集・書籍', 'グッズ', '写真集・書籍'])).toBe('写真集 / DVD・Blu-ray / グッズ');
    expect(bfCategoryLine(['本・写真集', 'CD'])).toBe('写真集 / CD');
    expect(bfCategoryLine([])).toBe('写真集 / DVD・Blu-ray / グッズ');
    const cover = plain(render(0));
    expect(cover).toContain('写真集 / DVD・Blu-ray'); // サンプルの2件（Blu-ray・写真集）
    expect(cover).not.toContain('グッズ /');
    expect(cover).toContain('Snow Man');
    const products = render(1);
    // 画像の枠の中は画像だけ（文字を重ねない）・contain で縦横比を保つ
    const imgBox = products.match(/<div style="[^"]*background:#FFFFFF[^"]*">(.*?)<\/div>/)?.[1] ?? '';
    expect(imgBox).toMatch(/^<img [^>]*object-fit:contain[^>]*\/>$/);
    expect(products).toContain('background:#E0262E'); // 割引率の赤いバッジ
    const final = plain(render(2));
    expect(final).not.toMatch(/[↑⬆]/);
    expect(final).toContain('oshi-search.jp');
  });

  it('楽天イベント管理の禁止表現（最安・今だけ・値下げ 等）を画像に入れない', () => {
    for (const i of [0, 1, 2]) expect(findBannedPhrases(plain(render(i)))).toEqual([]);
  });
});

describe('楽天BF：ストーリーズ版（1080×1920・2枚）', () => {
  const tpl = getStoryTemplate('bfstory');
  const target: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snow-man' };
  const five = Array.from({ length: 5 }, (_, n) => ({ ...approvedItem({ productId: `q${n}`, title: `商品${n + 1}番`, offRate: 10 + n * 5 }), imageSrc: n === 0 ? 'data:image/png;base64,AAAA' : null }));
  five[1] = { ...five[1], discountKind: 'price-cut-conditional', conditions: '先着500個限定' };
  const shown = bfStoryItems(five);
  const sale: BfSlideData = { items: shown, maxRate: maxOffRate(shown), periodLabel: '11/19 20:00〜11/25 1:59', checkedLabel: '11/20 12:00' };
  const defs = structureSlides(tpl, tpl.defaultSlides);
  const render = (i: number, guide = false, s: BfSlideData = sale) => {
    const def = defs[i];
    const text = Object.fromEntries(Object.entries(def.text).map(([k, v]) => [k, fillStoryText(v, target)])) as unknown as typeof def.text;
    return renderToStaticMarkup(<StorySlide decoration={tpl.decoration} def={def} text={text} design={DEFAULT_DESIGN} index={i} total={defs.length} image={null} showGuide={guide} templateId="bfstory" sale={s} />);
  };
  const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

  it('フィード版と承認欄・記録を共通で使う、2枚固定・1920 のテンプレート', () => {
    expect(tpl.title).toBe('楽天BF・推し別セール紹介（ストーリーズ）');
    expect(tpl.fixed).toBe(true);
    expect(tpl.frameHeight).toBeUndefined(); // 1920（ストーリーズ）
    expect(defs.map((d) => d.layout)).toEqual(['bfs-cover', 'bfs-products']);
    expect(defs.map((d) => d.sticker)).toEqual(['none', 'link']);
    expect(isBfTemplate('bfstory') && isBfTemplate('bf') && !isBfTemplate('goods')).toBe(true);
    expect(isAutoSupported('bfstory')).toBe(false);
    expect(linkTargetOptions('bfstory', target).map((o) => o.path)).toEqual(['/groups/snow-man', '/']);
    // 投稿記録にも承認内容を保存し、不正な内容は保存しない（フィード版と同じ検証）
    const base = { id: 'abcdef123', postedAt: '2026-11-20T20:00', templateId: 'bfstory', targetName: 'Snow Man', targetType: 'group', slideCount: 2, linkSlide: 2, reach: [100, 80] };
    const item = approvedItem();
    expect(parseStoryPostRecord({ ...base, saleItems: [item] }).saleItems?.[0].offRate).toBe(20);
    expect(() => parseStoryPostRecord({ ...base, saleItems: [{ ...item, discountKind: 'points-only' }] })).toThrow(StoryRecordError);
    expect(() => parseStoryPostRecord({ ...base, slideCount: 4, reach: [] })).toThrow('投稿枚数は1〜3枚です。');
  });

  it('商品は先頭3件まで。最大割引率も載せる3件だけから出す', () => {
    expect(BF_STORY_MAX_ITEMS).toBe(3);
    expect(shown.map((i) => i.productId)).toEqual(['q0', 'q1', 'q2']);
    expect(sale.maxRate).toBe(20); // q3（25%）・q4（30%）は載せないので含めない
    const products = plain(render(1));
    expect(products).toContain('商品1番');
    expect(products).toContain('商品3番');
    expect(products).not.toContain('商品4番');
    expect(products).toContain('条件：先着500個限定');
  });

  it('1枚目：名前・楽天ブラックフライデー・最大割引率・PR。承認済みの商品が無ければ数字を出さない', () => {
    const html = render(0);
    expect(html).toContain('height:1920px');
    const t = plain(html);
    expect(t).toContain('Snow Man');
    expect(t).toContain('楽天ブラックフライデー');
    expect(t).toMatch(/最大 20 %OFF/);
    expect(t).toContain('PR（楽天アフィリエイト広告を含みます）');
    expect(plain(render(0, false, { ...sale, items: [], maxRate: null }))).not.toMatch(/\d+ ?%OFF/);
  });

  it('1枚目は「次のストーリーで商品をチェック」。価格の注意書きは確認日時・確認元・変わる可能性・購入前の確認を含む。商品名は3行まで（条件ありは2行）', () => {
    expect(plain(render(0))).toContain('次のストーリーで商品をチェック ▶');
    const html = render(1);
    const t = plain(html);
    expect(t).toContain('※価格は11/20 12:00時点で楽天の商品ページで確認');
    expect(t).toContain('価格・在庫・セール対象は変わる場合があります');
    expect(t).toContain('購入前に商品ページをご確認ください');
    expect(html).toContain('-webkit-line-clamp:3');
    expect(html).toContain('-webkit-line-clamp:2');
    expect(html).not.toContain('word-break:break-all');
  });

  it('2枚目：リンクスタンプへの誘導とPR。スタンプの枠・UIのガイドはガイド表示のときだけ（保存画像には入れない）', () => {
    const t = plain(render(1));
    expect(t).toContain('リンクスタンプから商品をチェック');
    expect(t).toContain('PR（楽天アフィリエイト広告を含みます）');
    expect(render(1)).not.toContain('data-guide');
    expect(render(1, true)).toContain('ここにリンクスタンプ');
    for (const i of [0, 1]) expect(findBannedPhrases(plain(render(i)))).toEqual([]);
  });
});
