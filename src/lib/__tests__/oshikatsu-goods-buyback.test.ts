import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  BUYBACK_SERVICES,
  BUYBACK_GOODS_TYPES,
  GOODS_BUYBACK_PATH,
  NEEDS_CHECK,
  buybackGroupOptions,
  filterBuybackServices,
  findBuybackGroup,
  groupKey,
  servicesForGoods,
  servicesForGroup,
} from '@/lib/oshikatsu-services/goods-buyback';
import { buybackEntryHref } from '@/components/oshikatsu/BuybackEntryCta';
import { OSHIKATSU_AD_BLOCKED, OSHIKATSU_PAGE_SERVICE_KEYS, OSHIKATSU_CATEGORY_PAGE_PATHS } from '@/lib/oshikatsu-affiliate/constants';
import { checkAdTag } from '@/lib/oshikatsu-affiliate/ad-tag';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const ids = (list: { id: string }[]) => list.map((s) => s.id);
const byId = (id: string) => BUYBACK_SERVICES.find((s) => s.id === id)!;

describe('掲載データ', () => {
  test('4社（買取王子・JUSTY・推しトク・駿河屋）。ジャニランドは掲載しない', () => {
    expect(ids(BUYBACK_SERVICES)).toEqual(['kaitori_ouji', 'justy', 'oshitoku', 'surugaya']);
    expect(JSON.stringify(BUYBACK_SERVICES)).not.toContain('ジャニランド');
  });

  test('出典は各社の公式サイトのドメインだけ', () => {
    const domains: Record<string, RegExp> = {
      kaitori_ouji: /^https:\/\/www\.kaitoriouji\.jp\//,
      justy: /^https:\/\/justy-consul\.com\//,
      oshitoku: /^https:\/\/kaitori-janiyard\.jp\//,
      surugaya: /^https:\/\/www\.suruga-ya\.jp\//,
    };
    for (const [id, re] of Object.entries(domains)) {
      const s = byId(id);
      expect(s.officialUrl).toMatch(re);
      expect(s.sources.length).toBeGreaterThan(0);
      for (const src of s.sources) expect(src.url, src.url).toMatch(re);
    }
  });

  test('推しトク：STARTO系は4グループだけ全グッズ、9グループは DVD・Blu-ray のみ。EBiDAN（M!LK・超特急）は対象として掲載', () => {
    const s = byId('oshitoku');
    expect(s.officialUrl).toBe('https://kaitori-janiyard.jp/idol');
    expect(s.groups).toHaveLength(60);
    const g = (name: string) => s.groups.find((x) => x.name === name)!;
    for (const n of ['Snow Man', 'SixTONES', 'なにわ男子', 'Aぇ! group']) expect(g(n).goodsOnly, n).toBeUndefined();
    for (const n of ['嵐', 'Travis Japan', 'timelesz', 'SUPER EIGHT', 'Hey! Say! JUMP', 'Kis-My-Ft2', 'WEST.', 'A.B.C-Z', 'King & Prince']) {
      expect(g(n).goodsOnly, n).toEqual(['dvd']);
    }
    expect(g('M!LK').note).toContain('EBiDAN');
    expect(g('超特急').note).toContain('EBiDAN');
    // 公式サイトで確認できなかった項目は推測せず要確認のまま
    expect(s.operator).toBeNull();
    expect(s.appraisalFee).toContain(NEEDS_CHECK);
    expect(s.cancel).toContain(NEEDS_CHECK);
  });

  test('買取王子の公式表記（乃木坂・櫻坂・日向坂・AKB・誤字と思われる表記）はそのまま保存する', () => {
    const names = byId('kaitori_ouji').groups.map((x) => x.name);
    for (const n of ['乃木坂', '櫻坂', '日向坂', 'AKB', 'さくら学園', 'アンジェルム', 'Bz', 'イエモン']) expect(names).toContain(n);
    for (const n of ['乃木坂46', '櫻坂46', '日向坂46', 'AKB48', 'さくら学院', 'アンジュルム']) expect(names).not.toContain(n);
  });

  test('検索用の別名は明示的に指定した4件だけ（乃木坂→乃木坂46・櫻坂→櫻坂46・日向坂→日向坂46・AKB→AKB48）', () => {
    const withAliases = BUYBACK_SERVICES.flatMap((s) => s.groups.filter((g) => g.searchAliases).map((g) => `${s.id}:${g.name}→${g.searchAliases!.join(',')}`));
    expect(withAliases).toEqual([
      'kaitori_ouji:乃木坂→乃木坂46',
      'kaitori_ouji:櫻坂→櫻坂46',
      'kaitori_ouji:日向坂→日向坂46',
      'kaitori_ouji:AKB→AKB48',
    ]);
  });

  test('駿河屋はグループ名の明記がないため、どのグループの絞り込みにも出さない（ジャンル表記から推測しない）', () => {
    expect(byId('surugaya').groups).toEqual([]);
    expect(servicesForGroup('Snow Man').map((x) => x.service.id)).not.toContain('surugaya');
  });

  test('買取価格が高いと保証・断定する表現を使わない', () => {
    const files = ['src/lib/oshikatsu-services/goods-buyback.ts', 'src/components/oshikatsu/BuybackExplorer.tsx', 'src/app/oshikatsu/goods-buyback/page.tsx', 'src/components/oshikatsu/BuybackEntryCta.tsx'];
    for (const f of files) {
      const src = read(f).replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/高価|高額|高く売|高値|最高値|業界最高|一番高/);
    }
  });

  test('グループ名は重複なく、ジャンル表記（ジャニーズ・K-POPなど）は選択肢に入れない', () => {
    const opts = buybackGroupOptions();
    expect(new Set(opts.map(groupKey)).size).toBe(opts.length);
    for (const genre of ['ジャニーズ', 'K-POP', '韓国アイドル', 'アイドル', '宝塚', 'STARTO ENTERTAINMENT（旧ジャニーズ）各種']) {
      expect(opts).not.toContain(genre);
    }
  });
});

