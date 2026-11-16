import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RakutenItem } from '@/types/rakuten';

// DB を読むモジュールはテストではモック（DB には接続しない）
const db = vi.hoisted(() => ({
  persons: [] as { name: string; group?: string; config: { aliases?: string[] } }[],
  stored: {} as Record<string, Record<string, { products: RakutenItem[] }>>,
  verdicts: {} as Record<string, Record<string, { verdict: string; score: number; source: string }>>,
  records: [] as unknown[],
}));
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: async () => db.persons.map((p) => ({ ...p })),
  getPersonWithConfigMerged: async (name: string) => db.persons.find((p) => p.name === name),
}));
vi.mock('@/lib/product-store', () => ({ getAllStoredProducts: async (n: string) => db.stored[n] ?? {} }));
vi.mock('@/lib/judgment-store', () => ({ getAllVerdicts: async (n: string) => db.verdicts[n] ?? {} }));
vi.mock('@/lib/product-order-store', () => ({ getAllDisplayOrders: async () => ({}) }));
vi.mock('@/lib/person-meta', () => ({ getPersonMeta: async () => null }));
vi.mock('@/lib/group-membership-store', () => ({ getAllMembershipRecords: async () => db.records }));

import { DEFAULT_DESIGN, STORY_TEMPLATES, fillStoryText, getStoryTemplate, type SlideText, type StoryTarget } from '@/lib/story-maker/templates';
import { classifyProductForDisplay } from '@/lib/product-curation';
import { pickStoryGoods, selectGroupGoods, selectPersonGoods } from '@/lib/story-maker/goods-select';
import { buildServicesPanel, type StoryPanel } from '@/lib/story-maker/panels';
import { autoImageOwnerKey, autoImagePlan, storyGoodsApiPath } from '@/lib/story-maker/auto';
import { GOODS_MAKING_SERVICES } from '@/lib/oshikatsu-services/goods-making';
import { OSHIKATSU_SERVICE_LINKS } from '@/lib/oshikatsu-services/links';
import { clearStoryImageCache, fetchImageAsDataUrl, loadStoryGoods, StoryGoodsError } from '@/server/story-maker/goods-data';
import { StorySlide, singleLayout } from '@/app/admin/story-maker/StorySlide';

const item = (id: string, title: string, category: RakutenItem['category'], extra: Partial<RakutenItem> = {}): RakutenItem => ({
  id, title, price: 1980, reviewCount: 0, reviewAverage: 0, imageUrl: `https://thumbnail.image.rakuten.co.jp/${id}.jpg?_ex=128x128`,
  itemUrl: `https://books.rakuten.co.jp/rb/${id}/`, affiliateUrl: '', category, relevanceScore: 50, ...extra,
});
const ctx = { name: '山田花子', groupName: 'テスト組', aliases: [], generation: '' };
const ok = (score = 90, source = 'ai') => ({ verdict: 'related', score, source });

