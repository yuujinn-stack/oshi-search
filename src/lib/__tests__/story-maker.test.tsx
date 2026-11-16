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
  structureLabel,
  structureSlideCount,
  structureSlides,
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
import { autoImageCaption, autoImageOwnerKey, autoImagePlan, describeImageResponseError, isAutoSupported, memberPickMode } from '@/lib/story-maker/auto';
import { buildOshiVodImagePath } from '@/lib/oshi-vod/params';
import { SAFE_BOTTOM, SAFE_TOP, StorySlide, fitFontSize, fitStoryHeading, headingLineWidth, singleLayout, stickerZone, visualWidth } from '@/app/admin/story-maker/StorySlide';

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
    expect([applyAbVariant(base, ab('slides'), 'a').slides, applyAbVariant(base, ab('slides'), 'b').slides]).toEqual(['single', 3]);
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

describe('story-maker auto (A・C・D)', () => {
  const opts = { members: [] as string[], cardVariant: 'basic' as const };

  it('supports all 5 templates (B・E draw cards from site data; no page capture)', () => {
    expect(STORY_TEMPLATES.filter((t) => isAutoSupported(t.id)).map((t) => t.id).sort()).toEqual(['card', 'goods', 'goodsmaking', 'request', 'vod']);
    expect(autoImagePlan('goods', person, opts).kind).toBe('panel');
    expect(autoImagePlan('goodsmaking', person, opts).kind).toBe('panel');
  });

  it('C needs no image', () => {
    expect(autoImagePlan('request', null, opts)).toEqual({ kind: 'none' });
  });

  it('A uses the existing diagnosis image API with the selected person', () => {
    const plan = autoImagePlan('vod', person, opts);
    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') return;
    expect(plan.slot).toBe('screen');
    expect(plan.url).toBe(buildOshiVodImagePath(['山田花子'], 'feed'));
    expect(plan.url.startsWith('/api/oshi-vod/image?')).toBe(true);
  });

  it('A with a group never picks members automatically', () => {
    const blocked = autoImagePlan('vod', milk, opts);
    expect(blocked.kind).toBe('blocked');
    const plan = autoImagePlan('vod', milk, { ...opts, members: ['佐野勇斗', '塩﨑太智', '佐野勇斗'] });
    expect(plan.kind === 'fetch' && plan.personNames).toEqual(['佐野勇斗', '塩﨑太智']);
    expect(autoImagePlan('vod', milk, { ...opts, members: Array.from({ length: 13 }, (_, i) => `m${i}`) }).kind).toBe('blocked');
  });

  it('D uses the existing card image API (one person; group needs exactly one member)', () => {
    const plan = autoImagePlan('card', person, opts);
    expect(plan.kind === 'fetch' && plan.slot).toBe('card');
    expect(plan.kind === 'fetch' && plan.url.startsWith(`/api/oshi-card/image?p=${encodeURIComponent('山田花子')}`)).toBe(true);
    expect(plan.kind === 'fetch' && plan.url).toContain('v=basic');
    expect(autoImagePlan('card', milk, opts).kind).toBe('blocked');
    expect(autoImagePlan('card', milk, { ...opts, members: ['a', 'b'] }).kind).toBe('blocked');
    expect(autoImagePlan('card', milk, { ...opts, members: ['a'] }).kind).toBe('fetch');
    expect(autoImagePlan('card', null, opts).kind).toBe('blocked');
  });

  it('member picker only for group + A (multi) / D (single)', () => {
    expect(memberPickMode('vod', milk)).toBe('multi');
    expect(memberPickMode('card', milk)).toBe('single');
    expect(memberPickMode('request', milk)).toBeNull();
    expect(memberPickMode('vod', person)).toBeNull();
  });

  it('owner key changes when the target or settings change (stale images are removed)', () => {
    const a = autoImageOwnerKey('card', person, autoImagePlan('card', person, opts));
    const other: StoryTarget = { type: 'person', name: '別の人', pagePath: '/person/x' };
    expect(autoImageOwnerKey('card', other, autoImagePlan('card', other, opts))).not.toBe(a);
    expect(autoImageOwnerKey('card', person, autoImagePlan('card', person, { ...opts, cardVariant: 'ssr' }))).not.toBe(a);
    expect(autoImageOwnerKey('card', person, autoImagePlan('card', person, opts))).toBe(a);
  });

  it('rejects non-image or failed responses', () => {
    expect(describeImageResponseError(200, 'image/png')).toBeNull();
    expect(describeImageResponseError(200, 'text/html; charset=utf-8')).toMatch(/画像以外/);
    expect(describeImageResponseError(429, 'application/json')).toMatch(/上限/);
    expect(describeImageResponseError(400, 'application/json')).toMatch(/作れませんでした/);
    expect(describeImageResponseError(500, null)).toMatch(/HTTP 500/);
  });

  it('C renders the question-sticker space without a fake sticker', () => {
    const def = getStoryTemplate('request').structures[1][0];
    expect(def.sticker).toBe('question');
    expect(def.image).toBe('none');
  });
});