describe('絞り込み', () => {
  test('グループ：公式サイトに名前が明記されているサービスだけ。表記ゆれは空白・全角半角・大文字小文字のみ吸収', () => {
    expect(servicesForGroup('Snow Man').map((x) => x.service.id)).toEqual(['justy', 'oshitoku']);
    expect(servicesForGroup('SnowMan').map((x) => x.service.id)).toEqual(['justy', 'oshitoku']);
    expect(servicesForGroup('乃木坂46').map((x) => x.service.id)).toEqual(['kaitori_ouji', 'justy']);
    expect(servicesForGroup('乃木坂').map((x) => x.service.id)).toEqual(['kaitori_ouji']);
    expect(servicesForGroup('M!LK').map((x) => x.service.id)).toEqual(['justy', 'oshitoku']);
    expect(servicesForGroup('超特急').map((x) => x.service.id)).toEqual(['justy', 'oshitoku']);
    expect(servicesForGroup('存在しないグループ')).toEqual([]);
    // 公式表記（例: JUSTY の「number_i」）でも一致する
    expect(servicesForGroup('number_i').map((x) => x.service.id)).toEqual(['justy']);
  });

  test('乃木坂46・櫻坂46・日向坂46・AKB48 の人物・グループページから移動すると、買取王子が比較候補に出る（表示は公式表記のまま）', () => {
    for (const [group, official] of [['乃木坂46', '乃木坂'], ['櫻坂46', '櫻坂'], ['日向坂46', '日向坂'], ['AKB48', 'AKB']] as const) {
      expect(findBuybackGroup([group])).toBe(group);
      expect(buybackEntryHref([group])).toBe(`${GOODS_BUYBACK_PATH}?group=${encodeURIComponent(group)}`);
      const hits = servicesForGroup(group);
      expect(hits.map((x) => x.service.id), group).toContain('kaitori_ouji');
      expect(hits.find((x) => x.service.id === 'kaitori_ouji')!.group.name).toBe(official);
      expect(ids(filterBuybackServices(group, ''))).toContain('kaitori_ouji');
    }
    // 絞り込みの選択肢は推しサーチ側の名前（別名）で1つにまとめる
    const opts = buybackGroupOptions();
    for (const n of ['乃木坂46', '櫻坂46', '日向坂46', 'AKB48']) expect(opts).toContain(n);
    for (const n of ['乃木坂', '櫻坂', '日向坂', 'AKB']) expect(opts).not.toContain(n);
  });

  test('別名を指定していない略称・誤字は変換しない', () => {
    expect(servicesForGroup('さくら学院').map((x) => x.service.id)).toEqual(['justy']);
    expect(servicesForGroup('アンジュルム').map((x) => x.service.id)).toEqual(['justy']);
    expect(servicesForGroup("B'z")).toEqual([]);
    expect(servicesForGroup('THE YELLOW MONKEY').map((x) => x.service.id)).toEqual(['justy']);
    expect(servicesForGroup('ハロー!プロジェクト')).toEqual([]);
  });

  test('グループの条件（期・体制・年代など）は note で表示する', () => {
    const hit = servicesForGroup('乃木坂46').find((x) => x.service.id === 'justy')!;
    expect(hit.group.note).toContain('5期生・6期生');
    expect(servicesForGroup('King & Prince')[0].group.note).toContain('2人体制以降');
  });

  test('グッズ種類：明記あり・条件つきのサービスだけ（買取不可・明記なしは出さない）', () => {
    expect(ids(servicesForGoods('poster'))).toEqual(['surugaya']);
    expect(ids(servicesForGoods('penlight'))).toEqual(['kaitori_ouji', 'justy', 'oshitoku']);
    expect(ids(servicesForGoods('plush'))).toEqual(['justy', 'oshitoku']);
    expect(ids(servicesForGoods('calendar'))).toEqual(['justy', 'surugaya']);
    expect(BUYBACK_GOODS_TYPES.length).toBe(15);
  });

  test('グループ×グッズ：DVD・Blu-ray のみのグループは、ほかのグッズで絞り込むと出さない', () => {
    expect(ids(filterBuybackServices('King & Prince', 'uchiwa'))).toEqual(['justy']);
    expect(ids(filterBuybackServices('King & Prince', 'dvd'))).toEqual(['justy', 'oshitoku']);
    expect(ids(filterBuybackServices('嵐', 'penlight'))).toEqual(['justy']);
    expect(ids(filterBuybackServices('Snow Man', 'penlight'))).toEqual(['justy', 'oshitoku']);
    expect(ids(filterBuybackServices('', 'poster'))).toEqual(['surugaya']);
    expect(ids(filterBuybackServices('', ''))).toEqual(ids(BUYBACK_SERVICES));
  });

  test('人物・グループページ：所属グループのうち明記のある最初のグループで絞り込んだURL。なければ絞り込みなし', () => {
    expect(findBuybackGroup(['存在しないグループ', '日向坂46'])).toBe('日向坂46');
    expect(buybackEntryHref(['Snow Man'])).toBe(`${GOODS_BUYBACK_PATH}?group=Snow%20Man`);
    expect(buybackEntryHref(['存在しないグループ'])).toBe(GOODS_BUYBACK_PATH);
    expect(buybackEntryHref([])).toBe(GOODS_BUYBACK_PATH);
  });
});

