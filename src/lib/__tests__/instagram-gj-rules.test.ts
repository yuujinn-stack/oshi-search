import { describe, it, expect } from 'vitest';
import {
  checkSearchTooMuchEligibility, checkRealScreenBaseEligibility, decideRealScreenTemplate,
  buildSearchTooMuchCaption, buildRealScreenCaption,
} from '@/server/instagram-post/site-ui/gj-rules';
import { validateCaption } from '@/lib/instagram-caption-rules';
import { getSchedulableTemplateMeta, getScheduleTemplateMeta, getInstagramTemplateMeta } from '@/lib/instagram-templates';

const rich = { workCount: 78, productCount: 350, serviceCountExcludingYouTube: 18, streamingWorkCountExcludingYouTubeOnly: 49 };

describe('G・J は予約できるテンプレート（自動選択・手動投稿には入らない）', () => {
  it('表示名とID', () => {
    expect(getScheduleTemplateMeta('search-too-much')?.label).toBe('G 推し活、検索しすぎ問題');
    expect(getScheduleTemplateMeta('real-screen')?.label).toBe('J 実際の画面で見せる');
    expect(getSchedulableTemplateMeta('search-too-much')).toBeDefined();
    expect(getSchedulableTemplateMeta('real-screen')).toBeDefined();
    expect(getInstagramTemplateMeta('search-too-much')).toBeUndefined();
    expect(getInstagramTemplateMeta('real-screen')).toBeUndefined();
  });
});

describe('G の生成条件', () => {
  it('出演作品・配信サービス（YouTube系除く）・関連商品がそろえば生成可', () => {
    expect(checkSearchTooMuchEligibility(rich)).toEqual({ ok: true });
  });
  it('どれかが0件なら生成しない（2枚目の件数が0になるため）', () => {
    expect(checkSearchTooMuchEligibility({ ...rich, workCount: 0 })).toMatchObject({ ok: false });
    expect(checkSearchTooMuchEligibility({ ...rich, serviceCountExcludingYouTube: 0 })).toMatchObject({ ok: false });
    expect(checkSearchTooMuchEligibility({ ...rich, productCount: 0 })).toMatchObject({ ok: false });
  });
});

describe('J の生成条件とフォールバック（J → H → G）', () => {
  it('配信中の作品（YouTube系のみ除く）が3件未満・配信サービスなし・関連商品なしは J の前提を満たさない', () => {
    expect(checkRealScreenBaseEligibility(rich)).toEqual({ ok: true });
    expect(checkRealScreenBaseEligibility({ ...rich, streamingWorkCountExcludingYouTubeOnly: 2 })).toMatchObject({ ok: false });
    expect(checkRealScreenBaseEligibility({ ...rich, serviceCountExcludingYouTube: 0 })).toMatchObject({ ok: false });
    expect(checkRealScreenBaseEligibility({ ...rich, productCount: 0 })).toMatchObject({ ok: false });
    // J は3枚目で関連商品を見せるため、関連商品が3件未満なら作らない
    expect(checkRealScreenBaseEligibility({ ...rich, productCount: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/関連商品が2件/) });
    expect(checkRealScreenBaseEligibility({ ...rich, productCount: 3 })).toEqual({ ok: true });
  });
  it('画像のある作品が3件そろえば J', () => {
    expect(decideRealScreenTemplate({ base: { ok: true }, worksWithImage: 3, hOk: true, gOk: true })).toEqual({ use: 'J' });
  });
  it('画像のある作品が足りなければ H、H も無理なら G、どちらも無理なら作らない', () => {
    expect(decideRealScreenTemplate({ base: { ok: true }, worksWithImage: 2, hOk: true, gOk: true })).toMatchObject({ use: 'H', reason: expect.stringMatching(/画像のある配信中の作品が2件/) });
    expect(decideRealScreenTemplate({ base: { ok: false, reason: '配信中の作品（YouTube系のみを除く）が1件' }, worksWithImage: 0, hOk: false, gOk: true })).toMatchObject({ use: 'G' });
    expect(decideRealScreenTemplate({ base: { ok: false, reason: 'x' }, worksWithImage: 0, hOk: false, gOk: false })).toMatchObject({ use: 'none' });
  });
});

describe('G・J のキャプション', () => {
  it('人物名が入り、上限内でハッシュタグ3つ', () => {
    const g = buildSearchTooMuchCaption('久保史緒里');
    const j = buildRealScreenCaption('久保史緒里', { workCount: 78, serviceCount: 19, productCount: 350, productLabels: ['写真集・書籍', 'CD', 'Blu-ray・DVD', 'グッズ'] });
    expect(j).toContain('写真集・CD・Blu-ray/DVD・グッズなどの関連商品も、');
    expect(g.startsWith('久保史緒里の出演作品、配信先、関連商品。')).toBe(true);
    expect(j).toContain('出演作品 78件');
    expect(j).toContain('配信サービス 19社');
    expect(j).toContain('関連商品 350件');
    for (const c of [g, j]) {
      expect(validateCaption(c)).toBeNull();
      expect(c.trimEnd().endsWith('#推しサーチ\n#推し活\n#久保史緒里')).toBe(true);
    }
  });
});