describe('story-maker template A layout', () => {
  const snow: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snowman' };
  const img = { src: 'data:image/png;base64,AAAA', fit: 'contain' as const };
  const renderA = (n: 1 | 2 | 3, i: number, target: StoryTarget, templateId: 'vod' | undefined, linkPos: 50 | 60 | 70 = 60, guide = false) => {
    const t = getStoryTemplate('vod');
    const def = t.structures[n][i];
    const fill = (s: string) => fillStoryText(s, target);
    const text: SlideText = {
      heading: fill(def.text.heading), subheading: fill(def.text.subheading), body: fill(def.text.body),
      cta: fill(def.text.cta), note: fill(def.text.note), stickerCaption: fill(def.text.stickerCaption),
    };
    return renderToStaticMarkup(<StorySlide decoration={t.decoration} def={def} text={text} design={{ ...DEFAULT_DESIGN, linkPos }} index={i} total={n} image={def.image === 'none' ? null : img} showGuide={guide} templateId={templateId} />);
  };
  const imageBox = (html: string) => {
    const m = html.match(/top:\d+px;width:(\d+)px;height:(\d+)px"><div style="width:/);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  };

  it('measures Latin letters wider than the flat 0.58 estimate', () => {
    expect(headingLineWidth('Snow Man')).toBeGreaterThan(visualWidth('Snow Man'));
    expect(headingLineWidth('推しの人！')).toBeCloseTo(5.1, 5);
  });

  it('keeps "Snow Man推しの人！" on one line; long names break before 推し', () => {
    const one = fitStoryHeading('Snow Man推しの人！', 912 - 80, 104, 64, 40);
    expect(one.lines).toEqual(['Snow Man推しの人！']);
    expect(one.size).toBeGreaterThanOrEqual(64);
    const long = fitStoryHeading('ももいろクローバーZ推しの人！', 912 - 80, 104, 64, 40);
    expect(long.lines).toEqual(['ももいろクローバーZ', '推しの人！']);
    expect(long.fits).toBe(true);
    const html = renderA(2, 0, snow, 'vod');
    expect(html).toContain('Snow Man推しの人！');
    expect(html).toContain('white-space:nowrap');
  });

  it('shows the diagnosis image large (4:5 kept) at every link position, without overlapping the CTA', () => {
    for (const pos of [50, 60, 70] as const) {
      const html = renderA(2, 1, snow, 'vod', pos);
      const box = imageBox(html);
      expect(box).not.toBeNull();
      // 従来は約235×294（ほぼ正方形の枠に4:5を全体表示）。1.5倍以上・縦横比 4:5
      expect(box!.w).toBeGreaterThanOrEqual(Math.round(235 * 1.5));
      expect(box!.h / box!.w).toBeCloseTo(1.25, 1);
      const zone = stickerZone('link', pos);
      const top = Number(html.match(/top:(\d+)px;width:\d+px;height:\d+px"><div style="width:/)![1]);
      const bottom = top + box!.h;
      expect(bottom <= zone.top - 60 || top >= zone.bottom).toBe(true);
      expect(top).toBeGreaterThanOrEqual(SAFE_TOP);
      expect(bottom).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
  });

  it('CTA is "無料で診断する ↓" with no line over the text, and no guide in export', () => {
    const html = renderA(2, 1, snow, 'vod');
    expect(html).toContain('無料で診断する ↓');
    expect(html).not.toContain('↓ 無料で診断する ↓');
    expect(html).not.toContain('linear-gradient(transparent 58%');
    expect(html).not.toContain('data-guide');
    expect(renderA(2, 1, snow, 'vod', 60, true)).toContain('ここにリンクスタンプ');
  });

  it('other templates render exactly as before', () => {
    for (const t of STORY_TEMPLATES.filter((x) => x.id !== 'vod')) for (const n of SLIDE_COUNTS) for (let i = 0; i < n; i++) {
      const def = t.structures[n][i];
      const text: SlideText = { ...def.text };
      const props = { decoration: t.decoration, def, text, design: DEFAULT_DESIGN, index: i, total: n, image: img, showGuide: false };
      expect(renderToStaticMarkup(<StorySlide {...props} templateId={t.id} />)).toBe(renderToStaticMarkup(<StorySlide {...props} />));
    }
  });
});

describe('story-maker 1枚完結版', () => {
  const snow: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snowman' };
  const longName: StoryTarget = { type: 'group', name: 'ももいろクローバーZ', pagePath: '/groups/momoclo' };
  const veryLong: StoryTarget = { type: 'person', name: 'エクストラロングネームのアーティスト名テスト', pagePath: '/person/x' };
  const img = { src: 'data:image/png;base64,AAAA', fit: 'contain' as const };
  const textOf = (id: Parameters<typeof getStoryTemplate>[0], target: StoryTarget | null): SlideText => {
    const t = getStoryTemplate(id);
    const tt = t.usesTarget ? target : null;
    return Object.fromEntries(Object.entries(t.single.text).map(([k, v]) => [k, fillStoryText(v, tt)])) as unknown as SlideText;
  };
  const renderSingle = (id: Parameters<typeof getStoryTemplate>[0], target: StoryTarget | null, guide: boolean, image: typeof img | null = img, fontScale = 1) => {
    const t = getStoryTemplate(id);
    return renderToStaticMarkup(<StorySlide decoration={t.decoration} def={t.single} text={textOf(id, target)} design={{ ...DEFAULT_DESIGN, fontScale }} index={0} total={1} image={t.single.image === 'none' ? null : image} showGuide={guide} questionText="追加してほしいのは誰？" templateId={id} />);
  };

  it('every template has a 1-page version separate from the standard structures', () => {
    for (const t of STORY_TEMPLATES) {
      expect(t.single.layout).toBe('single');
      expect(structureSlides(t, 'single')).toEqual([t.single]);
      expect(structureSlides(t, t.defaultSlides)).toBe(t.structures[t.defaultSlides]);
      expect(t.single.sticker).toBe(t.id === 'request' ? 'question' : 'link');
      // 標準版は1枚完結版に置き換えていない（B・C の標準版1枚も従来どおり）
      expect(t.structures[1][0].layout).not.toBe('single');
    }
    expect(structureSlideCount('single')).toBe(1);
    expect(structureSlideCount(3)).toBe(3);
    expect(structureLabel(getStoryTemplate('vod'), 'single')).toBe('1枚完結版（1枚）');
    expect(structureLabel(getStoryTemplate('vod'), 2)).toBe('標準版（2枚）');
    expect(structureLabel(getStoryTemplate('goods'), 1)).toBe('標準版（1枚）');
  });

  it('keeps the requested copy with the selected name', () => {
    const a = textOf('vod', snow);
    expect(a.heading).toBe('Snow Man推しの人！');
    expect(a.subheading.replace('\n', '')).toBe('推しの出演作品、どこで見られるか知ってる？');
    expect([a.stickerCaption, a.cta]).toEqual(['推しを選ぶだけでサブスクを比較！', '無料で診断する']);
    const b = textOf('goods', snow);
    expect(b.heading.replace('\n', '')).toBe('Snow Man推しの人、チェックして！');
    expect([b.stickerCaption, b.cta]).toEqual(['写真集・CD・グッズをまとめて探せる！', '関連商品を見る']);
    const c = textOf('request', snow);
    expect(c.heading.replace('\n', '')).toBe('推しサーチに追加してほしいのは？');
    expect(c.body.replace('\n', '')).toBe('追加してほしいグループ・人物を教えて！');
    expect(c.note).toBe('いただいたリクエストを今後の登録候補にします！');
    expect(JSON.stringify(c)).not.toMatch(/投票|ランキング/);
    const d = textOf('card', snow);
    expect(d.heading.replace('\n', '')).toBe('Snow Manの推しカード、作れるの知ってた？');
    expect([d.stickerCaption, d.cta]).toEqual(['あなたの推しでも作ってみて！', '無料でカードを作る']);
    const e = textOf('goodsmaking', snow);
    expect(e.heading.replace('\n', '')).toBe('推しグッズ、自分で作ってみない？');
    expect([e.stickerCaption, e.cta]).toEqual(['グッズ制作サービスをまとめて比較！', '詳しく見てみる']);
    // A・B・D・E は実際の画面が必須（架空の画面・商品は描かない）、C は画像なし
    expect(STORY_TEMPLATES.map((t) => t.single.image)).toEqual(['required', 'required', 'none', 'required', 'required']);
  });

  it('auto-create (A・C・D) fills the same image slot as the 1-page version', () => {
    const opts = { members: ['目黒蓮'], cardVariant: 'basic' as const };
    for (const id of ['vod', 'card'] as const) {
      const plan = autoImagePlan(id, person, opts);
      expect(plan.kind).toBe('fetch');
      if (plan.kind === 'fetch') expect(plan.slot).toBe(getStoryTemplate(id).single.imageSlot);
    }
    expect(autoImagePlan('request', null, opts).kind).toBe('none');
  });

  it('lays out every template inside the safe area without overlaps, for short/long names and font sizes', () => {
    for (const t of STORY_TEMPLATES) for (const target of [null, snow, longName, veryLong]) for (const scale of [0.8, 1, 1.2]) {
      const caption = t.id === 'vod' ? '目黒蓮の診断結果' : t.id === 'card' ? '目黒蓮の推しカード' : undefined;
      const L = singleLayout(t.single, textOf(t.id, target), scale, t.id, { imageCaption: caption, headingBar: t.decoration === 'polaroid' || t.decoration === 'steps' });
      const label = `${t.id} ${target?.name ?? '-'} ${scale}`;
      if (caption) expect(L.imageCaption.height, label).toBeGreaterThan(0);
      const boxes = [
        L.heading, L.sub.height ? L.sub : null,
        L.imageCaption.height ? L.imageCaption : null,
        L.image ? { top: L.image.top, height: L.image.height } : null,
        t.single.sticker === 'question' && L.zone ? { top: L.zone.top, height: L.zone.bottom - L.zone.top } : null,
        L.body.height ? L.body : null,
        L.cta.height ? L.cta : null,
        t.single.sticker === 'link' && L.zone ? { top: L.zone.top, height: L.zone.bottom - L.zone.top } : null,
        L.note.height ? L.note : null,
      ].filter((b): b is { top: number; height: number } => b !== null);
      expect(boxes[0].top, label).toBeGreaterThanOrEqual(SAFE_TOP + 60);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].top, `${label} #${i}`).toBeGreaterThanOrEqual(boxes[i - 1].top + boxes[i - 1].height);
      const last = boxes[boxes.length - 1];
      expect(last.top + last.height, label).toBeLessThanOrEqual(SAFE_BOTTOM);
      expect(L.zone, label).not.toBeNull();
      if (t.single.sticker === 'link') expect(L.zone!.bottom - L.zone!.top).toBe(160);
      else expect(L.zone!.bottom - L.zone!.top).toBeGreaterThanOrEqual(380);
      if (L.image) {
        expect(L.image.width, label).toBeLessThanOrEqual(912);
        // 画像を小さくしすぎない（標準版A の実画面 480×600 前後と同等以上）
        expect(L.image.height, label).toBeGreaterThanOrEqual(scale !== 1 || target === veryLong ? 420 : target === longName ? 500 : target === null ? 540 : 560);
      }
    }
  });

  it('shows the diagnosis result and the card large, keeping their aspect ratios', () => {
    const a = singleLayout(getStoryTemplate('vod').single, textOf('vod', snow), 1, 'vod');
    expect(a.image!.height / a.image!.width).toBeCloseTo(1.25, 1);
    expect(a.image!.height).toBeGreaterThanOrEqual(620);
    const d = singleLayout(getStoryTemplate('card').single, textOf('card', snow), 1, 'card');
    expect(d.image!.height / d.image!.width).toBeCloseTo(88 / 63, 1);
    expect(d.image!.height).toBeGreaterThanOrEqual(680);
    // 見出しは「Snow Man推しの人！」を1行で
    expect(a.heading.lines).toEqual(['Snow Man推しの人！']);
    expect(a.heading.size).toBeGreaterThanOrEqual(72);
  });

  it('renders all 5 for export without guides, with the real image, names and CTA', () => {
    for (const t of STORY_TEMPLATES) for (const target of [snow, veryLong]) {
      const html = renderSingle(t.id, target, false);
      expect(html).toContain('data-layout="single"');
      expect(html).not.toContain('data-guide');
      expect(html).not.toMatch(/ここに(リンク|質問)スタンプ/);
      expect(html).not.toContain('未設定');
      expect(html).not.toContain('追加してほしいのは誰？');
      if (t.single.image === 'required') expect(html).toMatch(/<img src="data:image\/png;base64,AAAA"/);
      if (t.usesTarget) expect(html).toContain(target.name.slice(0, 6));
    }
    expect(renderSingle('vod', snow, false)).toContain('無料で診断する');
    expect(renderSingle('goods', snow, false)).toContain('関連商品を見る');
    expect(renderSingle('card', snow, false)).toContain('無料でカードを作る');
    expect(renderSingle('goodsmaking', snow, false)).toContain('詳しく見てみる');
  });

  it('shows sticker guides only in preview, and a placeholder when the real screen is missing', () => {
    expect(renderSingle('vod', snow, true)).toContain('ここにリンクスタンプ');
    expect(renderSingle('request', null, true)).toContain('ここに質問スタンプ');
    expect(renderSingle('request', null, true)).toContain('追加してほしいのは誰？');
    for (const id of ['vod', 'goods', 'card', 'goodsmaking'] as const) {
      const html = renderSingle(id, snow, false, null);
      expect(html).toContain('実際の画面が未設定です');
      expect(html).not.toMatch(/<img/);
    }
  });

  it('switching the person/group changes the drawn name', () => {
    const a = renderSingle('vod', snow, false);
    const b = renderSingle('vod', longName, false);
    expect(a).toContain('Snow Man推しの人！');
    expect(b).not.toContain('Snow Man');
    expect(b).toContain('ももいろクローバーZ');
  });

  it('marks the 1-page version in UTM and A/B', () => {
    expect(buildStoryUtm(getStoryTemplate('vod'), 'snowman', 'single', null).content).toBe('snowman_single');
    expect(buildStoryUtm(getStoryTemplate('vod'), 'snowman', 2, null).content).toBe('snowman_2p');
  });
});

