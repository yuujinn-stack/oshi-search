// 楽天BF：③の説明と⑥の保存ボタンが、テンプレートに合ったものになること（既存5テンプレートは従来どおり）
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
import StoryMakerClient from '@/app/admin/story-maker/StoryMakerClient';
import { STORY_TEMPLATES, allowsZipDownload, fixedTemplateDescription, type StoryTemplateId } from '@/lib/story-maker/templates';

const render = (templateId: StoryTemplateId) => renderToStaticMarkup(
  <StoryMakerClient persons={[]} groups={[{ name: 'Snow Man', pagePath: '/groups/snow-man', members: [] }]} serverNow={Date.parse('2026-11-20T12:00:00+09:00')}
    initial={{ templateId, targetType: 'group', name: 'Snow Man', from: null }} />,
);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('③の説明', () => {
  it('ストーリーズ版は「ストーリーズ投稿（1080×1920）の2枚構成」、通常投稿版は商品数に応じて3〜4枚', () => {
    expect(fixedTemplateDescription('bfstory')).toContain('ストーリーズ投稿（1080×1920）の2枚構成');
    expect(fixedTemplateDescription('bfstory')).not.toContain('1080×1350');
    expect(fixedTemplateDescription('bf')).toContain('フィード投稿（1080×1350）');
    expect(fixedTemplateDescription('bf')).toContain('商品数に応じて3〜4枚');
    expect(fixedTemplateDescription('bf')).not.toContain('3枚固定');
    for (const t of STORY_TEMPLATES.filter((x) => x.id !== 'bf' && x.id !== 'bfstory')) expect(fixedTemplateDescription(t.id)).toBeNull();
  });

  it('画面にも選んだテンプレートの説明が出る（既存テンプレートには出ない）', () => {
    expect(text(render('bfstory'))).toContain('ストーリーズ投稿（1080×1920）の2枚構成');
    expect(text(render('bfstory'))).not.toContain('フィード投稿（1080×1350）');
    expect(text(render('bf'))).toContain('商品数に応じて3〜4枚');
    expect(render('goods')).not.toContain('fixed-template-description');
  });
});

describe('⑥の保存ボタン', () => {
  it('ZIP のまとめて保存はストーリーズ版だけ出さない（1枚ずつPNG）。通常投稿版・既存テンプレートは従来どおり', () => {
    expect(allowsZipDownload('bfstory')).toBe(false);
    for (const t of STORY_TEMPLATES.filter((x) => x.id !== 'bfstory')) expect(allowsZipDownload(t.id)).toBe(true);
    const story = text(render('bfstory'));
    expect(story).not.toContain('まとめて保存（ZIP）');
    expect(story).toContain('1枚目');
    expect(story).toContain('2枚目');
    expect(story).toContain('story_bf_sale_story_snow-man_01.png、story_bf_sale_story_snow-man_02.png');
    expect(text(render('bf'))).toContain('3枚まとめて保存（ZIP）');
    // 既存テンプレート（標準版が2枚の A）は従来どおり ZIP あり
    expect(text(render('vod'))).toContain('2枚まとめて保存（ZIP）');
  });
});