describe('アフィリエイト管理', () => {
  test('比較ページの全サービスが管理画面の掲載先（グッズ買取）として登録されている', () => {
    expect([...(OSHIKATSU_PAGE_SERVICE_KEYS.goods_buyback ?? [])]).toEqual(ids(BUYBACK_SERVICES));
    expect(OSHIKATSU_CATEGORY_PAGE_PATHS.goods_buyback).toBe(GOODS_BUYBACK_PATH);
  });

  test('推しトク・駿河屋はサイト側で広告停止（管理画面で有効にしても公開ページに出さない）', () => {
    expect(Object.keys(OSHIKATSU_AD_BLOCKED).sort()).toEqual(['oshitoku', 'surugaya']);
  });

  test('ASPなし・未定（none）のタグは安全確認を通らない（登録・表示できない）', () => {
    const tag = '<a href="https://px.a8.net/svt/ejp?a8mat=X" rel="nofollow">x</a>\n<img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=X" alt="">';
    expect(checkAdTag('a8', tag).ok).toBe(true);
    expect(checkAdTag('none', tag).ok).toBe(false);
  });
});

describe('人物・グループページとの連動', () => {
  test('人物ページ：関連商品コーナーの下・出演作品の前に案内を置く（現在の所属グループで絞り込み）', () => {
    const src = read('src/app/person/[slug]/page.tsx');
    const products = src.indexOf('<section id="products"');
    const entry = src.indexOf('<BuybackEntryCta');
    const works = src.indexOf('━━━ 出演作品 ━━━');
    expect(products).toBeGreaterThan(0);
    expect(entry).toBeGreaterThan(products);
    expect(works).toBeGreaterThan(entry);
    expect(src).toContain('<BuybackEntryCta groupNames={currentGroups.map((m) => m.groupName)} placement="person_page" />');
  });

  test('グループページ：関連商品の下・関連グループの前に案内を置く', () => {
    const src = read('src/app/groups/[groupSlug]/page.tsx');
    const products = src.indexOf('━━━ 6. 関連商品 ━━━');
    const entry = src.indexOf('<BuybackEntryCta');
    const related = src.indexOf('━━━ 7. 関連グループ ━━━');
    expect(entry).toBeGreaterThan(products);
    expect(related).toBeGreaterThan(entry);
    expect(src).toContain('<BuybackEntryCta groupNames={[groupName]} placement="group_page" />');
  });

  test('案内はサイト内リンクだけ（広告タグ・外部リンク・人物画像を置かない）。<aside> で描画', () => {
    const src = read('src/components/oshikatsu/BuybackEntryCta.tsx');
    expect(src).toContain('<aside');
    expect(src).toContain('OshikatsuCategoryLink');
    expect(src).not.toMatch(/OshikatsuAdTag|ServiceOutboundLink|<img|https?:\/\//);
  });
});

describe('GA4・サイトマップ', () => {
  test('絞り込みは oshikatsu_buyback_filter、外部リンクは既存の oshikatsu_service_click（goods_buyback）、ページ移動は既存の oshikatsu_category_click', () => {
    const ex = read('src/components/oshikatsu/BuybackExplorer.tsx');
    expect(ex).toContain("sendGaEvent('oshikatsu_buyback_filter'");
    expect(ex).toContain("const CATEGORY = 'goods_buyback'");
    expect(read('src/components/oshikatsu/BuybackEntryCta.tsx')).toContain('categoryId="goods_buyback"');
  });

  test('サイトマップに買取比較ページ（絞り込みURLは含めない）', () => {
    const sm = read('src/app/sitemap.ts');
    expect(sm).toContain('${BASE_URL}/oshikatsu/goods-buyback`');
    expect(sm).not.toContain('goods-buyback?');
  });
});