describe('story-maker 1枚完結版の最終調整', () => {
  const snow: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snowman' };
  const textOf = (id: Parameters<typeof getStoryTemplate>[0], target: StoryTarget | null): SlideText => {
    const t = getStoryTemplate(id);
    return Object.fromEntries(Object.entries(t.single.text).map(([k, v]) => [k, fillStoryText(v, t.usesTarget ? target : null)])) as unknown as SlideText;
  };
  const render = (id: Parameters<typeof getStoryTemplate>[0], image: { src: string; fit: 'contain' | 'top'; caption?: string } | null, guide = false) => {
    const t = getStoryTemplate(id);
    return renderToStaticMarkup(<StorySlide decoration={t.decoration} def={t.single} text={textOf(id, snow)} design={DEFAULT_DESIGN} index={0} total={1} image={image} showGuide={guide} templateId={id} />);
  };
  const upload = { src: 'data:image/png;base64,UPLOAD', fit: 'top' as const };

  it('B・E: no marker band across the heading; a short line sits below the text instead', () => {
    for (const id of ['goods', 'goodsmaking'] as const) {
      const html = render(id, upload);
      expect(html).not.toContain('linear-gradient(transparent 62%');
      expect(html).toContain('data-heading-bar');
      // 線は見出しの文字（h2）の後ろ＝下に置く
      expect(html.indexOf('data-heading-bar')).toBeGreaterThan(html.indexOf('</h2>'));
    }
    // A・C・D は線なし
    for (const id of ['vod', 'request', 'card'] as const) expect(render(id, upload)).not.toContain('data-heading-bar');
  });

  it('A: caption names only the members actually diagnosed', () => {
    const one = autoImagePlan('vod', snow, { members: ['目黒蓮'], cardVariant: 'basic' });
    expect(autoImageCaption('vod', one)).toBe('目黒蓮の診断結果');
    const five = autoImagePlan('vod', snow, { members: ['目黒蓮', '向井康二', '阿部亮平', '渡辺翔太', '岩本照'], cardVariant: 'basic' });
    expect(autoImageCaption('vod', five)).toBe('目黒蓮・向井康二・阿部亮平ほか2人の診断結果');
    expect(autoImageCaption('vod', autoImagePlan('vod', snow, { members: [], cardVariant: 'basic' }))).toBeUndefined();
    expect(autoImageCaption('request', autoImagePlan('request', null, { members: [], cardVariant: 'basic' }))).toBeUndefined();
    expect(autoImageCaption('goods', autoImagePlan('goods', snow, { members: ['目黒蓮'], cardVariant: 'basic' }))).toBeUndefined();

    const html = render('vod', { src: 'data:image/png;base64,AAAA', fit: 'contain', caption: '目黒蓮の診断結果' });
    expect(html).toContain('Snow Man推しの人！');
    expect(html).toContain('目黒蓮の診断結果');
    expect(html).not.toContain('向井康二');
    const L = singleLayout(getStoryTemplate('vod').single, textOf('vod', snow), 1, 'vod', { imageCaption: '目黒蓮の診断結果' });
    expect(L.imageCaption.top).toBeGreaterThanOrEqual(L.sub.top + L.sub.height);
    expect(L.image!.top).toBeGreaterThanOrEqual(L.imageCaption.top + L.imageCaption.height);
    expect(L.image!.height).toBeGreaterThanOrEqual(560);
  });

  it('uploaded / missing images never get a person caption', () => {
    expect(render('vod', upload)).not.toContain('data-image-caption');
    expect(render('goods', upload)).not.toContain('data-image-caption');
    const missing = render('goods', null);
    expect(missing).toContain('実際の画面が未設定です');
    expect(missing).not.toContain('data-image-caption');
    expect(render('goodsmaking', null)).toContain('実際の画面が未設定です');
  });

  it('D: Snow Man + one member → that member\'s real card, caption matches, card stays large, link space kept', () => {
    const plan = autoImagePlan('card', snow, { members: ['目黒蓮'], cardVariant: 'basic' });
    expect(plan.kind).toBe('fetch');
    if (plan.kind !== 'fetch') return;
    expect(plan.url.startsWith('/api/oshi-card/image?')).toBe(true);
    expect(decodeURIComponent(plan.url)).toContain('目黒蓮');
    expect(plan.personNames).toEqual(['目黒蓮']);
    const caption = autoImageCaption('card', plan)!;
    expect(caption).toBe('目黒蓮の推しカード');
    const L = singleLayout(getStoryTemplate('card').single, textOf('card', snow), 1, 'card', { imageCaption: caption });
    expect(L.heading.lines.join('')).toBe('Snow Manの推しカード、作れるの知ってた？');
    expect(L.image!.height).toBeGreaterThanOrEqual(620);
    expect(L.image!.height / L.image!.width).toBeCloseTo(88 / 63, 1);
    expect(L.zone!.bottom - L.zone!.top).toBe(160);
    expect(L.zone!.bottom).toBeLessThanOrEqual(SAFE_BOTTOM);
    // 2人以上・0人は自動で選ばない
    expect(autoImagePlan('card', snow, { members: ['目黒蓮', '向井康二'], cardVariant: 'basic' }).kind).toBe('blocked');
  });

  it('save: 1-page = one PNG, standard = its usual page count with distinct file names; export has no guides', () => {
    for (const t of STORY_TEMPLATES) {
      expect(structureSlides(t, 'single')).toHaveLength(1);
      const std = structureSlides(t, t.defaultSlides);
      expect(std).toHaveLength(t.defaultSlides);
      const names = std.map((_, i) => storyFileName(t, 'snowman', i, null));
      expect(new Set(names).size).toBe(std.length);
      for (const n of names) expect(n).toMatch(/\.png$/);
    }
    const exported = render('vod', { src: 'data:image/png;base64,AAAA', fit: 'contain', caption: '目黒蓮の診断結果' }, false);
    expect(exported).not.toContain('data-guide');
    expect(exported).toMatch(/width:1080px;height:1920px/);
    expect(render('vod', upload, true)).toContain('ここにリンクスタンプ');
  });
});
