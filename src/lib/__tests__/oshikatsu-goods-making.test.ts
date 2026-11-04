import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  OSHIKATSU_SERVICE_LINKS,
  hasAffiliateLink,
  resolveServiceLink,
  type OshikatsuServiceLink,
} from '@/lib/oshikatsu-services/links';
import {
  COMPARE_ROWS,
  GOODS_MAKING_FAQ,
  GOODS_MAKING_PATH,
  GOODS_MAKING_SERVICES,
} from '@/lib/oshikatsu-services/goods-making';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

// 一般的なASPの広告リンクのドメイン（未提携の間はどこにも含めない）
const AD_HOSTS = ['a8.net', 'px.a8.net', 'accesstrade', 'valuecommerce', 'afi-b.com', 'moshimo', 'felmat', 'rentracks'];

describe('推し活グッズ制作サービスのリンク設定（未提携）', () => {
  test('両社とも公式サイトへの通常リンクで、広告リンクは無効', () => {
    expect(OSHIKATSU_SERVICE_LINKS.shimauma_plus.officialUrl).toBe('https://www.shimauma-plus.n-pri.jp/');
    expect(OSHIKATSU_SERVICE_LINKS.cherish_palette.officialUrl).toBe('https://cherish-palette.jp/');
    for (const link of Object.values(OSHIKATSU_SERVICE_LINKS)) {
      expect(link.affiliateUrl).toBeNull();
      expect(link.isAffiliateEnabled).toBe(false);
      expect(link.creative).toBeNull();
      expect(resolveServiceLink(link)).toEqual({ href: link.officialUrl, isAffiliate: false });
    }
    expect(hasAffiliateLink(GOODS_MAKING_SERVICES.map((s) => s.id))).toBe(false);
  });

  test('広告リンクは「有効フラグ＋URLあり」のときだけ使う', () => {
    const base: OshikatsuServiceLink = { ...OSHIKATSU_SERVICE_LINKS.shimauma_plus };
    expect(resolveServiceLink({ ...base, isAffiliateEnabled: true, affiliateUrl: null }).isAffiliate).toBe(false);
    expect(resolveServiceLink({ ...base, isAffiliateEnabled: true, affiliateUrl: '  ' }).isAffiliate).toBe(false);
    expect(resolveServiceLink({ ...base, isAffiliateEnabled: false, affiliateUrl: 'https://example.com/ad' }).isAffiliate).toBe(false);
    expect(resolveServiceLink({ ...base, isAffiliateEnabled: true, affiliateUrl: 'https://example.com/ad' })).toEqual({
      href: 'https://example.com/ad',
      isAffiliate: true,
    });
  });

  test('ページ・設定・掲載内容に広告リンクのドメイン、報酬額やプログラムIDが含まれない', () => {
    const files = [
      'src/lib/oshikatsu-services/links.ts',
      'src/lib/oshikatsu-services/goods-making.ts',
      'src/app/oshikatsu/goods-making/page.tsx',
      'src/components/oshikatsu/ServiceOutboundLink.tsx',
    ];
    for (const f of files) {
      const src = read(f).toLowerCase();
      const urls = src.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      for (const url of urls) {
        for (const host of AD_HOSTS) expect(url, `${f} に ${host}`).not.toContain(host);
      }
      expect(src).not.toMatch(/s0000\d{6,}/); // A8 のプログラムID
      expect(src).not.toContain('成果報酬');
    }
  });
});

describe('推し活グッズ制作サービス比較の掲載内容', () => {
  test('パスと比較表の項目', () => {
    expect(GOODS_MAKING_PATH).toBe('/oshikatsu/goods-making');
    expect(COMPARE_ROWS.map((r) => r.label)).toEqual([
      '主な制作アイテム',
      '最小注文個数',
      '料金の目安（税込）',
      '送料（税込）',
      '制作・発送期間',
      '注文方法',
      '注意事項',
    ]);
  });

  test('各サービスの出典は公式ドメインのみ', () => {
    for (const s of GOODS_MAKING_SERVICES) {
      const host = new URL(OSHIKATSU_SERVICE_LINKS[s.id].officialUrl).host;
      expect(s.sources.length).toBeGreaterThan(0);
      for (const src of s.sources) expect(new URL(src.url).host).toBe(host);
    }
  });

  test('ランキング・口コミ・満足度の表現を使わない', () => {
    const text = JSON.stringify({ GOODS_MAKING_SERVICES, GOODS_MAKING_FAQ });
    for (const w of ['ランキング', '口コミ', '満足度', '第1位', 'No.1']) expect(text).not.toContain(w);
    expect(GOODS_MAKING_FAQ.length).toBeGreaterThanOrEqual(3);
    expect(GOODS_MAKING_FAQ.length).toBeLessThanOrEqual(4);
  });
});
