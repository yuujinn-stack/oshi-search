import { describe, it, expect } from 'vitest';
import { VOD_PLAN_INFO, getVodPlanInfo, isPriceComparable, type VodPlanInfo } from '../vod-plan-info';
import { VOD_PROVIDER_DISPLAY_NAMES } from '../vod-provider-names';
import { normalizeProviderName } from '../vod-dedup';

describe('vod-plan-info', () => {
  it('service は正規化スラグと一致し、14サービスの表示名マップに存在する', () => {
    for (const p of VOD_PLAN_INFO) {
      expect(normalizeProviderName(p.service)).toBe(p.service);
      expect(VOD_PROVIDER_DISPLAY_NAMES[p.service]).toBeDefined();
    }
  });

  // VOD_PROVIDER_DISPLAY_NAMES は VOD_PAGE_PROVIDERS と整合が検証済みの14サービスの Single Source of Truth
  it('対象14サービスをすべて網羅し、重複がない', () => {
    const services = VOD_PLAN_INFO.map((p) => p.service);
    expect(new Set(services).size).toBe(services.length);
    for (const slug of Object.keys(VOD_PROVIDER_DISPLAY_NAMES)) expect(services).toContain(slug);
  });

  it('isComparable=true のサービスは比較に必要な項目がすべて揃っている', () => {
    for (const p of VOD_PLAN_INFO.filter((x) => x.isComparable)) {
      expect(p.kind).toBe('subscription');
      expect(p.planName).toBeTruthy();
      expect(p.monthlyPrice).toBeGreaterThan(0);
      expect(p.taxIncluded).not.toBeNull();
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isPriceComparable(p)).toBe(true);
    }
  });

  it('checkedAt は実在する日付で、未来日ではない', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const p of VOD_PLAN_INFO) {
      if (!p.checkedAt) continue;
      const d = new Date(`${p.checkedAt}T00:00:00Z`);
      expect(Number.isNaN(d.getTime())).toBe(false);
      expect(d.toISOString().slice(0, 10)).toBe(p.checkedAt);
      expect(p.checkedAt <= today).toBe(true);
    }
  });

  it('料金が確認できていないサービスは比較対象外', () => {
    for (const p of VOD_PLAN_INFO.filter((x) => x.monthlyPrice == null)) {
      expect(p.isComparable).toBe(false);
      expect(isPriceComparable(p)).toBe(false);
    }
  });

  it('無料サービス（TVer・YouTube）は比較対象外', () => {
    expect(getVodPlanInfo('tver')?.kind).toBe('free');
    expect(getVodPlanInfo('youtube')?.kind).toBe('free');
    expect(isPriceComparable(getVodPlanInfo('tver'))).toBe(false);
    expect(isPriceComparable(getVodPlanInfo('youtube'))).toBe(false);
  });

  it('officialUrl はすべて https', () => {
    for (const p of VOD_PLAN_INFO) expect(p.officialUrl).toMatch(/^https:\/\//);
  });

  it('isPriceComparable は1項目でも欠けると false', () => {
    const base = getVodPlanInfo('unext')!;
    const variants: Partial<VodPlanInfo>[] = [
      { isComparable: false }, { monthlyPrice: null }, { monthlyPrice: 0 }, { taxIncluded: null },
      { sourceUrl: null }, { checkedAt: null }, { planName: null }, { kind: 'free' },
    ];
    for (const v of variants) expect(isPriceComparable({ ...base, ...v })).toBe(false);
    expect(isPriceComparable(null)).toBe(false);
    expect(getVodPlanInfo('unknown-service')).toBeNull();
  });
});

describe('2026-10-09 公式確認で比較対象に追加したサービス', () => {
  it.each([
    ['fod', 1320, 'FODプレミアム スタンダードコース', 'https://fod.fujitv.co.jp/about/'],
    ['abema', 680, '広告つきABEMAプレミアム', 'https://abema.tv/about/premium'],
    ['nhkオンデマンド', 990, 'まるごと見放題パック', 'https://www.nhk-ondemand.jp/share/enjoy/'],
    ['のぎ動画', 1320, '有料会員（WEB登録）', 'https://support.nogidoga.com/hc/ja/articles/42825275623705'],
  ])('%s: 月額%i円（税込）・%s', (service, price, planName, sourceUrl) => {
    const p = getVodPlanInfo(service)!;
    expect(p.monthlyPrice).toBe(price);
    expect(p.taxIncluded).toBe(true);
    expect(p.planName).toBe(planName);
    expect(p.sourceUrl).toBe(sourceUrl);
    expect(p.checkedAt).toBe('2026-10-09');
    expect(isPriceComparable(p)).toBe(true);
  });

  it('Netflix は税込表記を公式で確認できないため比較対象外のまま（理由: tax_unconfirmed）', () => {
    const p = getVodPlanInfo('netflix')!;
    expect(isPriceComparable(p)).toBe(false);
    expect(p.notComparableReason).toBe('tax_unconfirmed');
  });

  it('比較対象外の有料サブスクは Netflix のみ', () => {
    expect(VOD_PLAN_INFO.filter((p) => p.kind === 'subscription' && !isPriceComparable(p)).map((p) => p.service)).toEqual(['netflix']);
  });
});