describe('B: product selection = the public person / group pages', () => {
  it('person: related + new only, no "その他", no bulk sets; one per category first', () => {
    const stored = {
      写真集: { products: [item('p1', '山田花子 1st写真集『春』', '写真集'), item('p2', '山田花子 写真集『夏』', '写真集')] },
      CD: { products: [item('c1', '山田花子 1stシングル「はじまり」 (通常盤) CD', 'CD'), item('c2', '【中古】山田花子 シングル CD', 'CD')] },
      'Blu-ray・DVD': { products: [item('d1', '山田花子 LIVE 2026 [Blu-ray]', 'Blu-ray・DVD')] },
      グッズ: { products: [item('g1', '山田花子 アクリルスタンド', 'グッズ')] },
    };
    const verdicts = { p1: ok(), p2: ok(), c1: ok(), c2: ok(), d1: ok(), g1: { verdict: 'unrelated', score: 0, source: 'ai' } };
    const sections = selectPersonGoods(stored, verdicts, {}, ctx);
    const ids = sections.flatMap((s) => s.products.map((p) => p.id));
    expect(ids).not.toContain('c2'); // 中古
    expect(ids).not.toContain('g1'); // 関連なし
    for (const s of sections) for (const p of s.products) expect(classifyProductForDisplay(p.title, p.category, p.itemUrl).section).toBe(s.label);
    const picked = pickStoryGoods(sections, 3);
    expect(picked).toHaveLength(3);
    // セクションを1件ずつ（写真集 → CD → DVD）
    expect(new Set(picked.map((x) => x.section)).size).toBe(3);
  });

  it('group: all members, auto verdicts need score ≥70, manual always; new only; deduped', () => {
    const shared = item('s1', 'テスト組 写真集', '写真集');
    const sections = selectGroupGoods([
      { stored: { 写真集: { products: [shared, item('low', 'テスト組 写真集2', '写真集')] } }, verdicts: { s1: ok(), low: ok(60) } },
      { stored: { 写真集: { products: [shared] }, CD: { products: [item('m1', 'テスト組 CD', 'CD')] }, 中古: { products: [item('u1', '【中古】テスト組 CD', '中古')] } }, verdicts: { s1: ok(), m1: ok(10, 'manual'), u1: ok() } },
    ]);
    const ids = sections.flatMap((s) => s.products.map((p) => p.id));
    expect(ids.sort()).toEqual(['m1', 's1']);
    expect(sections.map((s) => s.label)).toEqual(['本・写真集', 'CD']);
  });

  it('pickStoryGoods stops at max and handles fewer products', () => {
    expect(pickStoryGoods([], 3)).toEqual([]);
    const one = pickStoryGoods([{ label: 'CD', products: [item('a', 'a', 'CD'), item('b', 'b', 'CD')] }], 3);
    expect(one.map((x) => x.product.id)).toEqual(['a', 'b']);
  });
});

