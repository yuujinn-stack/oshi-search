import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  COLOR_PRESETS,
  DEFAULT_DESIGN,
  SLIDE_COUNTS,
  STORY_TEMPLATES,
  fillStoryText,
  getStoryTemplate,
  linkTargetOptions,
  screenshotPathOptions,
  type SlideText,
  type StoryTarget,
} from '@/lib/story-maker/templates';
import { appendUtm, buildStoryUtm, isSiteUrl, sanitizeUtmValue, storyFileName, storyZipName, suggestTargetKey } from '@/lib/story-maker/utm';
import { applyAbVariant, type StoryVariantConfig } from '@/lib/story-maker/ab';
import {
  computeStoryMetrics,
  parseStoryPostRecord,
  ratio,
  StoryRecordError,
  storyRecordsToCsv,
  summarizeAbTests,
  type StoryPostRecord,
} from '@/lib/story-maker/metrics';
import { isAllowedScreenshotPath } from '@/lib/story-maker/screenshot-path';
import { SAFE_BOTTOM, SAFE_TOP, StorySlide, fitFontSize, stickerZone, visualWidth } from '@/app/admin/story-maker/StorySlide';

const milk: StoryTarget = { type: 'group', name: 'M!LK', pagePath: '/groups/M!LK' };
const person: StoryTarget = { type: 'person', name: '山田花子', pagePath: `/person/${encodeURIComponent('山田花子')}` };

describe('story-maker templates', () => {
  it('has the 5 templates with the requested default slide counts', () => {
    expect(STORY_TEMPLATES.map((t) => [t.id, t.defaultSlides])).toEqual([
      ['vod', 2], ['goods', 1], ['request', 1], ['card', 2], ['goodsmaking', 3],
    ]);
  });

  it('defines 1/2/3-slide structures with exactly one sticker on the last page', () => {
    for (const t of STORY_TEMPLATES) {
      for (const n of SLIDE_COUNTS) {
        const s = t.structures[n];
        expect(s).toHaveLength(n);
        expect(s[n - 1].sticker).toBe(t.id === 'request' ? 'question' : 'link');
        expect(s.filter((d) => d.sticker !== 'none')).toHaveLength(1);
        // リンクのあるページには CTA 文言がある
        for (const d of s) if (d.sticker === 'link') expect(d.text.cta.trim()).not.toBe('');
      }
    }
  });

  it('keeps the requested copy', () => {
    const vod = getStoryTemplate('vod').structures[2];
    expect(fillStoryText(vod[0].text.heading, milk)).toBe('M!LK推しの人！');
    expect(vod[0].text.subheading.replace(/\n/g, '')).toBe('出演作品、どこのサブスクで見られるか毎回調べてない？');
    expect(vod[1].text.heading.replace(/\n/g, '')).toBe('推しを選ぶだけでサブスクを比較！');
    expect(vod[1].text.cta).toBe('無料で診断する');
    expect(getStoryTemplate('goods').structures[1][0].text.cta).toBe('関連商品を見る');
    expect(getStoryTemplate('request').structures[1][0].text.heading.replace(/\n/g, '')).toBe('あなたの推しを教えて♡');
    expect(getStoryTemplate('card').structures[2][1].text.heading.replace(/\n/g, '')).toBe('あなたも推しのカードを作ってみない？');
    expect(getStoryTemplate('card').structures[2][1].text.cta).toBe('無料でカードを作る');
    expect(getStoryTemplate('goodsmaking').structures[3][2].text.cta).toBe('グッズ制作サービスを比較');
  });

  it('never asks for a 推し投票 in the request template', () => {
    const all = JSON.stringify(getStoryTemplate('request').structures);
    expect(all).not.toMatch(/投票|ランキング/);
  });

  it('requires a real screen where the template shows the site', () => {
    expect(getStoryTemplate('vod').structures[2][1].image).toBe('required');
    expect(getStoryTemplate('goods').structures[1][0].image).toBe('required');
    expect(getStoryTemplate('card').structures[2][0].image).toBe('required');
  });

  it('fills names and falls back to generic words without a target', () => {
    expect(fillStoryText('{name推し}の人！', null)).toBe('推し活中の人！');
    expect(fillStoryText('{name}の写真集', null)).toBe('推しの写真集');
    expect(fillStoryText('{name}の写真集', person)).toBe('山田花子の写真集');
  });

  it('links only to existing public pages', () => {
    expect(linkTargetOptions('vod', person)[0].path).toBe(`/oshi-vod?with=${encodeURIComponent('山田花子')}#oshi-vod-picker`);
    expect(linkTargetOptions('vod', milk)[0].path).toBe(`/oshi-vod?group=${encodeURIComponent('M!LK')}#oshi-vod-picker`);
    expect(linkTargetOptions('vod', null).map((o) => o.path)).toEqual(['/oshi-vod']);
    expect(linkTargetOptions('goods', milk)[0].path).toBe('/groups/M!LK');
    expect(linkTargetOptions('goods', person).find((o) => o.id === 'shopping-p')?.warning).toBeTruthy();
    expect(linkTargetOptions('card', person)[0].path).toBe(`/oshi-card?p=${encodeURIComponent('山田花子')}`);
    expect(linkTargetOptions('goodsmaking', null)[0].path).toBe('/oshikatsu/goods-making');
    // スクリーンショット候補は撮影が許可されたページだけ・注意つきの誘導先（お買い物診断）は除く
    for (const t of STORY_TEMPLATES) for (const target of [null, milk, person]) {
      for (const o of [...screenshotPathOptions(t.id, 'screen', target), ...screenshotPathOptions(t.id, 'card', target)]) {
        expect(isAllowedScreenshotPath(o.path)).toBe(true);
        expect(o.path).not.toContain('#');
      }
    }
  });
});

