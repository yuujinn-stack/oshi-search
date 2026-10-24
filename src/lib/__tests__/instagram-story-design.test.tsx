import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STORY_TEMPLATES, getStoryTemplate } from '@/lib/instagram-story-templates';
import { MEDIA_GUIDES, FLOW_STEPS, COST_GUIDE_UPDATED_AT } from '@/lib/support-ads/content';
import { StoryDesignFrame, hasStoryDesign, SUPPORT_AD_PRICE_ROWS, SUPPORT_AD_START_STEPS } from '@/app/admin/instagram-stories/StoryDesignPreview';

const template = getStoryTemplate('oshi-vod-diagnosis')!;
const render = (i: number, showGuide = false) =>
  renderToStaticMarkup(<StoryDesignFrame templateId={template.id} slideIndex={i} slide={template.slides[i]} showGuide={showGuide} />);

describe('instagram story design preview', () => {
  it('has finished designs only for サブスク診断 and 推しアド (other templates keep the layout diagram)', () => {
    const designed = ['oshi-vod-diagnosis', 'support-ads-oshiad'];
    for (const t of STORY_TEMPLATES) {
      t.slides.forEach((_, i) => expect(hasStoryDesign(t.id, i)).toBe(designed.includes(t.id)));
      // テンプレートの枚数より多いデザインは持たない（削除した旧スライドが出力に混ざらない）
      expect(hasStoryDesign(t.id, t.slides.length)).toBe(false);
    }
  });

  it('draws text, image and link CTA blocks on every slide with that slide’s CTA', () => {
    template.slides.forEach((slide, i) => {
      const html = render(i);
      for (const zone of ['text', 'image', 'cta']) expect(html).toContain(`data-story-zone="${zone}"`);
      expect(html).toContain(slide.linkCTA);
    });
  });

  it('does not show real-looking numbers in the result mockup and marks it as an example', () => {
    const html = render(2);
    expect(html).toContain('例');
    expect(html).not.toMatch(/\d+作品/);
    expect(html).not.toMatch(/¥\s*\d/);
  });

  it('shows the Instagram UI / link sticker guide only when enabled', () => {
    expect(render(0)).not.toContain('Instagram UI');
    expect(render(0, true)).toContain('リンクステッカー（下端から300〜450px）');
  });

  describe('応援広告・推しアド（PR）', () => {
    const ads = getStoryTemplate('support-ads-oshiad')!;
    const renderAd = (i: number) =>
      renderToStaticMarkup(<StoryDesignFrame templateId={ads.id} slideIndex={i} slide={ads.slides[i]} showGuide={false} />);

    it('shows a visible PR badge, the link CTA and all layout blocks on every slide', () => {
      ads.slides.forEach((slide, i) => {
        const html = renderAd(i);
        expect(html).toMatch(/>PR</);
        expect(html).toContain(slide.linkCTA);
        for (const zone of ['text', 'image', 'cta']) expect(html).toContain(`data-story-zone="${zone}"`);
      });
    });

    it('is a 2-slide set: hook → cost and how to start', () => {
      expect(ads.slides.map((s) => s.linkCTA)).toEqual(['応援広告を見てみる ↓', '費用・始め方を確認 ↓']);
      expect(ads.slides.some((s) => s.text.includes('応援広告って知ってる？'))).toBe(false);
    });

    it('uses only the verified prices and flow from the support-ads guide content', () => {
      for (const row of SUPPORT_AD_PRICE_ROWS) {
        const guide = MEDIA_GUIDES.find((m) => m.key === row.key)!;
        expect(guide.priceNote).toContain(row.price);
        expect(guide.priceNote).toContain('7日間');
      }
      // 4ステップは FLOW_STEPS の6段階を順番どおり1回ずつ含む
      expect(SUPPORT_AD_START_STEPS.flatMap((s) => [...s.steps])).toEqual(FLOW_STEPS.map((_, i) => i));
      const html = renderAd(1);
      for (const row of SUPPORT_AD_PRICE_ROWS) expect(html).toContain(row.price);
      for (const step of SUPPORT_AD_START_STEPS) expect(html).toContain(step.label);
      expect(html).toContain(COST_GUIDE_UPDATED_AT);
      expect(html).toContain('目安');
      expect(html).toContain('場所・媒体・時期で変わります');
    });

    it('does not use photos or external images (CSS illustrations only)', () => {
      // SVG 内のグラデーション参照（url(#id)）は可。外部の画像・URLは使わない
      ads.slides.forEach((_, i) => expect(renderAd(i)).not.toMatch(/<img|<image|url\((?!#)|https?:\/\//));
    });
  });
});
