import { describe, expect, it } from 'vitest';
import {
  SALE_SITE_TEMPLATE_IDS,
  SALE_SITE_TIMING,
  SITE_CTA_OPTIONS,
  SITE_MAX_SECONDS,
  SITE_TEMPLATE_STEPS,
  allocateSiteSlots,
  buildSaleCaption,
  buildSiteLinks,
  buildSitePlan,
  isSaleSiteTemplateId,
  isSiteTemplateId,
  siteCtaOf,
  splitSaleTitle,
  type SaleSiteTemplateId,
  type SiteTarget,
} from '@/lib/video-site-reel';
import { SALE_VIDEO_CONFIGS, type SaleVideoConfig } from '@/lib/sale-video/config';
import { checkSaleVideoState, pickSaleVideo, type SaleVideoState } from '@/lib/sale-video/core';
import { SALE_CORNERS, type SaleCornerConfig } from '@/lib/sale-corner/config';
import { BUDGET_OPTIONS } from '@/lib/oshi-shopping/params';
import { parseOshiSiteInput } from '@/lib/video-template-input';

const T = (iso: string) => Date.parse(iso);
const BEFORE = T('2026-11-18T18:00:00+09:00');
const START = T('2026-11-19T20:00:00+09:00');
const END = T('2026-11-25T01:59:00+09:00');

const readings = { fixed: { 'M!LK': 'みるく', 'Snow Man': 'すのーまん', 目黒蓮: 'めぐろれん', 佐野勇斗: 'さのはやと' }, registered: {} };
const p = (name: string) => `/person/${encodeURIComponent(name)}`;

function state(nowMs: number): SaleVideoState {
  const v = pickSaleVideo(nowMs);
  if (!v) throw new Error('sale not found');
  return v.state;
}

function targets(sale: SaleVideoState): Record<SaleSiteTemplateId, SiteTarget> {
  return {
    site_bf_goods: { kind: 'group', name: 'Snow Man', pagePath: '/groups/snow-man', sale, live: { groupName: 'Snow Man', listPath: '/groups/snow-man/live', performances: 8 } },
    site_bf_live: { kind: 'person', name: '佐野勇斗', pagePath: p('佐野勇斗'), sale, live: { groupName: 'M!LK', listPath: '/groups/M!LK/live', performances: 5 } },
    site_bf_shopping: { kind: 'person', name: '目黒蓮', pagePath: p('目黒蓮'), sale, shopping: { use: 'collection', useLabel: '自分用に集める', budget: '5000', budgetLabel: '5,000円まで' } },
  };
}

describe('期間限定セール（楽天ブラックフライデー）の開催状態', () => {
  it('日時はトップの特設コーナー（SALE_CORNERS）と同じ。開催前は告知・開催中・終了後は null', () => {
    for (const v of SALE_VIDEO_CONFIGS) expect(SALE_CORNERS.some((c) => c.id === v.saleCornerId), v.saleCornerId).toBe(true);
    expect(pickSaleVideo(BEFORE)?.state.phase).toBe('upcoming');
    expect(pickSaleVideo(BEFORE)?.state.badge).toBe('楽天ブラックフライデー 11月19日20時スタート');
    expect(pickSaleVideo(START - 1)?.state.phase).toBe('upcoming');
    expect(pickSaleVideo(START)?.state.phase).toBe('active');
    expect(pickSaleVideo(START)?.state.badge).toBe('楽天ブラックフライデー開催中');
    expect(pickSaleVideo(END - 1)?.state.phase).toBe('active');
    expect(pickSaleVideo(END)).toBeNull();
    expect(pickSaleVideo(T('2026-12-01T00:00:00+09:00'))).toBeNull();
  });

  it('日時をコードに固定しない: 設定の日時を変えると判定も変わる・日時が不正なら使わない', () => {
    const corner: SaleCornerConfig = { ...SALE_CORNERS[0], id: 'next-sale', startsAt: '2027-03-04T20:00:00+09:00', endsAt: '2027-03-11T01:59:00+09:00' };
    const video: SaleVideoConfig = { ...SALE_VIDEO_CONFIGS[0], saleCornerId: 'next-sale', name: '楽天スーパーSALE', activeBadge: '楽天スーパーSALE開催中' };
    expect(pickSaleVideo(T('2027-03-01T00:00:00+09:00'), [video], [corner])?.state).toMatchObject({ id: 'next-sale', phase: 'upcoming', badge: '楽天スーパーSALE 3月4日20時スタート' });
    expect(pickSaleVideo(T('2027-03-05T00:00:00+09:00'), [video], [corner])?.state.phase).toBe('active');
    expect(pickSaleVideo(T('2027-03-12T00:00:00+09:00'), [video], [corner])).toBeNull();
    expect(pickSaleVideo(T('2027-03-05T00:00:00+09:00'), [video], [{ ...corner, endsAt: 'invalid' }])).toBeNull();
    expect(pickSaleVideo(T('2027-03-05T00:00:00+09:00'), [video], [])).toBeNull();
  });

  it('保存した状態の確認: 終了後・開催状態が変わったら拒否する', () => {
    const before = state(BEFORE);
    expect(checkSaleVideoState(before, BEFORE)).toEqual({ ok: true });
    const changed = checkSaleVideoState(before, START);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.reason).toContain('台本を作り直して');
    const active = state(START);
    expect(checkSaleVideoState(active, END - 1)).toEqual({ ok: true });
    const ended = checkSaleVideoState(active, END);
    expect(ended.ok).toBe(false);
    if (!ended.ok) expect(ended.reason).toContain('終了');
  });
});

