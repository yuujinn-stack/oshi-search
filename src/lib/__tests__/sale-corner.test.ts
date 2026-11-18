import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { SALE_CORNERS, type SaleCornerConfig } from '@/lib/sale-corner/config';
import {
  nextSaleBoundary, pickSaleCorner, saleCornerCtaClickEvent, saleCornerLinks, saleCornerOfficialClickEvent,
  saleCornerViewEvent, salePeriodLabel, salePhaseAt, toSaleCorner, upcomingLabel,
} from '@/lib/sale-corner/core';
import SaleCorner from '@/components/site/SaleCorner';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const bf = toSaleCorner(SALE_CORNERS.find((c) => c.id === 'rakuten-blackfriday-2026')!)!;

const LINKS = saleCornerLinks([
  { groupName: 'Snow Man', groupHref: '/groups/snow-man', liveHref: '/groups/snow-man/live' },
  { groupName: 'M!LK', groupHref: '/groups/M!LK', liveHref: '/groups/M!LK/live' },
  { groupName: 'SixTONES', groupHref: '/groups/sixtones', liveHref: '/groups/sixtones/live' },
]);

describe('楽天ブラックフライデー2026 の設定', () => {
  it('公式ページで確認した日時（日本時間）', () => {
    expect(bf.startsAt).toBe(Date.UTC(2026, 10, 19, 11, 0));
    expect(bf.endsAt).toBe(Date.UTC(2026, 10, 24, 16, 59));
    expect(bf.officialUrl).toBe('https://event.rakuten.co.jp/campaign/point-up/blackfriday/');
  });

  it('表示文言', () => {
    expect(bf.title).toBe('楽天ブラックフライデー2026');
    expect(bf.lead).toBe('推しの写真集・CD・ライブ映像を探そう');
    expect(salePeriodLabel(bf)).toBe('11/19 20:00〜11/25 1:59');
    expect(upcomingLabel(bf)).toBe('11月19日20時スタート');
    expect(bf.activeLabel).toBe('楽天ブラックフライデー開催中');
  });

  it('誇大表示・未確認の断定をしない／エントリーと条件を明記', () => {
    const text = JSON.stringify(SALE_CORNERS);
    for (const ng of ['半額', '全商品', '最安', '在庫あり', '限定特典', '対象商品', 'OFF']) expect(text).not.toContain(ng);
    expect(bf.conditionsNote).toContain('エントリー');
    expect(bf.conditionsNote).toContain('条件');
  });

  it('すべての設定が検証を通る（id は重複しない・英数字）', () => {
    for (const c of SALE_CORNERS) {
      expect(toSaleCorner(c)).not.toBeNull();
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(new Set(SALE_CORNERS.map((c) => c.id)).size).toBe(SALE_CORNERS.length);
  });
});

describe('表示の切り替え（日本時間）', () => {
  it('開始前 → 告知', () => {
    expect(salePhaseAt(bf, jst('2026-11-18T12:00:00'))).toBe('upcoming');
    expect(salePhaseAt(bf, jst('2026-11-19T19:59:59.999'))).toBe('upcoming');
  });
  it('開始直後 → 開催中', () => {
    expect(salePhaseAt(bf, jst('2026-11-19T20:00:00'))).toBe('active');
    expect(salePhaseAt(bf, jst('2026-11-19T20:00:01'))).toBe('active');
  });
  it('終了直前 → 開催中', () => {
    expect(salePhaseAt(bf, jst('2026-11-25T01:58:59.999'))).toBe('active');
  });
  it('終了後（1:59 ちょうど以降）→ 非表示', () => {
    expect(salePhaseAt(bf, jst('2026-11-25T01:59:00'))).toBeNull();
    expect(salePhaseAt(bf, jst('2026-11-26T00:00:00'))).toBeNull();
  });
  it('UTC では日付がずれる時刻でも日本時間で判定（11/19 11:00Z = 20:00 JST）', () => {
    expect(salePhaseAt(bf, Date.parse('2026-11-19T10:59:59Z'))).toBe('upcoming');
    expect(salePhaseAt(bf, Date.parse('2026-11-19T11:00:00Z'))).toBe('active');
    expect(salePhaseAt(bf, Date.parse('2026-11-24T16:59:00Z'))).toBeNull();
  });
  it('次の切り替え時刻', () => {
    expect(nextSaleBoundary(bf, jst('2026-11-18T12:00:00'))).toBe(bf.startsAt);
    expect(nextSaleBoundary(bf, jst('2026-11-20T12:00:00'))).toBe(bf.endsAt);
    expect(nextSaleBoundary(bf, jst('2026-11-26T00:00:00'))).toBeNull();
  });
});

describe('次回のセールへの流用', () => {
  const superSale: SaleCornerConfig = {
    id: 'rakuten-supersale-2026-12', title: '楽天スーパーSALE', activeLabel: '楽天スーパーSALE開催中', lead: 'x',
    startsAt: '2026-12-04T20:00:00+09:00', endsAt: '2026-12-11T01:59:00+09:00', announceFrom: '2026-11-27T00:00:00+09:00',
    officialUrl: 'https://event.rakuten.co.jp/campaign/supersale/', officialCheckedAt: '2026-11-20', conditionsNote: 'x', groups: [],
  };
  const all = [...SALE_CORNERS, superSale];

  it('開催中のものを優先し、終了したものは選ばない', () => {
    expect(pickSaleCorner(all, jst('2026-11-20T00:00:00'))?.id).toBe('rakuten-blackfriday-2026');
    expect(pickSaleCorner(all, jst('2026-11-25T01:59:00'))?.id).toBe('rakuten-supersale-2026-12');
    expect(pickSaleCorner(all, jst('2026-12-11T02:00:00'))).toBeNull();
  });
  it('告知開始前は選ばれても表示しない', () => {
    const c = toSaleCorner(superSale)!;
    expect(salePhaseAt(c, jst('2026-11-26T23:59:59'))).toBeNull();
    expect(salePhaseAt(c, jst('2026-11-27T00:00:00'))).toBe('upcoming');
    expect(upcomingLabel(c)).toBe('12月4日20時スタート');
  });
  it('不正な設定は出さない（終了が開始より前・楽天以外・アフィリエイト計測リンク）', () => {
    expect(toSaleCorner({ ...superSale, endsAt: superSale.startsAt })).toBeNull();
    expect(toSaleCorner({ ...superSale, officialUrl: 'https://example.com/' })).toBeNull();
    expect(toSaleCorner({ ...superSale, officialUrl: 'http://event.rakuten.co.jp/campaign/supersale/' })).toBeNull();
    expect(toSaleCorner({ ...superSale, officialUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/' })).toBeNull();
  });
});

describe('導線と GA4', () => {
  it('導線の順番とリンク先（推測で作らない）', () => {
    expect(LINKS.map((l) => [l.kind, l.href])).toEqual([
      ['oshi_shopping', '/oshi-shopping'],
      ['group_page', '/groups/snow-man'], ['live_archive', '/groups/snow-man/live'],
      ['group_page', '/groups/M!LK'], ['live_archive', '/groups/M!LK/live'],
      ['group_page', '/groups/sixtones'], ['live_archive', '/groups/sixtones/live'],
    ]);
    // ライブ映像特集の対象外ならライブ映像の導線は出さない
    expect(saleCornerLinks([{ groupName: 'X', groupHref: '/groups/x', liveHref: null }]).map((l) => l.kind)).toEqual(['oshi_shopping', 'group_page']);
  });

  it('イベント名とパラメータ', () => {
    expect(saleCornerViewEvent(bf, 'upcoming')).toEqual(['sale_corner_view', { sale_id: 'rakuten-blackfriday-2026', sale_phase: 'upcoming', placement: 'home_sale_corner' }]);
    expect(saleCornerCtaClickEvent(bf, 'active', LINKS[2], 3)).toEqual(['sale_corner_click', {
      sale_id: 'rakuten-blackfriday-2026', sale_phase: 'active', cta: 'live_archive', link_url: '/groups/snow-man/live',
      position: 3, placement: 'home_sale_corner', group_name: 'Snow Man',
    }]);
    const [name, params] = saleCornerOfficialClickEvent(bf, 'active');
    expect(name).toBe('rakuten_campaign_click');
    expect(params).toMatchObject({ sale_id: 'rakuten-blackfriday-2026', campaign_status: 'active', link_type: 'official', placement: 'home_sale_corner' });
    expect(params).not.toHaveProperty('campaign_id');
  });
});

describe('サーバー描画（最初の HTML はサーバーで決めた状態と同じ）', () => {
  const render = (phase: 'upcoming' | 'active' | null) =>
    renderToString(createElement(SaleCorner, { corner: bf, links: LINKS, initialPhase: phase }));

  it('開始前', () => {
    const html = render('upcoming');
    expect(html).toContain('11月19日20時スタート');
    expect(html).not.toContain('楽天ブラックフライデー開催中');
    expect(html).toContain('楽天ブラックフライデー2026');
    expect(html).toContain('11/19 20:00〜11/25 1:59');
  });

  it('開催中', () => {
    const html = render('active');
    expect(html).toContain('楽天ブラックフライデー開催中');
    expect(html).not.toContain('スタート');
  });

  it('終了後は何も出さない', () => {
    expect(render(null)).toBe('');
  });

  it('リンク: 推しサーチ内は同じタブ、楽天公式は新しいタブ・noopener、楽天の商品リンク・画像は無し', () => {
    const html = render('active');
    for (const href of ['/oshi-shopping', '/groups/snow-man', '/groups/M!LK/live', '/groups/sixtones/live']) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('href="https://event.rakuten.co.jp/campaign/point-up/blackfriday/" target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('hb.afl.rakuten.co.jp');
    expect(html).not.toContain('<img');
    expect(html.match(/target="_blank"/g)).toHaveLength(1);
    expect(html).toContain('エントリー');
  });
});
