// HTML広告コード欄にURLだけが登録されたVOD広告（例: Lemino）が、URL文字列ではなく
// 「〇〇で今すぐ見る →」ボタンとして描画されることの回帰テスト。
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResolvedAffiliateCreative } from '@/lib/affiliate-store';
import { getBareAffiliateUrl } from '@/lib/affiliate-creative';

const LEMINO_URL = 'https://tr.affiliate-sp.docomo.ne.jp/cl/d0000000236/5235/2';
const HULU_HTML = '<a href="https://h.accesstrade.net/sp/cc?rk=0100n6n400ovvr&url=https%3A%2F%2Fwww.hulu.jp%2F" rel="nofollow" referrerpolicy="no-referrer-when-downgrade">Huluで今すぐ見る<img src="https://h.accesstrade.net/sp/rr?rk=0100n6n400ovvr" width="1" height="1" border="0" alt=""></a>';

const ads: Record<string, ResolvedAffiliateCreative> = {};
vi.mock('@/lib/affiliate-store', () => ({
  resolveAffiliateSlot: async (vodService: string) => {
    const c = ads[vodService] ?? null;
    return { desktop: c, mobile: c };
  },
}));
const { default: AffiliateSlot } = await import('@/components/site/AffiliateSlot');

const creative = (over: Partial<ResolvedAffiliateCreative>): ResolvedAffiliateCreative => ({
  id: 1, programId: 1, name: '管理用の素材名', type: 'raw_html', rawCode: null,
  destinationUrl: null, imageUrl: null, altText: null, width: null, height: null, ...over,
});

async function render(vodService: string, slotKey = 'work_provider') {
  return renderToStaticMarkup(await AffiliateSlot({ vodService, slotKey }));
}

describe('getBareAffiliateUrl', () => {
  it('URL1つだけなら前後の空白を除いてそのまま返す', () => {
    expect(getBareAffiliateUrl(`  ${LEMINO_URL}\n`)).toBe(LEMINO_URL);
    expect(getBareAffiliateUrl('https://example.com/a?x=1&y=%2F')).toBe('https://example.com/a?x=1&y=%2F');
  });
  it('HTML広告コード・複数行・URL以外は対象外', () => {
    expect(getBareAffiliateUrl(HULU_HTML)).toBeNull();
    expect(getBareAffiliateUrl(`${LEMINO_URL}\n${LEMINO_URL}`)).toBeNull();
    expect(getBareAffiliateUrl('javascript:alert(1)')).toBeNull();
    expect(getBareAffiliateUrl('')).toBeNull();
    expect(getBareAffiliateUrl(null)).toBeNull();
  });
});

describe('AffiliateSlot: URLだけのraw_html', () => {
  it('Lemino: URLを文字として出さず、登録URLそのままのボタンにする（PR表記あり）', async () => {
    ads.lemino = creative({ rawCode: LEMINO_URL });
    const html = await render('lemino');
    expect(html).toContain(`<a href="${LEMINO_URL}" target="_blank" rel="sponsored noopener noreferrer"`);
    expect(html).toContain('Leminoで今すぐ見る →</a>');
    expect(html.split(LEMINO_URL)).toHaveLength(2); // href以外にURLが出ていない
    expect(html).toContain('>PR</span>');
    expect(html).toContain('data-vod-service="lemino"');
  });

  it('クエリ・エンコード済み文字を含むURLも改変しない', async () => {
    const url = 'https://example.com/cl?rk=abc&url=https%3A%2F%2Fwww.unext.jp%2F';
    ads.unext = creative({ rawCode: url });
    const html = await render('unext');
    expect(html).toContain('href="https://example.com/cl?rk=abc&amp;url=https%3A%2F%2Fwww.unext.jp%2F"');
    expect(html).toContain('U-NEXTで今すぐ見る →');
  });

  it('Hulu: 通常のHTML広告コードは従来どおり無改変で出力する', async () => {
    ads.hulu = creative({ rawCode: HULU_HTML });
    const html = await render('hulu');
    expect(html).toContain(HULU_HTML);
  });

  it('URLのみ(direct_url)でリンク文言が空なら、素材名ではなく標準文言を使う', async () => {
    ads.dmmtv = creative({ type: 'direct_url', destinationUrl: 'https://example.com/dmm' });
    const html = await render('dmmtv');
    expect(html).toContain('DMM TVで今すぐ見る →');
    expect(html).not.toContain('管理用の素材名');
  });
});
