import { describe, expect, it } from 'vitest';
import {
  REGISTERED_GRID_DENSE,
  REGISTERED_GRID_STANDARD,
  REGISTERED_REEL_IDS,
  REGISTERED_REEL_LONG_MAX_SECONDS,
  REGISTERED_STORY_MAX_SECONDS,
  REGISTERED_REEL_MAX_SECONDS,
  REGISTERED_STORY_IDS,
  REGISTERED_TEMPLATE_IDS,
  allocateRegisteredSlots,
  applyRegisteredSelection,
  buildRegisteredPlan,
  isWideName,
  kumiKana,
  ninKana,
  paginateRegistered,
  registeredCategoryOf,
  registeredReelMaxSeconds,
  type RegisteredGroup,
  type RegisteredPage,
} from '../video-registered-groups';
import { getHomeGroupCategory } from '../home-group-category';
import { parseOshiRegisteredInput, parseTemplateInput, OSHI_REGISTERED_INPUT_KIND, TemplateInputError } from '../video-template-input';

// 現在の本番と同じ並び・名前（2026-11-01 時点のトップページ「グループで探す」）
const NAMES = [
  '乃木坂46', '日向坂46', '櫻坂46', 'オードリー', 'バナナマン', '欅坂46', '＝LOVE', 'DISH//', 'D-BOYS', 'FRUITS ZIPPER', 'Snow Man', 'SixTONES', '嵐',
  'THE ORAL CIGARETTES', 'BLUE ENCOUNT', 'M!LK', 'SPYAIR', 'UVERworld', 'モナキ', 'timelesz', 'Travis Japan', 'なにわ男子', 'Aぇ! group', 'King & Prince', 'Number_i',
];
const groups = (names = NAMES): RegisteredGroup[] => names.map((name) => ({ name, category: registeredCategoryOf(name), href: `/groups/${encodeURIComponent(name)}` }));
const plan = (templateId: (typeof REGISTERED_TEMPLATE_IDS)[number], over: Partial<Parameters<typeof buildRegisteredPlan>[0]> = {}) =>
  buildRegisteredPlan({ templateId, groups: groups(), personCount: 373, selection: { order: null, excluded: [] }, ...over });
const listedNames = (pages: RegisteredPage[]) => pages.flatMap((p) => p.items.map((it) => it.name));

describe('登録グループ紹介: ジャンル', () => {
  it('トップページの明示的な分類だけを使い、一覧に無いグループは「分類なし」（推測しない）。トップページの絞り込みは従来どおり「その他」', () => {
    expect(registeredCategoryOf('Snow Man')).toBe('male');
    expect(registeredCategoryOf('＝LOVE')).toBe('female'); // NFKC で =LOVE と照合
    expect(registeredCategoryOf('オードリー')).toBe('other');
    for (const n of ['Aぇ! group', 'King & Prince', 'Number_i']) {
      expect(registeredCategoryOf(n)).toBe('male');
      expect(getHomeGroupCategory(n)).toBe('maleIdol');
    }
    expect(registeredCategoryOf('新しいグループ')).toBe('unclassified');
    expect(getHomeGroupCategory('新しいグループ')).toBe('other');
    // 現在の登録25組はすべてトップページの分類に載っている
    expect(NAMES.filter((n) => registeredCategoryOf(n) === 'unclassified')).toEqual([]);
    expect(getHomeGroupCategory('乃木坂46')).toBe('femaleIdol');
  });
});

