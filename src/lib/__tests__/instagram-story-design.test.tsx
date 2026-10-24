import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STORY_TEMPLATES, getStoryTemplate } from '@/lib/instagram-story-templates';
import { StoryDesignFrame, hasStoryDesign } from '@/app/admin/instagram-stories/StoryDesignPreview';

const template = getStoryTemplate('oshi-vod-diagnosis')!;
const render = (i: number, showGuide = false) =>
  renderToStaticMarkup(<StoryDesignFrame templateId={template.id} slideIndex={i} slide={template.slides[i]} showGuide={showGuide} />);

describe('instagram story design preview', () => {
  it('has a finished design only for 推しからサブスク診断 (other templates keep the layout diagram)', () => {
    for (const t of STORY_TEMPLATES) {
      t.slides.forEach((_, i) => expect(hasStoryDesign(t.id, i)).toBe(t.id === 'oshi-vod-diagnosis'));
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
});
