import { describe, test, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { ACCESSTRADE_OSHI_AD_BANNER_HTML, isOshiAdEnabled, isSupportAdsCtaEnabled } from '@/components/affiliate/oshi-ad-link';
import { FAQ_ITEMS, FLOW_STEPS, MEDIA_GUIDES, SUPPORT_ADS_PATH } from '@/lib/support-ads/content';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('推しアドの承認済みリンクコード', () => {
  test('AccessTrade のリンクコードを改変していない（クリックURL・計測img・rel・referrerpolicy）', () => {
    expect(ACCESSTRADE_OSHI_AD_BANNER_HTML).toBe(
      '<a href="https://h.accesstrade.net/sp/cc?rk=0100q6rn00ovvr" rel="nofollow" referrerpolicy="no-referrer-when-downgrade"><img src="https://h.accesstrade.net/sp/rr?rk=0100q6rn00ovvr" alt="#推しアド" border="0" width="300" height="250"></a>',
    );
  });

  test('人物ページのバナーと応援広告ガイドは同じリンクコードを使い、公式URLへの直リンクを持たない', () => {
    for (const file of ['src/components/affiliate/OshiAdBanner.tsx', 'src/components/affiliate/SupportAdsCta.tsx']) {
      const src = read(file);
      expect(src).toContain("from './oshi-ad-link'");
      expect(src).not.toContain('oshi-ad.com');
      expect(src).not.toContain('h.accesstrade.net');
    }
    const page = read('src/app/support-ads/page.tsx');
    expect(page).not.toContain('oshi-ad.com');
    expect(page).not.toContain('lin.ee');
  });

  test('表示は NEXT_PUBLIC_OSHI_AD_ENABLED=true のときだけ（opt-in）', () => {
    vi.stubEnv('NEXT_PUBLIC_OSHI_AD_ENABLED', 'true');
    expect(isOshiAdEnabled()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_OSHI_AD_ENABLED', 'false');
    expect(isOshiAdEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_OSHI_AD_ENABLED', '');
    expect(isOshiAdEnabled()).toBe(false);
  });

  test('応援広告ガイドの広告枠は、推しアド表示に加えて NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED=true のときだけ', () => {
    vi.stubEnv('NEXT_PUBLIC_OSHI_AD_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED', '');
    expect(isSupportAdsCtaEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED', 'true');
    expect(isSupportAdsCtaEnabled()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_OSHI_AD_ENABLED', 'false');
    expect(isSupportAdsCtaEnabled()).toBe(false);
    expect(read('src/app/support-ads/page.tsx')).toContain('isSupportAdsCtaEnabled()');
  });

  test('クリック計測は既存の affiliate_click（affiliate_name=oshi_ad）を1つの onClick で送る', () => {
    const src = read('src/components/affiliate/SupportAdsCta.tsx');
    expect(src.match(/sendGaEvent\(/g)).toHaveLength(1);
    expect(src).toContain("'affiliate_click'");
    expect(src).toContain("affiliate_name: 'oshi_ad'");
    expect(src).not.toContain('/api/track');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('応援広告ガイドの掲載内容', () => {
  test('パスと必須セクションのデータがそろっている', () => {
    expect(SUPPORT_ADS_PATH).toBe('/support-ads');
    expect(MEDIA_GUIDES.map((m) => m.name)).toEqual(['駅ポスター', '駅サイネージ', '屋外ビジョン']);
    expect(FLOW_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(5);
  });

  test('確認できない表記（最安・最新・予約受付中・必ず・保証）を使わない', () => {
    const text = JSON.stringify([MEDIA_GUIDES, FLOW_STEPS, FAQ_ITEMS]) + read('src/app/support-ads/page.tsx');
    for (const word of ['最安', '最新料金', '予約受付中', '保証', '絶対']) {
      expect(text).not.toContain(word);
    }
  });

  test('sitemap に /support-ads を含む', () => {
    expect(read('src/app/sitemap.ts')).toContain('`${BASE_URL}/support-ads`');
  });
});