describe('期間限定セールのリール A・B・C の台本', () => {
  it('3種類はサイト誘導リールの入力の種類で作り、手順は oshi-video-maker と同じ', () => {
    expect(SALE_SITE_TEMPLATE_IDS).toEqual(['site_bf_goods', 'site_bf_live', 'site_bf_shopping']);
    for (const id of SALE_SITE_TEMPLATE_IDS) expect(isSiteTemplateId(id) && isSaleSiteTemplateId(id)).toBe(true);
    expect(isSaleSiteTemplateId('site_shopping_diagnosis')).toBe(false);
    expect(SITE_TEMPLATE_STEPS.site_bf_goods).toEqual(['intro', 'search', 'goods', 'live']);
    expect(SITE_TEMPLATE_STEPS.site_bf_live).toEqual(['intro', 'corner', 'list', 'discs']);
    expect(SITE_TEMPLATE_STEPS.site_bf_shopping).toEqual(['intro', 'entry', 'pick', 'answers', 'result']);
  });

  for (const [label, now] of [['開催前', BEFORE], ['開催中', START + 1000]] as const) {
    it(`${label}: 冒頭 → 手順 → 締め（セールの設定の文）。17〜20秒・冒頭は短く・読みはひらがなだけ`, () => {
      const sale = state(now);
      const ts = targets(sale);
      const expectSeconds = { site_bf_goods: [17.5, 19], site_bf_live: [19.5, 21], site_bf_shopping: [20.5, 22] } as const;
      for (const id of SALE_SITE_TEMPLATE_IDS) {
        const plan = buildSitePlan({ templateId: id, target: ts[id], cta: 'sale', readings });
        expect(plan.ok, id).toBe(true);
        if (!plan.ok) continue;
        expect(plan.segments.map((s) => s.id)).toEqual(['hook', ...SITE_TEMPLATE_STEPS[id], 'cta'].map((k, i) => `${String(i + 1).padStart(2, '0')}-${k}`));
        expect(plan.lines[plan.lines.length - 1].text).toBe(siteCtaOf(id, 'sale', sale)!.text);
        expect(plan.segments.at(-1)!.sub).toBe('推しサーチで検索！');
        expect(plan.totalSeconds, id).toBeGreaterThanOrEqual(expectSeconds[id][0]);
        expect(plan.totalSeconds, id).toBeLessThanOrEqual(expectSeconds[id][1]);
        expect(plan.totalSeconds).toBeLessThanOrEqual(SITE_MAX_SECONDS);
        // 0〜1.5秒 大きなセール名、1.5〜3.5秒 テンプレートごとの一言（実画面の操作は3.5秒から）
        expect(plan.segments[0].slotSeconds, id).toBe(1.5);
        expect(plan.segments[1]).toMatchObject({ step: 'intro', slotSeconds: 2, sub: ts[id].name });
        expect(plan.segments[1].label).toBeUndefined();
        expect(plan.segments[2].label?.startsWith('①')).toBe(true);
        expect(plan.lines[0].text).toBe('楽天ブラックフライデーセール！');
        expect(plan.segments[0].title).toBe('楽天\nブラック\nフライデー\nセール！');
        expect(plan.segments[0].title!.replace(/\n/g, '')).toBe(plan.lines[0].text);
        expect(plan.unresolved, id).toEqual([]);
        for (const l of plan.lines) expect(l.kana, `${id} ${l.id}`).not.toMatch(/[\p{Script=Han}A-Za-z0-9]/u);
        expect(plan.title.startsWith(plan.lines[0].text)).toBe(true);
        expect(plan.links.utmUrl).toContain(`utm_campaign=${sale.id}`);
      }
    });
  }

  it('冒頭の一言は A・B・C ごと。B は開催前「前に」・開催中「の間に」', () => {
    const intro = (id: SaleSiteTemplateId, now: number) => {
      const plan = buildSitePlan({ templateId: id, target: targets(state(now))[id], cta: 'sale', readings });
      return plan.ok ? plan.lines[1].text : '';
    };
    expect(intro('site_bf_goods', BEFORE)).toBe('推しグッズ、損しないための探し方！');
    expect(intro('site_bf_goods', START)).toBe('推しグッズ、損しないための探し方！');
    expect(intro('site_bf_live', BEFORE)).toBe('ブラックフライデー前に、過去ライブをチェック！');
    expect(intro('site_bf_live', START)).toBe('ブラックフライデーの間に、過去ライブをチェック！');
    expect(intro('site_bf_shopping', BEFORE)).toBe('推しグッズ、予算内で失敗しない探し方！');
    expect(splitSaleTitle('楽天ブラックフライデーセール！')).toBe('楽天ブラックフライデー\nセール！');
  });

  it('依頼の構成どおりの区間の長さ（読みが短ければそのまま）', () => {
    expect(SALE_SITE_TIMING.site_bf_goods.reduce((a, b) => a + b)).toBe(17.5);
    expect(SALE_SITE_TIMING.site_bf_live.reduce((a, b) => a + b)).toBe(19.5);
    expect(SALE_SITE_TIMING.site_bf_shopping.reduce((a, b) => a + b)).toBe(20.5);
    const segs = [{ kind: 'hook' as const }, { kind: 'step' as const, step: 'intro' as const }, { kind: 'step' as const }, { kind: 'step' as const }, { kind: 'step' as const }, { kind: 'cta' as const }];
    expect(allocateSiteSlots(segs, segs.map(() => ({ kana: 'あ' })), 'site_bf_goods')).toEqual([1.5, 2, 3, 4, 4, 3]);
    // 冒頭の2区間は読みが長くても構成どおり（音声付きは Worker が読み上げに合わせて延ばす）
    const long = 'あいうえおかきくけこさしすせそたちつてと';
    expect(allocateSiteSlots(segs, [{ kana: long }, { kana: long }, ...segs.slice(2).map(() => ({ kana: 'あ' }))], 'site_bf_goods').slice(0, 2)).toEqual([1.5, 2]);
  });

  it('対象が足りなければ作らない（A・B はライブ映像のコーナー、C は用途、セールが無い）', () => {
    const sale = state(BEFORE);
    expect(buildSitePlan({ templateId: 'site_bf_goods', target: { kind: 'group', name: 'X', pagePath: '/groups/x', sale }, cta: 'sale', readings }).ok).toBe(false);
    expect(buildSitePlan({ templateId: 'site_bf_live', target: { kind: 'group', name: 'X', pagePath: '/groups/x', sale }, cta: 'sale', readings }).ok).toBe(false);
    expect(buildSitePlan({ templateId: 'site_bf_shopping', target: { kind: 'person', name: '目黒蓮', pagePath: p('目黒蓮'), sale }, cta: 'sale', readings }).ok).toBe(false);
    const noSale = { ...targets(sale).site_bf_goods, sale: null };
    expect(buildSitePlan({ templateId: 'site_bf_goods', target: noSale, cta: 'sale', readings }).ok).toBe(false);
    // セールのリールの締めは profile/try を使わない。ほかのテンプレートは sale を使わない
    expect(buildSitePlan({ templateId: 'site_bf_goods', target: targets(sale).site_bf_goods, cta: 'profile', readings }).ok).toBe(false);
    expect(siteCtaOf('site_person_search', 'sale')).toBeNull();
    expect(siteCtaOf('site_person_search', 'profile')?.text).toBe(SITE_CTA_OPTIONS.profile.text);
  });

  it('リンク: A は対象のページ、B はライブ映像の一覧、C はお買い物診断', () => {
    const ts = targets(state(BEFORE));
    expect(buildSiteLinks('site_bf_goods', ts.site_bf_goods).pageUrl).toBe('https://oshi-search.jp/groups/snow-man');
    expect(buildSiteLinks('site_bf_live', ts.site_bf_live).pageUrl).toBe('https://oshi-search.jp/groups/M!LK/live');
    expect(buildSiteLinks('site_bf_shopping', ts.site_bf_shopping).pageUrl).toBe('https://oshi-search.jp/oshi-shopping');
  });

  it('C の予算はお買い物診断の選択肢にある（セールの設定の値）', () => {
    for (const v of SALE_VIDEO_CONFIGS) expect(BUDGET_OPTIONS.some((b) => b.value === v.shoppingBudget)).toBe(true);
  });
});

