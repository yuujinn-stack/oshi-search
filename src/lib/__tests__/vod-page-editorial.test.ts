import { describe, it, expect } from 'vitest';
import { VOD_PAGE_EDITORIAL, getVodPageEditorial } from '../vod-page-editorial';

const TARGET_SLUGS = ['hulu', 'dmm-tv', 'disney-plus'];

describe('VOD_PAGE_EDITORIAL — 対象範囲', () => {
  it('Hulu / DMM TV / Disney+ の3件のみ定義されている（他11サービスへ影響しない）', () => {
    expect(Object.keys(VOD_PAGE_EDITORIAL).sort()).toEqual([...TARGET_SLUGS].sort());
  });

  it('対象外のurlSlugはnullを返す', () => {
    expect(getVodPageEditorial('netflix')).toBeNull();
    expect(getVodPageEditorial('u-next')).toBeNull();
    expect(getVodPageEditorial('nogidoga')).toBeNull();
  });

  it('対象3サービスはgetVodPageEditorialで取得できる', () => {
    for (const slug of TARGET_SLUGS) {
      expect(getVodPageEditorial(slug)).not.toBeNull();
    }
  });
});

describe('VOD_PAGE_EDITORIAL — 導入文（uniqueValueBody）の独自性', () => {
  it('各サービスの導入文はおおよそ100〜250文字である', () => {
    for (const slug of TARGET_SLUGS) {
      const body = VOD_PAGE_EDITORIAL[slug]!.uniqueValueBody;
      expect(body.length).toBeGreaterThanOrEqual(80);
      expect(body.length).toBeLessThanOrEqual(260);
    }
  });

  it('3サービスの導入文はすべて異なる（同一テンプレートの単純置換になっていない）', () => {
    const bodies = TARGET_SLUGS.map((slug) => VOD_PAGE_EDITORIAL[slug]!.uniqueValueBody);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('料金・無料期間・作品総数など変動しやすい情報を含まない（審査対策目的の料金表を避ける方針）', () => {
    const volatileWords = ['円', '無料期間', 'キャンペーン', '同時視聴', 'ダウンロード台数'];
    for (const slug of TARGET_SLUGS) {
      const body = VOD_PAGE_EDITORIAL[slug]!.uniqueValueBody;
      for (const w of volatileWords) {
        expect(body.includes(w)).toBe(false);
      }
    }
  });
});

describe('VOD_PAGE_EDITORIAL — FAQ', () => {
  it('各サービスのFAQは2〜4問である', () => {
    for (const slug of TARGET_SLUGS) {
      const faq = VOD_PAGE_EDITORIAL[slug]!.faq;
      expect(faq.length).toBeGreaterThanOrEqual(2);
      expect(faq.length).toBeLessThanOrEqual(4);
    }
  });

  it('FAQの回答にサービス名（displayName相当）が含まれ、汎用テンプレートのまま置き忘れていない', () => {
    expect(VOD_PAGE_EDITORIAL['hulu']!.faq.some((f) => f.answer.includes('Hulu'))).toBe(true);
    expect(VOD_PAGE_EDITORIAL['dmm-tv']!.faq.some((f) => f.answer.includes('DMM TV'))).toBe(true);
    expect(VOD_PAGE_EDITORIAL['disney-plus']!.faq.some((f) => f.answer.includes('Disney+'))).toBe(true);
  });
});