describe('story-maker UTM', () => {
  it('builds identifiable UTM values', () => {
    const tpl = getStoryTemplate('vod');
    expect(buildStoryUtm(tpl, 'milk', 2, null)).toEqual({ source: 'instagram', medium: 'social', campaign: 'story_vod', content: 'milk_2p' });
    expect(buildStoryUtm(tpl, 'milk', 1, { test: 'cta', variant: 'a' }).content).toBe('milk_cta_a');
    expect(buildStoryUtm(getStoryTemplate('goodsmaking'), '', 3, null)).toMatchObject({ campaign: 'story_goods_making', content: 'all_3p' });
  });

  it('suggests ASCII target keys', () => {
    expect(suggestTargetKey(milk)).toBe('milk');
    expect(suggestTargetKey({ ...milk, slug: 'milk-official' })).toBe('milk-official');
    expect(suggestTargetKey({ type: 'group', name: '櫻坂46', pagePath: '/groups/sakurazaka46' })).toBe('sakurazaka46');
    expect(suggestTargetKey({ type: 'group', name: 'FRUITS ZIPPER', pagePath: '' })).toBe('fruits-zipper');
    const jp = suggestTargetKey(person);
    expect(jp).toMatch(/^t[0-9a-z]{6}$/);
    expect(suggestTargetKey(person)).toBe(jp); // 同じ名前なら同じ値
    expect(suggestTargetKey(null)).toBe('all');
    expect(sanitizeUtmValue(' Ｍ!LK ＆ Co ')).toBe('mlk-co');
  });

  it('keeps existing query and hash when appending UTM', () => {
    const utm = buildStoryUtm(getStoryTemplate('vod'), 'milk', 2, null);
    const url = new URL(appendUtm(`/oshi-vod?with=${encodeURIComponent('山田花子')}#oshi-vod-picker`, utm));
    expect(url.origin).toBe('https://oshi-search.jp');
    expect(url.pathname).toBe('/oshi-vod');
    expect(url.searchParams.get('with')).toBe('山田花子');
    expect(url.searchParams.get('utm_source')).toBe('instagram');
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('story_vod');
    expect(url.searchParams.get('utm_content')).toBe('milk_2p');
    expect(url.hash).toBe('#oshi-vod-picker');
    expect(appendUtm('/oshi-vod', utm).indexOf('#')).toBe(-1);
  });

  it('overwrites old utm params instead of duplicating them', () => {
    const utm = buildStoryUtm(getStoryTemplate('vod'), 'milk', 2, null);
    const out = appendUtm('https://oshi-search.jp/oshi-vod?utm_source=x&utm_content=old&a=1', utm);
    const u = new URL(out);
    expect(u.searchParams.getAll('utm_source')).toEqual(['instagram']);
    expect(u.searchParams.getAll('utm_content')).toEqual(['milk_2p']);
    expect(u.searchParams.get('a')).toBe('1');
  });

  it('detects site URLs and makes file names', () => {
    expect(isSiteUrl('/oshi-vod')).toBe(true);
    expect(isSiteUrl('https://example.com/')).toBe(false);
    const tpl = getStoryTemplate('vod');
    expect(storyFileName(tpl, 'milk', 0, null)).toBe('story_vod_milk_01.png');
    expect(storyFileName(tpl, 'milk', 1, null)).toBe('story_vod_milk_02.png');
    expect(storyFileName(tpl, 'milk', 0, { test: 'bg', variant: 'b' })).toBe('story_vod_milk_bg_b_01.png');
    expect(storyZipName(tpl, 'milk', null)).toBe('story_vod_milk.zip');
  });
});