describe('登録グループ紹介: 10種類の構成', () => {
  it('10種類すべて作れ、件数と一覧のグループ数が一致し、重複しない。リールは区間と台本が同じ数、ストーリーズは台本なし', () => {
    expect(REGISTERED_TEMPLATE_IDS).toHaveLength(10);
    for (const id of REGISTERED_TEMPLATE_IDS) {
      const p = plan(id);
      expect(p.ok, id).toBe(true);
      if (!p.ok) continue;
      const names = listedNames(p.segments.flatMap((s) => s.pages ?? []));
      expect(names.length, id).toBe(p.counts.shown);
      expect(new Set(names).size, id).toBe(names.length);
      expect(p.counts).toMatchObject({ persons: 373, groups: 25 });
      if ((REGISTERED_REEL_IDS as readonly string[]).includes(id)) {
        expect(p.lines.map((l) => l.id)).toEqual(p.segments.map((s) => s.id));
        expect(p.segments[0].kind).toBe('hook');
        // グループ名は読み上げない（読みに漢字・英字・数字が残らない）
        for (const l of p.lines) expect(l.kana, `${id} ${l.id}`).not.toMatch(/[\p{Script=Han}A-Za-z0-9]/u);
      } else {
        expect(p.lines).toEqual([]);
        expect(p.segments.some((s) => s.kind === 'screen')).toBe(false);
      }
      // 見出しごとの件数 = その見出しのページの合計
      for (const pg of p.segments.flatMap((s) => s.pages ?? [])) {
        const same = p.segments.flatMap((s) => s.pages ?? []).filter((q) => q.heading === pg.heading);
        expect(same.reduce((a, q) => a + q.items.length, 0)).toBe(pg.count);
        expect(same).toHaveLength(pg.parts);
      }
    }
  });

  it('全グループはジャンル別（男性10・女性6・その他9）。分類なしの見出しは出ない。男性・女性・その他の動画に分類なしは入らない', () => {
    const all = plan('registered_groups_all');
    if (!all.ok) throw new Error('plan');
    expect(all.segments[1].pages!.map((p) => [p.heading, p.count])).toEqual([
      ['男性アイドル', 10],
      ['女性アイドル', 6],
      ['バンド・アーティスト・お笑いなど', 9],
    ]);
    expect(all.warnings.join()).not.toContain('分類なし');
    const withNew = plan('registered_groups_all', { groups: groups([...NAMES, '新しいグループ']) });
    if (!withNew.ok) throw new Error('withNew');
    expect(withNew.segments[1].pages!.at(-1)).toMatchObject({ heading: '分類なし', count: 1 });
    expect(withNew.warnings.join()).toContain('新しいグループ');
    for (const id of ['registered_groups_male', 'story_registered_groups_male'] as const) {
      const p = plan(id);
      if (!p.ok) throw new Error(id);
      expect(p.shownGroups).toEqual(['Snow Man', 'SixTONES', '嵐', 'M!LK', 'timelesz', 'Travis Japan', 'なにわ男子', 'Aぇ! group', 'King & Prince', 'Number_i']);
    }
    const other = plan('registered_groups_other');
    if (!other.ok) throw new Error('other');
    expect(other.shownGroups).not.toContain('Number_i');
    const otherNew = plan('registered_groups_other', { groups: groups([...NAMES, '新しいグループ']) });
    if (!otherNew.ok) throw new Error('otherNew');
    expect(otherNew.shownGroups).not.toContain('新しいグループ');
    expect(other.shownGroups).toHaveLength(9);
  });

  it('リールの台本: 件数の読み・締めの文。登録状況は人物数とグループ数', () => {
    const male = plan('registered_groups_male');
    if (!male.ok) throw new Error('male');
    expect(male.lines[1]).toMatchObject({ text: '現在登録中のグループはこちら！10組を紹介します。', kana: 'げんざいとうろくちゅうのぐるーぷはこちら！じゅうくみをしょうかいします。' });
    expect(male.lines.at(-1)!.text).toBe('これからも登録グループを増やしていきます！引き続き、推しサーチをよろしくお願いします！');
    const progress = plan('registered_groups_progress');
    if (!progress.ok) throw new Error('progress');
    expect(progress.segments.map((s) => s.kind)).toEqual(['hook', 'stats', 'screen', 'message', 'outro']);
    expect(progress.segments[1].stats).toEqual({ persons: 373, groups: 25 });
    expect(progress.lines[1].kana).toBe('じんぶつさんびゃくななじゅうさんにん、ぐるーぷにじゅうごくみがとうろくちゅう！');
    expect(progress.lines[3].text).toBe('これからも人物や出演作品の情報を増やしていきます！');
    expect([kumiKana(1), kumiKana(2), kumiKana(4), ninKana(4), ninKana(14), ninKana(2)]).toEqual(['ひとくみ', 'ふたくみ', 'よんくみ', 'よにん', 'じゅうよにん', 'ふたり']);
  });

  it('リールの長さは15〜18秒の目安に収まる（音声なしの見積もり）。ストーリーズは7秒以上で一覧は1ページ3秒', () => {
    for (const id of REGISTERED_REEL_IDS) {
      const p = plan(id);
      if (!p.ok) throw new Error(id);
      const total = p.segments.reduce((a, s) => a + s.slotSeconds, 0);
      expect(total, id).toBeGreaterThanOrEqual(15);
      expect(total, id).toBeLessThanOrEqual(18);
    }
    for (const id of REGISTERED_STORY_IDS) {
      const p = plan(id);
      if (!p.ok) throw new Error(id);
      const total = p.segments.reduce((a, s) => a + s.slotSeconds, 0);
      expect(total, id).toBeGreaterThanOrEqual(7);
      const list = p.segments.find((s) => s.kind === 'list')!;
      expect(list.slotSeconds / list.pages!.length, id).toBeGreaterThanOrEqual(2.9);
    }
    expect(allocateRegisteredSlots('story', [{ kind: 'hook' }, { kind: 'list', pages: [] }, { kind: 'outro' }], []).reduce((a, b) => a + b, 0)).toBeCloseTo(7.2, 1);
  });

  it('除外・並べ替え: 表示件数が減り「登録 n組のうち」と出す。並べた順がページの順になる。登録に無い名前は作らない', () => {
    const p = plan('registered_groups_male', { selection: { order: ['なにわ男子', 'M!LK'], excluded: ['嵐'] } });
    if (!p.ok) throw new Error('male');
    expect(p.shownGroups.slice(0, 2)).toEqual(['なにわ男子', 'M!LK']);
    expect(p.shownGroups).not.toContain('嵐');
    expect(p.counts).toMatchObject({ shown: 9, excluded: 1 });
    const story = plan('story_registered_groups_male', { selection: { order: null, excluded: ['嵐'] } });
    if (!story.ok) throw new Error('story');
    expect(story.segments[0].lines).toEqual(['9組（登録 10組のうち）']);
    const bad = plan('registered_groups_all', { selection: { order: ['存在しないグループ'], excluded: [] } });
    expect(bad.ok).toBe(false);
    const empty = plan('registered_groups_female', { selection: { order: null, excluded: ['乃木坂46', '日向坂46', '櫻坂46', '欅坂46', '＝LOVE', 'FRUITS ZIPPER'] } });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.missing.join()).toContain('すべて除外');
    expect(applyRegisteredSelection(groups(), { order: ['嵐', '嵐'], excluded: [] }).ordered).toHaveLength(25);
  });

  it('グループ数が増えると自動でページを分け、長い名前は1段。リールは4ページを超えると3列×6段・上限30秒', () => {
    const many = [...NAMES, ...Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `とても長いテスト用のグループ名${i}` : `テスト${i}`))];
    const s = buildRegisteredPlan({ templateId: 'story_registered_groups_all', groups: groups(many), personCount: 400, selection: { order: null, excluded: [] } });
    if (!s.ok) throw new Error('story');
    const pages = s.segments[1].pages!;
    expect(listedNames(pages)).toHaveLength(65);
    expect(pages.every((p) => p.columns === 2 && p.rows === 5)).toBe(true);
    const r = buildRegisteredPlan({ templateId: 'registered_groups_all', groups: groups(many), personCount: 400, selection: { order: null, excluded: [] } });
    if (!r.ok) throw new Error('reel');
    expect(r.segments[1].pages!.every((p) => p.columns === 3 && p.rows === 6)).toBe(true);
    expect(listedNames(r.segments[1].pages!)).toHaveLength(65);
    expect(registeredReelMaxSeconds(r.segments)).toBe(REGISTERED_REEL_LONG_MAX_SECONDS);
    const normal = plan('registered_groups_all');
    if (!normal.ok) throw new Error('all');
    expect(registeredReelMaxSeconds(normal.segments)).toBe(REGISTERED_REEL_MAX_SECONDS);
    expect(r.warnings.join()).toContain('3列×6段');
  });

  it('ストーリーズ1本（60秒）に収まらない一覧は作らず、除外して複数本に分けるよう伝える（黙って省略しない）', () => {
    const huge = [...NAMES, ...Array.from({ length: 200 }, (_, i) => `テスト${i}`)];
    const s = buildRegisteredPlan({ templateId: 'story_registered_groups_all', groups: groups(huge), personCount: 400, selection: { order: null, excluded: [] } });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.missing.join()).toMatch(/2本以上に分けて/);
    const half = huge.slice(100);
    const part = buildRegisteredPlan({ templateId: 'story_registered_groups_all', groups: groups(huge), personCount: 400, selection: { order: null, excluded: half } });
    expect(part.ok).toBe(true);
    if (part.ok) expect(part.segments.reduce((a, x) => a + x.slotSeconds, 0)).toBeLessThanOrEqual(REGISTERED_STORY_MAX_SECONDS);
  });

  it('ページ分け: 2列×5段に並べた順で置き、長い名前（THE ORAL CIGARETTES など）は1段。前の段の右が空いた分も数える', () => {
    expect(isWideName('THE ORAL CIGARETTES')).toBe(true);
    expect(isWideName('BLUE ENCOUNT')).toBe(false);
    expect(isWideName('Snow Man', REGISTERED_GRID_DENSE)).toBe(false);
    expect(isWideName('FRUITS ZIPPER', REGISTERED_GRID_DENSE)).toBe(true);
    const names = ['A', 'THE ORAL CIGARETTES', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    // A(1段目左) / THE ORAL…(2段目) / B C(3段目) / D E(4段目) / F G(5段目) → H は次のページ
    expect(paginateRegistered(names, REGISTERED_GRID_STANDARD).map((p) => p.map((it) => it.name))).toEqual([['A', 'THE ORAL CIGARETTES', 'B', 'C', 'D', 'E', 'F', 'G'], ['H']]);
    expect(paginateRegistered(Array.from({ length: 21 }, (_, i) => `G${i}`))).toHaveLength(3);
  });
});

