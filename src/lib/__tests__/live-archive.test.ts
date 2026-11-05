import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import PersonLiveArchiveSection from '@/components/live-archive/PersonLiveArchiveSection';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_ARCHIVE_GROUPS, LIVE_PERFORMANCES } from '@/lib/live-archive/catalog';
import {
  booksProductNumberOf, buildLiveArchive, countItems, filterEntries, formatReleaseDate, indexByBooksNumber, isLiveArchiveGroup,
  formatLinksOf, itemLabel, liveArchiveGroupsForPerson, pickSpreadPerformances, sortEntries,
} from '@/lib/live-archive/core';
import {
  LIVE_ARCHIVE_GA_EVENTS, liveArchiveFilterEvent, liveArchiveProductClickEvent, liveArchiveViewEvent, rakutenCampaignClickEvent,
} from '@/lib/live-archive/ga';
import { sendGaEvent } from '@/lib/ga-event';
import { currentMemberships, resolvePersonMemberships } from '@/lib/group-membership';
import { UPCOMING_WINDOW_MS, campaignPeriodLabel, publicCampaigns, statusAt, type CampaignSource } from '@/lib/rakuten-campaign/core';
import type { RakutenItem } from '@/types/rakuten';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function item(n: string, over: Partial<RakutenItem> = {}): RakutenItem {
  return {
    id: `dv-${n}`,
    title: `title ${n}`,
    price: 5000,
    reviewCount: 0,
    reviewAverage: 0,
    imageUrl: `https://thumbnail.image.rakuten.co.jp/${n}.jpg`,
    itemUrl: `http://books.rakuten.co.jp/rb/${n}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F${n}%2F`,
    category: 'Blu-ray・DVD',
    relevanceScore: 0,
    priceStale: false,
    priceDateLabel: '11/5時点',
    ...over,
  };
}

describe('掲載リスト（catalog）', () => {
  it('対象は M!LK・Snow Man・SixTONES の3グループだけ', () => {
    expect(LIVE_ARCHIVE_GROUPS.map((g) => g.groupName)).toEqual(['M!LK', 'Snow Man', 'SixTONES']);
    expect(isLiveArchiveGroup('Snow Man')).toBe(true);
    expect(isLiveArchiveGroup('乃木坂46')).toBe(false);
  });

  it('公演ID・商品番号は重複せず、発売日・確認元・形式が正しい', () => {
    const ids = new Set<string>();
    const numbers = new Set<string>();
    const groups = new Set(LIVE_ARCHIVE_GROUPS.map((g) => g.groupName));
    for (const p of LIVE_PERFORMANCES) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(groups.has(p.groupName)).toBe(true);
      expect(p.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(p.releaseDate))).toBe(false);
      expect(p.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.sourceUrl.startsWith('https://')).toBe(true);
      // 確認元は公式サイト（楽天・通販サイト・Wikipedia は使わない）
      expect(new URL(p.sourceUrl).hostname).toMatch(/(^|\.)(starto\.jp|mentrecording\.jp|sixtones\.jp|sd-milk\.com)$/);
      expect(p.variants.length).toBeGreaterThan(0);
      const combos = new Set<string>();
      for (const v of p.variants) {
        expect(v.productNumber).toMatch(/^\d{6,10}$/);
        expect(numbers.has(v.productNumber)).toBe(false);
        numbers.add(v.productNumber);
        // 同じ公演で同じ形式・盤は1つだけ（先着特典版・セット等を重ねて登録しない）
        const key = `${v.format}|${v.edition}`;
        expect(combos.has(key)).toBe(false);
        combos.add(key);
      }
    }
  });

  it('映画・舞台・CD の特典映像・確認できなかった作品は登録していない', () => {
    const titles = LIVE_PERFORMANCES.map((p) => p.title).join('\n');
    expect(titles).not.toMatch(/滝沢歌舞伎|The Movie|ナイトフラワー|LOVE SONG/);
    expect(titles).not.toMatch(/ASIA TOUR 2D\.2D\./); // 公式ページでライブ本編の収録と確認できなかった
    expect(titles).not.toMatch(/SMILE POP|M!X|HAPPY! HAPPY!/); // 公式の映像作品一覧に無い・特典付きの販売形態しか無い
  });
});