describe('期間限定セールのリールの文言の決まり', () => {
  const NG = [/まだ買ってない/, /半額/, /\d+\s*%/, /％/, /OFF/i, /割引/, /値引/, /最安/, /激安/, /ポイント\d+倍/, /倍/, /今だけ/, /急いで/, /売り切れ/, /エントリー/, /還元/, /お得/, /必ず/, /確実/, /保証/, /もらえる/, /安く/];
  const texts = (v: SaleVideoConfig) => [
    v.name,
    v.activeBadge,
    v.title.text,
    ...(['upcoming', 'active'] as const).flatMap((ph) => [v.intro.goods[ph].text, v.intro.live[ph].text, v.intro.shopping[ph].text]),
    ...Object.values(v.cta).flatMap((c) => [c.text, c.title, c.sub]),
  ];

  it('禁止表現・確認できないセール価格・割引率・ポイント・条件を入れない', () => {
    for (const v of SALE_VIDEO_CONFIGS) for (const t of texts(v)) for (const ng of NG) expect(t, t).not.toMatch(ng);
    const sale = state(BEFORE);
    for (const id of SALE_SITE_TEMPLATE_IDS) {
      const plan = buildSitePlan({ templateId: id, target: targets(sale)[id], cta: 'sale', readings });
      if (!plan.ok) throw new Error(id);
      for (const l of plan.lines) for (const ng of NG) expect(l.text, l.text).not.toMatch(ng);
    }
  });

  it('特典の注記: エントリーと条件が必要なことを伝え、値引き・還元を保証しない', () => {
    for (const v of SALE_VIDEO_CONFIGS) {
      expect(v.entryNote).toMatch(/エントリー/);
      expect(v.entryNote).toMatch(/条件/);
      expect(v.entryNote).not.toMatch(/必ず|確実|保証|もらえる|\d+倍|半額|%|％/);
    }
  });

  it('読みはひらがなだけ（音声用）', () => {
    for (const v of SALE_VIDEO_CONFIGS) {
      const kanas = [v.title.kana, ...(['upcoming', 'active'] as const).flatMap((ph) => [v.intro.goods[ph].kana, v.intro.live[ph].kana, v.intro.shopping[ph].kana]), ...Object.values(v.cta).map((c) => c.kana)];
      for (const k of kanas) expect(k, k).toMatch(/^[\p{Script=Hiragana}ー、。！？\s]+$/u);
    }
  });

  it('投稿文の先頭に PR 表記。日時はセールの設定の日時、参加条件・ポイントは公式ページで確認する案内だけ', () => {
    const sale = state(BEFORE);
    const ts = targets(sale);
    for (const id of SALE_SITE_TEMPLATE_IDS) {
      const plan = buildSitePlan({ templateId: id, target: ts[id], cta: 'sale', readings });
      if (!plan.ok) throw new Error(id);
      const caption = buildSaleCaption(id, plan.title, ts[id]);
      expect(caption.startsWith('PR（楽天アフィリエイト広告を含みます）')).toBe(true);
      expect(caption).toContain('楽天ブラックフライデー：11/19 20:00〜11/25 1:59（日本時間）');
      expect(caption).toContain('#PR');
      expect(caption).not.toMatch(/https?:\/\//);
      expect(caption).not.toMatch(/まだ買ってない|半額|最安/);
    }
  });
});

describe('期間限定セールのリールの template_input', () => {
  it('締めの言葉 sale を受け取る（それ以外の値は従来どおり profile）', () => {
    const lines = [
      { id: '01-hook', text: 'a', kana: 'あ' },
      { id: '02-search', text: 'b', kana: 'い' },
      { id: '03-cta', text: 'c', kana: 'う' },
    ];
    expect(parseOshiSiteInput({ version: 1, siteSelection: { kind: 'group', name: 'M!LK' }, cta: { key: 'sale' }, lines }).cta.key).toBe('sale');
    expect(parseOshiSiteInput({ version: 1, siteSelection: { kind: 'group', name: 'M!LK' }, cta: { key: 'xxx' }, lines }).cta.key).toBe('profile');
  });
});
