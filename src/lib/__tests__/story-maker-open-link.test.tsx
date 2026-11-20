import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoryMakerLink, parseStoryMakerInitial } from '@/lib/story-maker/open-link';
import { INSTAGRAM_TEMPLATES } from '@/lib/instagram-templates';
import BfSaleTemplateCard from '@/app/admin/instagram-post/BfSaleTemplateCard';

const persons = ['目黒蓮', 'A&B ?=x'];
const groups = ['Snow Man'];
const parse = (href: string) => parseStoryMakerInitial(Object.fromEntries(new URL(href, 'http://x').searchParams), persons, groups);

describe('Instagram投稿 → ストーリーズ作成のリンク', () => {
  it('楽天BFテンプレートと人物（記号を含む名前も）を引き継ぐ', () => {
    const href = buildStoryMakerLink({ template: 'bf', person: 'A&B ?=x', from: 'instagram-post' });
    expect(href.startsWith('/admin/story-maker?template=bf&person=')).toBe(true);
    expect(parse(href)).toEqual({ templateId: 'bf', targetType: 'person', name: 'A&B ?=x', from: 'instagram-post' });
    expect(parse(buildStoryMakerLink({ template: 'bf', group: 'Snow Man' }))).toEqual({ templateId: 'bf', targetType: 'group', name: 'Snow Man', from: null });
    // 人物が未選択なら対象なし（テンプレートだけ）
    expect(parse(buildStoryMakerLink({ template: 'bf' }))).toEqual({ templateId: 'bf', targetType: null, name: '', from: null });
  });

  it('知らないテンプレート・実在しない人物/グループ・知らない戻り先は無視し、パラメータ無しは従来の初期状態', () => {
    expect(parse('/admin/story-maker')).toEqual({ templateId: null, targetType: null, name: '', from: null });
    expect(parse('/admin/story-maker?template=evil&person=存在しない人&group=x&from=toString')).toEqual({ templateId: null, targetType: null, name: '', from: null });
    expect(parse('/admin/story-maker?template=goods&group=Snow%20Man&from=https://evil.example')).toEqual({ templateId: 'goods', targetType: 'group', name: 'Snow Man', from: null });
  });

  it('カードは選択中の人物を引き継ぐリンクで、1080×1350 の通常投稿用・手動投稿と分かる。自動投稿のテンプレート一覧には入れない', () => {
    const html = renderToStaticMarkup(<BfSaleTemplateCard personName="目黒蓮" />);
    expect(html).toContain(`href="/admin/story-maker?template=bf&amp;person=${encodeURIComponent('目黒蓮')}&amp;from=instagram-post"`);
    expect(html).toContain('通常投稿（フィード）1080×1350');
    expect(html).toContain('手動投稿');
    expect(renderToStaticMarkup(<BfSaleTemplateCard personName="" />)).toContain('href="/admin/story-maker?template=bf&amp;from=instagram-post"');
    expect(INSTAGRAM_TEMPLATES.some((t) => /bf|楽天/.test(`${t.id}${t.label}`))).toBe(false);
  });
});
