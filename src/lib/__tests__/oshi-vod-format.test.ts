import { describe, it, expect } from 'vitest';
import { formatIsoDateJa, formatMonthlyPrice, priceExclusionLabel } from '../oshi-vod/format';
import { getVodPlanInfo, type VodPlanInfo } from '../vod-plan-info';

const base: VodPlanInfo = {
  service: 'x', kind: 'subscription', planName: null, monthlyPrice: null, taxIncluded: null,
  sourceUrl: null, checkedAt: null, isComparable: false, officialUrl: 'https://example.com/',
};

describe('priceExclusionLabel（料金比較対象外の理由の出し分け）', () => {
  it('料金未確認', () => {
    expect(priceExclusionLabel(base)).toBe('料金未確認のため比較対象外');
    expect(priceExclusionLabel(base, 'short')).toBe('料金未確認');
    expect(priceExclusionLabel({ ...base, notComparableReason: 'price_unconfirmed' })).toBe('料金未確認のため比較対象外');
    expect(priceExclusionLabel(null)).toBe('料金未確認のため比較対象外');
  });

  it('税込料金が未確認（Netflix）', () => {
    expect(priceExclusionLabel(getVodPlanInfo('netflix'))).toBe('税込料金を公式で確認できないため比較対象外');
    expect(priceExclusionLabel(getVodPlanInfo('netflix'), 'short')).toBe('税込料金未確認');
  });

  it('無料サービス', () => {
    expect(priceExclusionLabel(getVodPlanInfo('tver'))).toBe('無料サービスのため月額比較なし');
    expect(priceExclusionLabel(getVodPlanInfo('youtube'), 'short')).toBe('無料サービス');
  });
});

describe('料金表示（プラン名つき）', () => {
  it.each([
    ['のぎ動画', 'WEB月額1,320円（税込）'],
    ['fod', 'スタンダードコース 月額1,320円（税込）'],
    ['nhkオンデマンド', 'まるごと見放題パック 月額990円（税込）'],
    ['abema', '広告つきABEMAプレミアム 月額680円（税込）'],
    ['hulu', '月額1,320円（税込）'],
  ])('%s → %s', (service, label) => {
    expect(formatMonthlyPrice(getVodPlanInfo(service), true)).toBe(label);
  });

  it('料金確認日は「YYYY年M月D日」で表示（推測で補完しない）', () => {
    expect(formatIsoDateJa('2026-10-09')).toBe('2026年10月9日');
    expect(formatIsoDateJa(null)).toBeNull();
    expect(formatIsoDateJa('2026/10/09')).toBeNull();
  });

  it('のぎ動画の詳細比較の注記に、アプリ経由では料金が異なる旨がある', () => {
    expect(getVodPlanInfo('のぎ動画')?.note).toMatch(/アプリ.*1,700円/);
  });
});