describe('B: product images (timeout, type, size, cache)', () => {
  beforeEach(() => clearStoryImageCache());
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const resp = (body: Uint8Array, type: string, status = 200) => new Response(body.buffer as ArrayBuffer, { status, headers: { 'content-type': type } });

  it('converts an image to a data URL and caches it', async () => {
    const f = vi.fn(async () => resp(png, 'image/png'));
    const a = await fetchImageAsDataUrl('https://example.com/a.png', { fetchImpl: f as unknown as typeof fetch });
    expect(a).toMatch(/^data:image\/png;base64,/);
    await fetchImageAsDataUrl('https://example.com/a.png', { fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rejects non-https, non-image, errors, oversize and timeouts (null = fallback card)', async () => {
    const never = vi.fn();
    expect(await fetchImageAsDataUrl('http://example.com/a.png', { fetchImpl: never as unknown as typeof fetch })).toBeNull();
    expect(never).not.toHaveBeenCalled();
    expect(await fetchImageAsDataUrl('https://e.com/b', { fetchImpl: (async () => resp(png, 'text/html')) as unknown as typeof fetch })).toBeNull();
    expect(await fetchImageAsDataUrl('https://e.com/c', { fetchImpl: (async () => resp(png, 'image/png', 404)) as unknown as typeof fetch })).toBeNull();
    expect(await fetchImageAsDataUrl('https://e.com/d', { maxBytes: 3, fetchImpl: (async () => resp(png, 'image/png')) as unknown as typeof fetch })).toBeNull();
    const slow = (async (_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await fetchImageAsDataUrl('https://e.com/e', { timeoutMs: 50, fetchImpl: slow })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('B: loadStoryGoods (DB mocked)', () => {
  beforeEach(() => {
    clearStoryImageCache();
    db.persons = [{ name: '山田花子', group: 'テスト組', config: {} }, { name: '空っぽ', config: {} }];
    db.stored = {
      山田花子: {
        写真集: { products: [item('p1', '山田花子 1st写真集『春』', '写真集')] },
        CD: { products: [item('c1', '山田花子 1stシングル「はじまり」 (通常盤) CD', 'CD', { imageUrl: '' })] },
      },
    };
    db.verdicts = { 山田花子: { p1: ok(), c1: ok() } };
    db.records = [];
  });

  it('returns real products with data-URL images, fallback when an image is missing, and no price', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { headers: { 'content-type': 'image/jpeg' } }));
    const r = await loadStoryGoods({ type: 'person', name: '山田花子' }, { fetchImpl: f as unknown as typeof fetch });
    expect(r.items.map((x) => x.title)).toEqual(['山田花子 1st写真集『春』', '山田花子 1stシングル「はじまり」 (通常盤) CD']);
    expect(r.items[0].imageSrc).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.items[1].imageSrc).toBeNull();
    expect(r.imageFailures).toBe(1);
    expect(JSON.stringify(r)).not.toContain('1980');
    // 500x500 の画像を取りに行く（人物ページの商品カードと同じ）
    expect((f.mock.calls[0] as unknown[])[0]).toContain('_ex=500x500');
  });

  it('explains why when there are no products / unknown targets', async () => {
    await expect(loadStoryGoods({ type: 'person', name: '空っぽ' })).rejects.toThrow(/公開中の関連商品.*ないため、自動作成できません/);
    await expect(loadStoryGoods({ type: 'person', name: '存在しない' })).rejects.toBeInstanceOf(StoryGoodsError);
    await expect(loadStoryGoods({ type: 'group', name: '存在しない組' })).rejects.toThrow(/メンバーが見つかりませんでした/);
  });
});

describe('E: services from the goods-making page', () => {
  it('uses only the listed services, in page order, with page wording and no price / lead time / ranking', () => {
    const panel = buildServicesPanel();
    expect(panel.kind).toBe('services');
    if (panel.kind !== 'services') return;
    expect(panel.items.map((x) => x.name)).toEqual(GOODS_MAKING_SERVICES.map((s) => OSHIKATSU_SERVICE_LINKS[s.id].serviceName));
    expect(panel.items.map((x) => x.catchCopy)).toEqual(GOODS_MAKING_SERVICES.map((s) => s.catchCopy));
    expect(panel.items.map((x) => x.items)).toEqual(GOODS_MAKING_SERVICES.map((s) => s.compare.items));
    expect(panel.items.map((x) => x.minQty)).toEqual(['1個から', '1点から']);
    expect(JSON.stringify(panel)).not.toMatch(/円|位|ランキング|おすすめNo/);
  });
});

describe('B・E: auto plans', () => {
  const snow: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snowman' };
  const opts = { members: [] as string[], cardVariant: 'basic' as const };
  it('B needs a target and uses the admin goods API; E needs nothing', () => {
    expect(autoImagePlan('goods', null, opts).kind).toBe('blocked');
    const b = autoImagePlan('goods', snow, opts);
    expect(b).toMatchObject({ kind: 'panel', slot: 'screen', source: 'goods', url: storyGoodsApiPath(snow) });
    expect(storyGoodsApiPath(snow)).toBe('/api/admin/story-maker/goods?type=group&name=Snow%20Man');
    expect(autoImagePlan('goodsmaking', null, opts)).toMatchObject({ kind: 'panel', source: 'services', url: null });
  });
  it('B images are dropped when the target changes; E images are not (not target-specific)', () => {
    const other: StoryTarget = { type: 'person', name: '目黒蓮', pagePath: '/person/x' };
    expect(autoImageOwnerKey('goods', snow, autoImagePlan('goods', snow, opts))).not.toBe(autoImageOwnerKey('goods', other, autoImagePlan('goods', other, opts)));
    expect(autoImageOwnerKey('goodsmaking', snow, autoImagePlan('goodsmaking', snow, opts))).toBe(autoImageOwnerKey('goodsmaking', other, autoImagePlan('goodsmaking', other, opts)));
  });
});

describe('B・E: rendering the cards in 1-page and standard versions', () => {
  const snow: StoryTarget = { type: 'group', name: 'Snow Man', pagePath: '/groups/snowman' };
  const products: StoryPanel = {
    kind: 'products',
    title: 'Snow Manの関連商品',
    items: [
      { title: 'Snow Man 写真集', section: '本・写真集', imageSrc: 'data:image/jpeg;base64,AAA', url: 'https://books.rakuten.co.jp/rb/1/' },
      { title: 'Snow Man シングル CD', section: 'CD', imageSrc: null, url: 'https://books.rakuten.co.jp/rb/2/' },
      { title: 'Snow Man LIVE Blu-ray', section: 'Blu-ray・DVD', imageSrc: 'data:image/jpeg;base64,BBB', url: 'https://books.rakuten.co.jp/rb/3/' },
    ],
  };
  const render = (id: 'goods' | 'goodsmaking', def: ReturnType<typeof getStoryTemplate>['single'], panel: StoryPanel, total = 1, index = 0, guide = false) => {
    const t = getStoryTemplate(id);
    const text = Object.fromEntries(Object.entries(def.text).map(([k, v]) => [k, fillStoryText(v, t.usesTarget ? snow : null)])) as unknown as SlideText;
    return renderToStaticMarkup(<StorySlide decoration={t.decoration} def={def} text={text} design={DEFAULT_DESIGN} index={index} total={total} image={{ src: '', fit: 'contain', panel }} showGuide={guide} templateId={id} />);
  };

  it('B 1-page: heading, real product cards (fallback for the missing image), CTA; no price, no external image URL, no guide', () => {
    const html = render('goods', getStoryTemplate('goods').single, products);
    expect(html).toContain('Snow Man推しの人、');
    expect(html).toContain('Snow Manの関連商品');
    expect(html).toContain('Snow Man 写真集');
    expect(html).toContain('Snow Man シングル CD');
    expect(html.match(/data-panel-item/g)).toHaveLength(3);
    expect(html.match(/data-panel-fallback/g)).toHaveLength(1);
    expect(html).toContain('写真集・CD・グッズをまとめて探せる！');
    expect(html).toContain('関連商品を見る');
    expect(html).not.toMatch(/¥|円/);
    expect(html).not.toMatch(/<img src="https?:/);
    expect(html).not.toContain('実際の画面が未設定です');
    expect(html).not.toContain('data-guide');
    expect(render('goods', getStoryTemplate('goods').single, products, 1, 0, true)).toContain('ここにリンクスタンプ');
  });

  it('B standard (1-page standard and 2・3-page screen pages) shows the same cards', () => {
    const t = getStoryTemplate('goods');
    for (const n of [1, 2, 3] as const) t.structures[n].forEach((def, i) => {
      if (def.imageSlot !== 'screen') return;
      const html = render('goods', def, products, n, i);
      expect(html).toContain('data-panel="products"');
      expect(html).toContain('Snow Man 写真集');
    });
  });

  it('E 1-page and standard 3rd page show the service cards', () => {
    const panel = buildServicesPanel();
    const one = render('goodsmaking', getStoryTemplate('goodsmaking').single, panel);
    expect(one).toContain('推しグッズ、');
    expect(one).toContain('しまうまプラス');
    expect(one).toContain('Cherish Palette');
    expect(one).toContain('グッズ制作サービスをまとめて比較！');
    expect(one).toContain('詳しく見てみる');
    expect(one).not.toMatch(/円/);
    const std = getStoryTemplate('goodsmaking').structures[3];
    const html = render('goodsmaking', std[2], panel, 3, 2);
    expect(html).toContain('data-panel="services"');
  });

  it('1-page layout keeps the card large and inside the safe area for B・E', () => {
    for (const t of STORY_TEMPLATES.filter((x) => x.id === 'goods' || x.id === 'goodsmaking')) {
      const text = Object.fromEntries(Object.entries(t.single.text).map(([k, v]) => [k, fillStoryText(v, snow)])) as unknown as SlideText;
      const L = singleLayout(t.single, text, 1, t.id, { headingBar: true });
      expect(L.image!.height).toBeGreaterThanOrEqual(620);
      expect(L.image!.top + L.image!.height).toBeLessThanOrEqual(L.cta.top);
      expect(L.cta.top + L.cta.height).toBeLessThanOrEqual(L.zone!.top);
    }
  });
});