describe('buildLiveArchive', () => {
  const perf = LIVE_PERFORMANCES.find((p) => p.id === 'sixtones-2024-vvs')!;

  it('掲載リストの商品番号だけを公演ごとにまとめる（商品名では判定しない）', () => {
    const index = indexByBooksNumber([
      ...perf.variants.map((v) => item(v.productNumber)),
      item('99999999', { title: 'SixTONES LIVE TOUR 2099（ライブ Blu-ray）' }), // 掲載リストに無い
    ]);
    const entries = buildLiveArchive('SixTONES', index);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('sixtones-2024-vvs');
    expect(entries[0].items.map((i) => i.productNumber).sort()).toEqual(perf.variants.map((v) => v.productNumber).sort());
    expect(entries[0].releaseYear).toBe(2024);
    expect(entries[0].recorded).toBe('2024年4月22日 東京ドーム公演');
    // 初回盤→通常盤、Blu-ray→DVD の順
    expect(entries[0].items.map(itemLabel)).toEqual(['Blu-ray 初回盤', 'DVD 初回盤', 'Blu-ray 通常盤', 'DVD 通常盤']);
  });

  it('既存の楽天アフィリエイトURLをそのまま使う', () => {
    const it0 = item(perf.variants[0].productNumber);
    const [entry] = buildLiveArchive('SixTONES', indexByBooksNumber([it0]));
    expect(entry.items[0].href).toBe(it0.affiliateUrl);
    expect(entry.items[0].productId).toBe(it0.id);
  });

  it('商品データに無い盤は出さず、1つも無い公演は出さない（空なら空配列）', () => {
    expect(buildLiveArchive('SixTONES', new Map())).toEqual([]);
    const [entry] = buildLiveArchive('SixTONES', indexByBooksNumber([item(perf.variants[1].productNumber)]));
    expect(entry.items).toHaveLength(1);
  });

  it('中古・別グループの商品は使わない', () => {
    const used = item(perf.variants[0].productNumber, { isUsed: true });
    expect(buildLiveArchive('SixTONES', indexByBooksNumber([used]))).toEqual([]);
    expect(buildLiveArchive('Snow Man', indexByBooksNumber([item(perf.variants[0].productNumber)]))).toEqual([]);
  });

  it('価格は取得日時が分かる新しい価格だけ（古い・取得日時不明は null）', () => {
    const n = perf.variants.map((v) => v.productNumber);
    const [entry] = buildLiveArchive('SixTONES', indexByBooksNumber([
      item(n[0]),
      item(n[1], { priceStale: true, priceDateLabel: '2026/7/1' }),
      item(n[2], { priceDateLabel: undefined }),
      item(n[3], { price: 0 }),
    ]));
    const byNumber = new Map(entry.items.map((i) => [i.productNumber, i]));
    expect(byNumber.get(n[0])!.price).toBe(5000);
    expect(byNumber.get(n[0])!.priceDateLabel).toBe('11/5時点');
    expect(byNumber.get(n[1])!.price).toBeNull();
    expect(byNumber.get(n[2])!.price).toBeNull();
    expect(byNumber.get(n[3])!.price).toBeNull();
  });

  it('商品番号は商品URL・アフィリエイトURLの遷移先のどちらからでも取れる', () => {
    expect(booksProductNumberOf({ itemUrl: 'http://books.rakuten.co.jp/rb/17969299/', affiliateUrl: '' })).toBe('17969299');
    expect(booksProductNumberOf({ itemUrl: '', affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F17969299%2F' })).toBe('17969299');
    expect(booksProductNumberOf({ itemUrl: 'https://item.rakuten.co.jp/shop/abc/', affiliateUrl: '' })).toBeNull();
  });
});

describe('並び替え・絞り込み', () => {
  const all = LIVE_PERFORMANCES.filter((p) => p.groupName === 'SixTONES').flatMap((p) => p.variants.map((v) => item(v.productNumber)));
  const entries = buildLiveArchive('SixTONES', indexByBooksNumber(all));

  it('古い順・新しい順', () => {
    expect(sortEntries(entries, 'old').map((e) => e.releaseYear)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(sortEntries(entries, 'new').map((e) => e.releaseYear)).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
  });

  it('DVD・Blu-ray で絞り込む（元の配列は変えない）', () => {
    const dvd = filterEntries(entries, 'DVD');
    expect(dvd.every((e) => e.items.every((i) => i.format === 'DVD'))).toBe(true);
    expect(countItems(dvd) + countItems(filterEntries(entries, 'Blu-ray'))).toBe(countItems(entries));
    expect(filterEntries(entries, 'all')).toBe(entries);
    expect(countItems(entries)).toBe(24);
  });

  it('発売日の表示', () => {
    expect(formatReleaseDate('2025-06-11')).toBe('2025年6月11日');
    expect(formatReleaseDate('bad')).toBe('');
  });
});

describe('楽天のキャンペーン枠（publicCampaigns）', () => {
  const H = 60 * 60 * 1000;
  const now = Date.parse('2026-11-05T12:00:00+09:00');
  const base: CampaignSource = {
    id: 1, name: '楽天お買い物マラソン', eventType: 'marathon',
    startsAt: now - 2 * H, endsAt: now + 48 * H,
    officialUrl: 'https://event.rakuten.co.jp/campaign/point-up/marathon/', entryUrl: null,
    lastCheckedAt: now - H, visibility: 'published',
  };

  it('公開・公式確認済み・開催中のイベントを「開催中」で出す', () => {
    const [c] = publicCampaigns([base], now);
    expect(c.status).toBe('active');
    expect(c.url).toBe(base.officialUrl);
    expect(c.typeLabel).toBe('お買い物マラソン');
  });

  it('非公開・公式未確認・終了・楽天以外のURLは出さない', () => {
    expect(publicCampaigns([{ ...base, visibility: 'hidden' }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, lastCheckedAt: null }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, officialUrl: null }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, endsAt: now }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, officialUrl: 'https://example.com/marathon' }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, officialUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/' }], now)).toEqual([]);
    expect(publicCampaigns([{ ...base, endsAt: base.startsAt }], now)).toEqual([]);
  });

  it('開始前は7日前から「開催予定」（開催中とは表示しない）', () => {
    const soon = { ...base, startsAt: now + 3 * H, endsAt: now + 100 * H };
    expect(publicCampaigns([soon], now)[0].status).toBe('upcoming');
    const far = { ...base, startsAt: now + UPCOMING_WINDOW_MS + H, endsAt: now + UPCOMING_WINDOW_MS + 50 * H };
    expect(publicCampaigns([far], now)).toEqual([]);
  });

  it('エントリーURLが楽天の公式ページならそちらへ、アフィリエイトの計測リンクなら公式ページへ', () => {
    const entry = 'https://event.rakuten.co.jp/campaign/point-up/marathon/entry/';
    expect(publicCampaigns([{ ...base, entryUrl: entry }], now)[0]).toMatchObject({ url: entry, isEntry: true });
    expect(publicCampaigns([{ ...base, entryUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/' }], now)[0]).toMatchObject({ url: base.officialUrl, isEntry: false });
  });

  it('開催中を先、開催予定を後に並べる', () => {
    const upcoming = { ...base, id: 2, startsAt: now + H, endsAt: now + 10 * H };
    expect(publicCampaigns([upcoming, base], now).map((c) => c.id)).toEqual([1, 2]);
  });

  it('表示後の状態の確認（終了したら null）と期間の表示（日本時間）', () => {
    expect(statusAt(base, now)).toBe('active');
    expect(statusAt(base, base.endsAt)).toBeNull();
    expect(statusAt(base, base.startsAt - 1)).toBe('upcoming');
    expect(campaignPeriodLabel({ startsAt: Date.parse('2026-11-04T20:00:00+09:00'), endsAt: Date.parse('2026-11-11T01:59:00+09:00') }))
      .toBe('11月4日(水)20:00〜11月11日(水)01:59');
  });
});

describe('画面・計測の配置', () => {
  it('グループページは対象グループだけコーナーを出し、既存の関連商品の前に置く', () => {
    const src = read('src/app/groups/[groupSlug]/page.tsx');
    expect(src).toContain('liveArchiveGroup && (');
    expect(src.indexOf('id="live-archive"')).toBeGreaterThan(0);
    expect(src.indexOf('id="live-archive"')).toBeLessThan(src.indexOf('6. 関連商品'));
    expect(src).toContain('`${groupPath}/live`');
  });

  it('GA4 のイベントを各操作の処理から送り、既存の楽天クリック計測も通す', () => {
    const browser = read('src/components/live-archive/LiveArchiveBrowser.tsx');
    const box = read('src/components/live-archive/RakutenCampaignBox.tsx');
    expect(browser).toContain('sendGaEvent(...liveArchiveViewEvent(');
    expect(browser.match(/sendGaEvent\(\.\.\.liveArchiveFilterEvent\(/g)).toHaveLength(2); // 並び替え・形式
    expect(browser).toContain('sendGaEvent(...liveArchiveProductClickEvent(');
    expect(box).toContain('sendGaEvent(...rakutenCampaignClickEvent(');
    // 既存の楽天クリック計測（/api/track・affiliate_click）も通す
    expect(browser).toContain('trackRakutenClick(');
    expect(browser).toContain('rel="noopener noreferrer sponsored"');
  });

  it('新しい GA4 イベント名は既存のイベント名と重ならない', () => {
    const names = Object.values(LIVE_ARCHIVE_GA_EVENTS);
    const files = execSync("grep -rlE \"sendGaEvent\\(|gtag\\(\" src --include=*.ts --include=*.tsx", { cwd: ROOT }).toString().trim().split('\n')
      .filter((f) => !f.includes('live-archive') && !f.includes('__tests__'));
    for (const f of files) {
      const src = read(f);
      for (const n of names) expect(src.includes(`'${n}'`), `${f} に ${n}`).toBe(false);
    }
  });

  it('一覧ページは動的に描画し、PR表記を出す。サイトマップに対象グループの一覧ページ', () => {
    const page = read('src/app/groups/[groupSlug]/live/page.tsx');
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain('<PrNotice');
    expect(read('src/app/sitemap.ts')).toContain('LIVE_ARCHIVE_GROUPS');
  });
});

describe('GA4 イベント（パラメータと送信）', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => { delete g.window; });
  function mockWindow(hostname: string) {
    const gtag = vi.fn();
    g.window = { location: { hostname }, gtag };
    return gtag;
  }

  it('本番ホストでは4つのイベントがパラメータつきで gtag に渡る', () => {
    const gtag = mockWindow('oshi-search.jp');
    sendGaEvent(...liveArchiveViewEvent('snow-man', 'Snow Man', 'group_page', 5));
    sendGaEvent(...liveArchiveFilterEvent('snow-man', 'live_list', { format: 'DVD' }));
    sendGaEvent(...liveArchiveFilterEvent('snow-man', 'live_list', { sort: 'new' }));
    sendGaEvent(...liveArchiveProductClickEvent('snow-man', 'live_list',
      { id: 'snowman-2022-labo', releaseYear: 2023 }, { productId: 'dv-17520096', format: 'DVD', edition: '通常盤' }, 4, { sort: 'new', format: 'DVD' }));
    sendGaEvent(...rakutenCampaignClickEvent({ id: 7, isEntry: true }, 'active', 'live_list', 'snow-man'));
    expect(gtag.mock.calls).toEqual([
      ['event', 'live_archive_view', { group_id: 'snow-man', group_name: 'Snow Man', placement: 'group_page', performance_count: 5 }],
      ['event', 'live_archive_filter', { group_id: 'snow-man', placement: 'live_list', filter_type: 'format', filter_value: 'DVD' }],
      ['event', 'live_archive_filter', { group_id: 'snow-man', placement: 'live_list', filter_type: 'sort', filter_value: 'new' }],
      ['event', 'live_archive_product_click', {
        group_id: 'snow-man', product_id: 'dv-17520096', performance_id: 'snowman-2022-labo', format: 'DVD', edition: '通常盤',
        release_year: 2023, placement: 'live_list', position: 4, sort_order: 'new', filter_format: 'DVD',
      }],
      ['event', 'rakuten_campaign_click', { campaign_id: 7, campaign_status: 'active', link_type: 'entry', placement: 'live_list', group_id: 'snow-man' }],
    ]);
  });

  it('本番以外のホスト（localhost・Preview）では送らない', () => {
    for (const host of ['localhost', 'oshi-search-git-x.vercel.app']) {
      const gtag = mockWindow(host);
      sendGaEvent(...liveArchiveViewEvent('snow-man', 'Snow Man', 'group_page', 5));
      expect(gtag).not.toHaveBeenCalled();
    }
  });

  it('パラメータに個人情報を含めない（キーは決まった項目だけ）', () => {
    const [, p] = liveArchiveProductClickEvent('x', 'y', { id: 'a', releaseYear: 2020 }, { productId: 'dv-1', format: 'DVD', edition: '通常盤' }, 1, { sort: 'old', format: 'all' });
    expect(Object.keys(p).sort()).toEqual(['edition', 'filter_format', 'format', 'group_id', 'performance_id', 'placement', 'position', 'product_id', 'release_year', 'sort_order']);
  });
});

describe('人物ページの導線', () => {
  const person = (group: string) => ({ name: 'テスト', group });

  it('現在の所属が対象グループのときだけ出す（3グループ以外は出さない）', () => {
    expect(liveArchiveGroupsForPerson(['Snow Man'])).toEqual(['Snow Man']);
    expect(liveArchiveGroupsForPerson(['乃木坂46'])).toEqual([]);
    expect(liveArchiveGroupsForPerson([])).toEqual([]);
    expect(liveArchiveGroupsForPerson(['M!LK', '乃木坂46', 'SixTONES', 'M!LK'])).toEqual(['M!LK', 'SixTONES']);
  });

  it('所属履歴：卒業・脱退した対象グループには出さず、現在の所属だけ', () => {
    const records = [
      { personName: 'テスト', groupName: 'SixTONES', activityStatus: 'graduated' as const },
      { personName: 'テスト', groupName: '別グループ', activityStatus: 'active' as const },
    ];
    const ms = resolvePersonMemberships(person('別グループ'), undefined, records as never);
    expect(liveArchiveGroupsForPerson(currentMemberships(ms).map((m) => m.groupName))).toEqual([]);
  });

  it('formerGroupNames（元所属の記録だけ）や、登録グループが卒業の人物には出さない', () => {
    const former = resolvePersonMemberships(person('別グループ'), { formerGroupNames: ['Snow Man'] }, []);
    expect(liveArchiveGroupsForPerson(currentMemberships(former).map((m) => m.groupName))).toEqual([]);
    const graduated = resolvePersonMemberships(person('M!LK'), { activityStatus: 'graduated' }, []);
    expect(liveArchiveGroupsForPerson(currentMemberships(graduated).map((m) => m.groupName))).toEqual([]);
    const active = resolvePersonMemberships(person('M!LK'), undefined, []);
    expect(liveArchiveGroupsForPerson(currentMemberships(active).map((m) => m.groupName))).toEqual(['M!LK']);
  });

  it('人物ページ：サブスク診断（配信セクション）の後・関連商品ピックアップの直前にコーナーを置き、以前の導線カードは無い', () => {
    const src = read('src/app/person/[slug]/page.tsx');
    expect(src).toContain('liveArchiveGroupsForPerson(currentGroups.map((m) => m.groupName))');
    const at = src.indexOf('<PersonLiveArchiveSection');
    expect(at).toBeGreaterThan(src.indexOf('title="この人を含めてサブスク診断"'));
    expect(at).toBeLessThan(src.indexOf('<FeaturedProductsSection'));
    expect(src).toContain('pickSpreadPerformances(entries, 3)');
    expect(src).toContain('listHref={`${membershipGroupHref(a.groupName)}/live`}');
    expect(src).not.toContain('LiveArchiveEntryLink');
    expect(fs.existsSync(path.join(ROOT, 'src/components/live-archive/LiveArchiveEntryLink.tsx'))).toBe(false);
    // セクション番号：既存の番号つき見出しと同じ仕組みで「LIVE ARCHIVE」
    expect(read('src/app/person/[slug]/person-graphic.css')).toContain(`section[id^="live-archive"] h2::before { content: counter(pp-sec, decimal-leading-zero) ' — LIVE ARCHIVE'; }`);
  });
});

describe('人物ページの「過去ライブ映像を発掘」コーナー', () => {
  const all = (g: string) => buildLiveArchive(g, indexByBooksNumber(
    LIVE_PERFORMANCES.filter((p) => p.groupName === g).flatMap((p) => p.variants.map((v) => item(v.productNumber))),
  ));

  it('3公演を発売時期が散らばるように選ぶ（最古・最新を含む・1公演1枠・古い順）', () => {
    expect(pickSpreadPerformances(all('SixTONES')).map((e) => e.id)).toEqual(['sixtones-2020-trackone-impact', 'sixtones-2023-kansei-in-dome', 'sixtones-2025-young-old']);
    expect(pickSpreadPerformances(all('Snow Man')).map((e) => e.id)).toEqual(['snowman-2021-mania', 'snowman-2023-idome', 'snowman-2025-on']);
    expect(pickSpreadPerformances(all('M!LK')).map((e) => e.id)).toEqual(['milk-2022-next-winner', 'milk-2024-hero', 'milk-2024-i-can-drink']);
    for (const g of ['SixTONES', 'Snow Man', 'M!LK']) {
      const ids = pickSpreadPerformances(all(g)).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(pickSpreadPerformances(all('SixTONES').slice(0, 2))).toHaveLength(2);
    expect(pickSpreadPerformances([])).toEqual([]);
    // 4公演でも重複しない
    const four = pickSpreadPerformances(all('SixTONES').slice(0, 4));
    expect(new Set(four.map((e) => e.id)).size).toBe(3);
  });

  it('形式ごとに1つのリンク（通常盤を優先、Blu-ray → DVD）', () => {
    const [labo] = all('Snow Man').filter((e) => e.id === 'snowman-2022-labo');
    expect(formatLinksOf(labo).map(itemLabel)).toEqual(['Blu-ray 通常盤', 'DVD 通常盤']);
    const [nw] = all('M!LK').filter((e) => e.id === 'milk-2022-next-winner');
    expect(formatLinksOf(nw).map(itemLabel)).toEqual(['Blu-ray 通常盤', 'DVD 通常盤']);
    const onlyFirst = { ...labo, items: labo.items.filter((i) => i.edition === '初回盤') };
    expect(formatLinksOf(onlyFirst).map(itemLabel)).toEqual(['Blu-ray 初回盤', 'DVD 初回盤']);
  });

  it('表示：見出し・説明文・画像・公演名・発売年・形式・楽天リンク・一覧へのリンク。未確認の情報は出さない', () => {
    const entries = pickSpreadPerformances(all('M!LK'));
    const html = renderToString(createElement(PersonLiveArchiveSection, { id: 'live-archive', groupName: 'M!LK', entries, listHref: '/groups/M!LK/live' }));
    expect(html.startsWith('<section id="live-archive"')).toBe(true);
    expect(html).toContain('M!LK<!-- -->の過去ライブ映像を発掘');
    expect(html).toContain('好きになる前のライブもチェック！過去のDVD・Blu-rayを探してみよう。');
    expect((html.match(/<img /g) ?? [])).toHaveLength(3);
    expect(html).toContain('2022<!-- -->年発売');
    expect(html).toContain('M!LK CONCERT TOUR 2024「HERO」');
    const links = [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer sponsored"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    expect(links).toHaveLength(6); // 3公演 × Blu-ray・DVD
    expect(links.every((u) => u.startsWith('https://hb.afl.rakuten.co.jp/hgc/'))).toBe(true);
    expect(html).toContain('href="/groups/M!LK/live"');
    expect(html).toContain('M!LK<!-- -->のライブ映像をすべて見る');
    expect(html).not.toMatch(/¥|円|本人出演|出演作品|特典付き|先着/);
  });

  it('確認済みの商品が無ければ何も出さない', () => {
    expect(renderToString(createElement(PersonLiveArchiveSection, { id: 'live-archive', groupName: 'M!LK', entries: [], listHref: '/x' }))).toBe('');
  });

  it('クリック計測は既存の TrackedRakutenLink（affiliate_click）だけで、ライブ特集の新しいイベントは送らない', () => {
    const src = read('src/components/live-archive/PersonLiveArchiveSection.tsx');
    expect(src).toContain('<TrackedRakutenLink');
    expect(src).toContain("pageType: 'person'");
    expect(src).not.toMatch(/sendGaEvent|live_archive_product_click|liveArchiveProductClickEvent/);
  });
});