describe('登録グループ紹介: 管理画面からの入力', () => {
  it('除外・並べ替え・台本だけを受け取る（区間・件数は受け取らない）。不正な値は拒否', () => {
    const parsed = parseOshiRegisteredInput({ version: 1, selection: { order: ['嵐'], excluded: ['M!LK', 'M!LK'] }, lines: [{ id: '01-hook', text: 'あ', kana: 'あ' }], segments: [{ id: 'x' }], counts: { shown: 999 } });
    expect(parsed).toEqual({ version: 1, templateCategory: 'registered_groups', selection: { order: ['嵐'], excluded: ['M!LK'] }, lines: [{ id: '01-hook', text: 'あ', kana: 'あ' }] });
    expect(parseTemplateInput(OSHI_REGISTERED_INPUT_KIND, { version: 1, selection: { order: null, excluded: [] }, lines: [] })).toMatchObject({ templateCategory: 'registered_groups' });
    expect(() => parseOshiRegisteredInput({ version: 1, selection: { excluded: [1] }, lines: [] })).toThrow(TemplateInputError);
    expect(() => parseOshiRegisteredInput({ version: 1, selection: {}, lines: [{ id: 'bad', text: 'a', kana: 'a' }] })).toThrow(TemplateInputError);
    expect(() => parseOshiRegisteredInput({ version: 1, selection: {}, lines: [], audio: { sourceJobId: 'x', wavUrl: 'https://evil.example/a.wav', srtUrl: '' } })).toThrow(TemplateInputError);
  });
});
