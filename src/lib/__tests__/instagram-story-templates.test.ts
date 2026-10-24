import { describe, it, expect } from 'vitest';
import {
  STORY_TEMPLATES,
  STORY_CANVAS,
  STORY_LAYOUT,
  getLinkStickerZone,
  getStoryTemplate,
  describeLinkPosition,
  formatStoryTemplateForCopy,
  resolveSlideLinkUrl,
  STORY_LINK_ORIGIN,
  type StoryZone,
} from '@/lib/instagram-story-templates';

const overlaps = (a: StoryZone, b: StoryZone) => a.top < b.bottom && b.top < a.bottom;

describe('instagram story templates', () => {
  it('defines the 4 templates with unique ids', () => {
    expect(STORY_TEMPLATES.map((t) => t.title)).toEqual([
      '推し活の「めんどい」を解決',
      '推しからサブスク診断',
      '推しサーチでできること',
      '応援広告・推しアド',
    ]);
    expect(new Set(STORY_TEMPLATES.map((t) => t.id)).size).toBe(STORY_TEMPLATES.length);
  });

  it('every slide (not only the last) has text, CTA, link position and asset', () => {
    for (const t of STORY_TEMPLATES) {
      expect(t.slides.length).toBeGreaterThanOrEqual(3);
      for (const s of t.slides) {
        expect(s.text.trim()).not.toBe('');
        expect(s.linkCTA.trim()).not.toBe('');
        expect(s.recommendedAsset.trim()).not.toBe('');
        expect(s.linkPosition.placement).toBe('bottom-center');
      }
    }
  });

  it('assigns hook → detail → final CTA roles', () => {
    for (const t of STORY_TEMPLATES) {
      const roles = t.slides.map((s) => s.ctaRole);
      expect(roles[0]).toBe('hook');
      expect(roles[roles.length - 1]).toBe('final');
      expect(roles.slice(1, -1).every((r) => r === 'detail')).toBe(true);
    }
  });

  it('uses the specified CTAs', () => {
    const ctas = Object.fromEntries(STORY_TEMPLATES.map((t) => [t.id, t.slides.map((s) => s.linkCTA)]));
    expect(ctas['oshikatsu-mendoi']).toEqual(['推しから探してみる ↓', '推しサーチを使ってみる ↓', '推しの出演作・配信先を探す ↓']);
    expect(ctas['oshi-vod-diagnosis']).toEqual(['今すぐ診断してみる ↓', '気になる人を選んでみる ↓', 'あなたの推しでも診断する ↓']);
    expect(ctas['oshi-search-features']).toEqual(['推しサーチを見てみる ↓', '気になる人から探す ↓', '推しサーチを使ってみる ↓']);
    expect(ctas['support-ads-oshiad']).toEqual(['応援広告を見てみる ↓', '費用・始め方を見る ↓', '初めての応援広告を見る ↓']);
  });

  it('marks only the 推しアド template as PR and keeps ※PR in its text', () => {
    expect(STORY_TEMPLATES.filter((t) => t.isPR).map((t) => t.id)).toEqual(['support-ads-oshiad']);
    const pr = getStoryTemplate('support-ads-oshiad')!;
    // 1枚目からリンクを置くため、コピーする本文そのものに全スライド ※PR を入れる
    for (const slide of pr.slides) expect(slide.text.trimEnd().endsWith('※PR')).toBe(true);
    expect(formatStoryTemplateForCopy(pr).split('※PR').length - 1).toBeGreaterThanOrEqual(pr.slides.length);
  });

  it('resolves link URLs to confirmed production pages (template default, slide override)', () => {
    const urls = Object.fromEntries(
      STORY_TEMPLATES.map((t) => [t.id, t.slides.map((s) => resolveSlideLinkUrl(t, s))]),
    );
    expect(STORY_LINK_ORIGIN).toBe('https://oshi-search.jp');
    expect(urls['oshikatsu-mendoi']).toEqual(Array(3).fill('https://oshi-search.jp/search'));
    expect(urls['oshi-vod-diagnosis']).toEqual(Array(3).fill('https://oshi-search.jp/oshi-vod'));
    expect(urls['oshi-search-features']).toEqual([
      'https://oshi-search.jp/',
      'https://oshi-search.jp/search',
      'https://oshi-search.jp/search',
    ]);
    // 推しアドは自サイトの応援広告ガイドへ（AccessTrade の計測リンクは直接使わない）
    expect(urls['support-ads-oshiad']).toEqual(Array(3).fill('https://oshi-search.jp/support-ads'));
  });

  it('slide linkUrl overrides the template default, including null (未設定)', () => {
    const t = { ...STORY_TEMPLATES[0], linkUrl: 'https://oshi-search.jp/a' };
    expect(resolveSlideLinkUrl(t, { ...t.slides[0], linkUrl: undefined })).toBe('https://oshi-search.jp/a');
    expect(resolveSlideLinkUrl(t, { ...t.slides[0], linkUrl: null })).toBeNull();
    const unset = { ...t, linkUrl: null, slides: [{ ...t.slides[0], linkUrl: undefined }] };
    expect(formatStoryTemplateForCopy(unset)).toContain('リンク先URL：未設定');
  });

  it('places the link sticker 300–450px above the bottom, clear of text/image and Instagram UI', () => {
    for (const t of STORY_TEMPLATES) {
      for (const s of t.slides) {
        expect(s.linkPosition.bottomOffsetMinPx).toBeGreaterThanOrEqual(300);
        expect(s.linkPosition.bottomOffsetMaxPx).toBeLessThanOrEqual(450);
        const sticker = getLinkStickerZone(s.linkPosition);
        expect(sticker).toEqual({ top: STORY_CANVAS.height - 450, bottom: STORY_CANVAS.height - 300 });
        expect(overlaps(sticker, STORY_LAYOUT.text)).toBe(false);
        expect(overlaps(sticker, STORY_LAYOUT.image)).toBe(false);
        expect(overlaps(sticker, STORY_LAYOUT.bottomUi)).toBe(false);
      }
    }
    expect(overlaps(STORY_LAYOUT.text, STORY_LAYOUT.topUi)).toBe(false);
    expect(overlaps(STORY_LAYOUT.text, STORY_LAYOUT.image)).toBe(false);
  });

  it('formats all slides for "まとめてコピー" including every CTA', () => {
    const t = STORY_TEMPLATES[0];
    const text = formatStoryTemplateForCopy(t);
    t.slides.forEach((s, i) => {
      expect(text).toContain(`${i + 1}枚目`);
      expect(text).toContain(s.text);
      expect(text).toContain(`リンクCTA：${s.linkCTA}`);
      expect(text).toContain(`リンク先URL：${resolveSlideLinkUrl(t, s)}`);
    });
    expect(text).toContain(describeLinkPosition(t.slides[0].linkPosition));
  });
});