describe('story-maker A/B', () => {
  const base: StoryVariantConfig = { slides: 2, design: DEFAULT_DESIGN, ctaOverride: null };
  it('changes only the tested dimension', () => {
    expect(applyAbVariant(base, null, 'b')).toBe(base);
    const ab = (test: 'slides' | 'link' | 'cta' | 'bg') => ({ test, ctaA: '詳しくはこちら', ctaB: '無料で診断する' });
    expect([applyAbVariant(base, ab('slides'), 'a').slides, applyAbVariant(base, ab('slides'), 'b').slides]).toEqual([1, 3]);
    expect([applyAbVariant(base, ab('link'), 'a').design.linkPos, applyAbVariant(base, ab('link'), 'b').design.linkPos]).toEqual([50, 60]);
    expect(applyAbVariant(base, ab('bg'), 'a').design.colors).toEqual(COLOR_PRESETS.yellow.colors);
    expect(applyAbVariant(base, ab('bg'), 'b').design.colors).toEqual(COLOR_PRESETS.pink.colors);
    expect(applyAbVariant(base, ab('cta'), 'a').ctaOverride).toBe('詳しくはこちら');
    expect(applyAbVariant(base, { ...ab('cta'), ctaB: '  ' }, 'b').ctaOverride).toBeNull();
    // テスト対象以外は同じ
    const b = applyAbVariant(base, ab('link'), 'b');
    expect(b.slides).toBe(2);
    expect(b.design.colors).toEqual(base.design.colors);
  });
});

function rec(p: Partial<StoryPostRecord>): StoryPostRecord {
  return parseStoryPostRecord({
    id: 'abcdef123', postedAt: '2026-11-14T20:00', templateId: 'vod', targetName: 'M!LK', targetType: 'group',
    slideCount: 3, abTest: null, abVariant: null, utmCampaign: 'story_vod', utmContent: 'milk_3p', url: 'https://oshi-search.jp/oshi-vod',
    reach: [1000, 800, 600], linkSlide: 3, linkTaps: 30, linkSlideReach: null, ga4Sessions: 20, memo: '', ...p,
  }, new Date('2026-11-14T12:00:00Z'));
}

describe('story-maker metrics', () => {
  it('computes retention, tap rate and arrival rate', () => {
    const m = computeStoryMetrics(rec({}));
    expect(m.retention).toBeCloseTo(0.6);
    expect(m.stepRetention[0]).toBeCloseTo(0.8);
    expect(m.stepRetention[1]).toBeCloseTo(0.75);
    expect(m.linkReach).toBe(600);
    expect(m.tapRate).toBeCloseTo(0.05);
    expect(m.arrivalRate).toBeCloseTo(20 / 30);
    expect(computeStoryMetrics(rec({ linkSlideReach: 500 })).tapRate).toBeCloseTo(0.06);
  });

  it('does not guess missing values', () => {
    const m = computeStoryMetrics(rec({ reach: [1000, null, null], linkTaps: null, ga4Sessions: null }));
    expect(m.retention).toBeNull();
    expect(m.tapRate).toBeNull();
    expect(m.arrivalRate).toBeNull();
    expect(computeStoryMetrics(rec({ slideCount: 1, reach: [500, null, null], linkSlide: 1 })).retention).toBeNull();
    expect(ratio(5, 0)).toBeNull();
  });

  it('validates records', () => {
    expect(() => rec({ reach: [-1, 1, 1] })).toThrow(StoryRecordError);
    expect(() => rec({ linkTaps: 1.5 })).toThrow(StoryRecordError);
    expect(() => rec({ linkSlide: 4 })).toThrow(StoryRecordError);
    expect(() => rec({ postedAt: 'yesterday' })).toThrow(StoryRecordError);
    expect(() => rec({ abTest: 'cta', abVariant: null })).toThrow(StoryRecordError);
    expect(rec({ reach: ['1,200', '', ''] as never }).reach).toEqual([1200, null, null]);
    // 枚数より後ろのリーチは保存しない
    expect(rec({ slideCount: 1, linkSlide: 1 }).reach).toEqual([1000, null, null]);
  });

  it('summarizes A/B results per template × test × target', () => {
    const rs = [
      rec({ id: 'a1xxxxxx', abTest: 'cta', abVariant: 'a', reach: [1000, 900, 800], linkTaps: 16, linkSlideReach: 800 }),
      rec({ id: 'a2xxxxxx', abTest: 'cta', abVariant: 'a', reach: [500, 400, 200], linkTaps: 4, linkSlideReach: 200 }),
      rec({ id: 'b1xxxxxx', abTest: 'cta', abVariant: 'b', reach: [1000, 900, 700], linkTaps: 35, linkSlideReach: null }),
      rec({ id: 'b2xxxxxx', abTest: 'cta', abVariant: 'b', reach: [1000, null, null], linkTaps: null }),
      rec({ id: 'nnxxxxxx' }),
    ];
    const [g] = summarizeAbTests(rs);
    expect(summarizeAbTests(rs)).toHaveLength(1);
    expect(g.a.posts).toBe(2);
    expect(g.a.tapRate).toBeCloseTo(20 / 1000);
    expect(g.a.retention).toBeCloseTo(1000 / 1500);
    expect(g.b.posts).toBe(2);
    expect(g.b.tapRate).toBeCloseTo(35 / 700);
    expect(g.b.retention).toBeCloseTo(700 / 1000);
    expect(g.better).toBe('b');
  });

  it('exports CSV with BOM and escaped fields', () => {
    const csv = storyRecordsToCsv([rec({ memo: 'a,"b"' })]);
    expect(csv.startsWith('﻿投稿日時')).toBe(true);
    expect(csv).toContain('"a,""b"""');
    expect(csv).toContain('60.0%');
    expect(csv).toContain('5.0%');
  });
});

