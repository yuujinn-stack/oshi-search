import { describe, expect, it } from 'vitest';
import {
  SITE_CTA_OPTIONS,
  SITE_MAX_SECONDS,
  SITE_TEMPLATE_IDS,
  SITE_TEMPLATE_STEPS,
  allocateSiteSlots,
  buildSiteCaption,
  buildSiteLinks,
  buildSitePlan,
  siteReadingOf,
  siteStepsFor,
  type SiteTarget,
  type SiteTemplateId,
} from '@/lib/video-site-reel';
import { OSHI_SITE_INPUT_KIND, TEMPLATE_INPUT_KINDS, parseOshiSiteInput, parseTemplateInput, TemplateInputError } from '@/lib/video-template-input';

const readings = { fixed: { 目黒蓮: 'めぐろれん', 'M!LK': 'みるく', 佐野勇斗: 'さのはやと', 北村匠海: 'きたむらたくみ', 'U-NEXT': 'ゆーねくすと', 北川景子: 'きたがわけいこ' }, registered: {} };
const p = (name: string) => ({ name, pagePath: `/person/${encodeURIComponent(name)}` });

const TARGETS: Record<SiteTemplateId, SiteTarget> = {
  site_person_search: { kind: 'person', ...p('目黒蓮') },
  site_group_member_search: { kind: 'group', name: 'M!LK', pagePath: '/groups/milk', member: p('佐野勇斗'), memberCount: 5 },
  site_work_cast_search: { kind: 'person', ...p('目黒蓮'), work: { id: 'tmdb-movie-1', title: 'SAKAMOTO DAYS', pagePath: '/work/tmdb-movie-1', from: p('目黒蓮'), to: p('北村匠海') } },
  site_three_person_search: { kind: 'person', ...p('目黒蓮'), persons: [p('目黒蓮'), p('佐野勇斗'), p('北川景子')] },
  site_live_search_demo: { kind: 'person', ...p('佐野勇斗') },
  site_subscription_diagnosis: { kind: 'group', name: 'M!LK', pagePath: '/groups/milk' },
  site_shopping_diagnosis: { kind: 'person', ...p('目黒蓮'), shopping: { use: 'gift', useLabel: 'プレゼントにする', budget: '5000', budgetLabel: '5,000円まで' } },
  site_photobook_search: { kind: 'person', ...p('北川景子') },
  site_fan_card_demo: { kind: 'person', ...p('目黒蓮'), card: { workIds: ['w1', 'w2'], variant: 'cute' } },
  site_vod_service_search: { kind: 'person', ...p('目黒蓮'), provider: { slug: 'u-next', name: 'U-NEXT', pagePath: '/vod/u-next' } },
};

describe('サイト誘導リール10種類の台本', () => {
  it('10種類すべて、冒頭 → テンプレートの手順 → 締め（1つ）の区間と台本を作り、24秒以内に収まる', () => {
    expect(SITE_TEMPLATE_IDS).toHaveLength(10);
    for (const id of SITE_TEMPLATE_IDS) {
      const plan = buildSitePlan({ templateId: id, target: TARGETS[id], cta: 'profile', readings });
      expect(plan.ok, id).toBe(true);
      if (!plan.ok) continue;
      const steps = siteStepsFor(id, TARGETS[id].persons?.length ?? 3);
      expect(plan.segments.map((s) => s.id)).toEqual(['hook', ...steps, 'cta'].map((k, i) => `${String(i + 1).padStart(2, '0')}-${k}`));
      expect(plan.lines.map((l) => l.id)).toEqual(plan.segments.map((s) => s.id));
      expect(plan.segments.filter((s) => s.kind === 'cta')).toHaveLength(1);
      expect(plan.lines[plan.lines.length - 1].text).toBe(SITE_CTA_OPTIONS.profile.text);
      expect(plan.totalSeconds).toBeLessThanOrEqual(SITE_MAX_SECONDS);
      expect(plan.totalSeconds).toBeGreaterThanOrEqual(15);
      expect(plan.segments[0].slotSeconds).toBeLessThanOrEqual(3.4);
      expect(plan.unresolved, id).toEqual([]);
      // 読みに漢字・英字を残さない（固定辞書の読みがある名前だけ）
      for (const l of plan.lines) expect(l.kana, `${id} ${l.id}`).not.toMatch(/[\p{Script=Han}A-Za-z]/u);
    }
  });

  it('冒頭の文はユーザー指定の文（グループは画面の人数、続けて検索は人数）', () => {
    const hook = (id: SiteTemplateId) => {
      const plan = buildSitePlan({ templateId: id, target: TARGETS[id], cta: 'profile', readings });
      return plan.ok ? plan.lines[0].text : '';
    };
    expect(hook('site_person_search')).toBe('推しの出演作品、まとめて探せるの知ってた？');
    expect(hook('site_group_member_search')).toBe('M!LKの5人、ここから探せます');
    expect(hook('site_work_cast_search')).toBe('この作品に出ている人、ほかに何に出てる？');
    expect(hook('site_three_person_search')).toBe('気になる3人、まとめて調べてみた');
    expect(hook('site_live_search_demo')).toBe('推しサーチで検索すると、こうなります');
    expect(hook('site_subscription_diagnosis')).toBe('推しを選んで、診断してみた');
    expect(hook('site_shopping_diagnosis')).toBe('推し活グッズ、用途と予算から探せます');
    expect(hook('site_photobook_search')).toBe('推しの写真集、ここからチェックできます');
    expect(hook('site_fan_card_demo')).toBe('推しを紹介するカード、作ってみた！');
    expect(hook('site_vod_service_search')).toBe('使っているサブスクから作品を探してみた');
  });

  it('2人だけのときは2人目の手順を使わない（人数の読みは「ふたり」）', () => {
    const plan = buildSitePlan({ templateId: 'site_three_person_search', target: { ...TARGETS.site_three_person_search, persons: [p('目黒蓮'), p('北川景子')] }, cta: 'try', readings });
    expect(plan.ok && plan.segments.map((s) => s.id)).toEqual(['01-hook', '02-first', '03-last', '04-cta']);
    expect(plan.ok && plan.lines[0].kana).toBe('きになるふたり、まとめてしらべてみた');
    expect(plan.ok && plan.lines[3].text).toBe(SITE_CTA_OPTIONS.try.text);
  });

  it('作品名・商品名は読み上げない。読みの無い名前は推測せず未登録として出す', () => {
    const plan = buildSitePlan({ templateId: 'site_work_cast_search', target: TARGETS.site_work_cast_search, cta: 'profile', readings });
    expect(plan.ok && plan.lines.map((l) => l.text).join('')).not.toContain('SAKAMOTO');
    const unknown = buildSitePlan({ templateId: 'site_person_search', target: { kind: 'person', ...p('未登録太郎') }, cta: 'profile', readings });
    expect(unknown.ok && unknown.unresolved).toEqual(['未登録太郎']);
    expect(siteReadingOf('あの', readings)).toBe('あの');
    expect(siteReadingOf('カタカナ', readings)).toBe('かたかな');
    expect(siteReadingOf('漢字', readings)).toBeNull();
  });

  it('お買い物診断は価格・購入先（楽天・外部サイト）の注記を付ける。対象が足りなければ作らない', () => {
    const plan = buildSitePlan({ templateId: 'site_shopping_diagnosis', target: TARGETS.site_shopping_diagnosis, cta: 'profile', readings });
    expect(plan.ok && plan.segments.find((s) => s.step === 'result')?.note).toMatch(/楽天.*外部/);
    expect(buildSitePlan({ templateId: 'site_shopping_diagnosis', target: { kind: 'person', ...p('目黒蓮') }, cta: 'profile', readings }).ok).toBe(false);
    expect(buildSitePlan({ templateId: 'site_vod_service_search', target: { kind: 'person', ...p('目黒蓮') }, cta: 'profile', readings }).ok).toBe(false);
  });

  it('リンク: 個別ページは正式なパス、UTM 付き、プロフィール用はトップページ', () => {
    const l = buildSiteLinks('site_work_cast_search', TARGETS.site_work_cast_search);
    expect(l.pageUrl).toBe('https://oshi-search.jp/work/tmdb-movie-1');
    expect(l.utmUrl).toBe('https://oshi-search.jp/work/tmdb-movie-1?utm_source=instagram&utm_medium=social&utm_campaign=site_referral&utm_content=site_work_cast_search');
    expect(l.profileUrl.startsWith('https://oshi-search.jp/?utm_source=instagram')).toBe(true);
    expect(buildSiteLinks('site_subscription_diagnosis', TARGETS.site_subscription_diagnosis).pageUrl).toBe('https://oshi-search.jp/oshi-vod');
    expect(buildSiteLinks('site_vod_service_search', TARGETS.site_vod_service_search).pageUrl).toBe('https://oshi-search.jp/vod/u-next');
    expect(buildSiteLinks('site_person_search', TARGETS.site_person_search).pageUrl).toBe(`https://oshi-search.jp/person/${encodeURIComponent('目黒蓮')}`);
  });

  it('投稿文案は締めの言葉1つ・URLを本文に入れない', () => {
    const c = buildSiteCaption({ templateId: 'site_person_search', title: 't', target: TARGETS.site_person_search, cta: 'profile' });
    expect(c).toContain(SITE_CTA_OPTIONS.profile.text);
    expect(c).not.toContain(SITE_CTA_OPTIONS.try.text);
    expect(c).not.toMatch(/https?:\/\//);
  });

  it('区間の長さ: 冒頭2.6〜3.4秒・操作3秒以上・締め2.8秒以上', () => {
    const slots = allocateSiteSlots([{ kind: 'hook' }, { kind: 'step' }, { kind: 'cta' }], [{ kana: 'あ' }, { kana: 'い' }, { kana: 'う' }]);
    expect(slots).toEqual([2.6, 3, 2.8]);
  });

  it('実画面を読む時間が必要な区間だけ長め（B1 の出演作品・B2 のメンバー一覧）。ほかのテンプレートは変わらない', () => {
    const seg = [{ kind: 'hook' as const }, { kind: 'step' as const, step: 'works' as const }, { kind: 'step' as const, step: 'members' as const }, { kind: 'cta' as const }];
    const kana = [{ kana: 'あ' }, { kana: 'い' }, { kana: 'う' }, { kana: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよ'.repeat(2) }];
    expect(allocateSiteSlots(seg, kana, 'site_person_search').slice(1, 3)).toEqual([3.4, 2.6]);
    expect(allocateSiteSlots(seg, kana, 'site_group_member_search').slice(1, 3)).toEqual([2.6, 3.6]);
    expect(allocateSiteSlots(seg, kana, 'site_work_cast_search').slice(1, 3)).toEqual([2.6, 2.6]);
  });

  it('手順の定義は oshi-video-maker と同じ（10種類）', () => {
    expect(Object.keys(SITE_TEMPLATE_STEPS)).toEqual([...SITE_TEMPLATE_IDS]);
    expect(SITE_TEMPLATE_STEPS.site_live_search_demo).toEqual(['typing', 'opening', 'scrolling']);
  });
});

describe('サイト誘導リールの template_input', () => {
  const lines = [
    { id: '01-hook', text: 'a', kana: 'あ' },
    { id: '02-search', text: 'b', kana: 'い' },
    { id: '03-cta', text: 'c', kana: 'う' },
  ];
  it('入力の種類に登録され、画面から送られたパス・区間は受け取らない', () => {
    expect(TEMPLATE_INPUT_KINDS).toContain(OSHI_SITE_INPUT_KIND);
    const parsed = parseTemplateInput(OSHI_SITE_INPUT_KIND, { version: 1, siteSelection: { kind: 'person', name: '目黒蓮' }, cta: { key: 'try' }, lines, siteTarget: { pagePath: '/evil' }, segments: [] });
    expect(parsed).toEqual({ version: 1, templateCategory: 'site_referral', siteSelection: expect.objectContaining({ kind: 'person', name: '目黒蓮' }), cta: { key: 'try' }, lines });
    expect('siteTarget' in parsed).toBe(false);
  });
  it('台本が無い・名前が無いジョブは作らない（CapCut 音声付きは元のジョブから付け直す）', () => {
    expect(() => parseOshiSiteInput({ siteSelection: { kind: 'person', name: '目黒蓮' }, lines: [] })).toThrow(TemplateInputError);
    expect(() => parseOshiSiteInput({ siteSelection: { kind: 'person', name: '' }, lines })).toThrow(TemplateInputError);
    const audio = { sourceJobId: '12345678-1234-1234-1234-123456789012', wavUrl: 'https://x.public.blob.vercel-storage.com/video-jobs/12345678-1234-1234-1234-123456789012/capcut-a.wav', srtUrl: 'https://x.public.blob.vercel-storage.com/video-jobs/12345678-1234-1234-1234-123456789012/capcut-a.srt' };
    expect(parseOshiSiteInput({ siteSelection: { kind: 'person', name: '目黒蓮' }, lines: [], audio }).audio?.sourceJobId).toBe(audio.sourceJobId);
  });
});