describe('story-maker screenshot paths', () => {
  it('allows only public pages on the site', () => {
    for (const ok of ['/oshi-vod', '/oshi-vod?with=a', '/person/%E5%B1%B1', '/groups/milk', '/oshi-card?p=x', '/oshikatsu/goods-making', '/'])
      expect(isAllowedScreenshotPath(ok)).toBe(true);
    for (const ng of ['', 'https://evil.example/', '//evil.example/x', '/admin/story-maker', '/api/track', '/oshi-vodx', '/\\evil', '/person\n/x', 'oshi-vod'])
      expect(isAllowedScreenshotPath(ng)).toBe(false);
  });
});

describe('story-maker slide rendering', () => {
  it('shrinks long names to fit the width', () => {
    expect(visualWidth('ABC')).toBeCloseTo(1.74);
    expect(fitFontSize('M!LK推しの人！', 912, 104, 44)).toBe(104);
    const long = fitFontSize('超ときめき♡宣伝部推しの人！', 912, 104, 44);
    expect(long).toBeLessThan(104);
    expect(long * 14 * 1.04).toBeLessThanOrEqual(912);
    expect(fitFontSize('あ'.repeat(60), 912, 104, 44)).toBe(44);
  });

  it('keeps sticker zones inside the Instagram safe area', () => {
    for (const pos of [50, 60, 70]) for (const kind of ['link', 'question'] as const) {
      const z = stickerZone(kind, pos);
      expect(z.top).toBeGreaterThan(SAFE_TOP);
      expect(z.bottom).toBeLessThan(SAFE_BOTTOM);
    }
    expect(stickerZone('link', 50).center).toBe(960);
    expect(stickerZone('link', 60).center).toBe(1152);
    expect(stickerZone('link', 70).center).toBe(1344);
  });

  const render = (templateId: Parameters<typeof getStoryTemplate>[0], n: 1 | 2 | 3, i: number, guide: boolean, image: { src: string; fit: 'top' } | null = null) => {
    const t = getStoryTemplate(templateId);
    const def = t.structures[n][i];
    const fill = (s: string) => fillStoryText(s, milk);
    const text: SlideText = {
      heading: fill(def.text.heading),
      subheading: fill(def.text.subheading),
      body: fill(def.text.body),
      cta: fill(def.text.cta),
      note: fill(def.text.note),
      stickerCaption: fill(def.text.stickerCaption),
    };
    return renderToStaticMarkup(<StorySlide decoration={t.decoration} def={def} text={text} design={DEFAULT_DESIGN} index={i} total={n} image={image} showGuide={guide} questionText="追加してほしいのは誰？" />);
  };

  it('renders every template × slide count with the name and without guides in export mode', () => {
    for (const t of STORY_TEMPLATES) for (const n of SLIDE_COUNTS) for (let i = 0; i < n; i++) {
      const html = render(t.id, n, i, false, { src: 'data:image/png;base64,AAAA', fit: 'top' });
      expect(html).toContain('data-story-frame');
      expect(html).not.toContain('data-guide');
      expect(html).not.toContain('ここにリンクスタンプ');
      expect(html).not.toContain('ここに質問スタンプ');
      expect(html).not.toContain('未設定');
    }
    expect(render('vod', 2, 0, false)).toContain('M!LK推しの人！');
  });

  it('shows sticker guides only in preview mode', () => {
    expect(render('vod', 2, 1, true)).toContain('ここにリンクスタンプ');
    expect(render('request', 1, 0, true)).toContain('ここに質問スタンプ');
    expect(render('request', 1, 0, true)).toContain('追加してほしいのは誰？');
    // 質問文はガイドにだけ出す（画像に焼き込まない）
    expect(render('request', 1, 0, false)).not.toContain('追加してほしいのは誰？');
  });

  it('marks a missing real screen instead of drawing a fake one', () => {
    const html = render('vod', 2, 1, false, null);
    expect(html).toContain('実際の画面が未設定です');
    expect(html).not.toMatch(/<img/);
  });
});
