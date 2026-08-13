import { describe, it, expect } from 'vitest';
import { getDaysSinceChecked, getVodStaleStatus, VOD_STALE_STATUS_LABEL } from '../vod-stale';

const DAY = 24 * 60 * 60 * 1000;

describe('getDaysSinceChecked', () => {
  it('checkedAtがnullの場合はnull', () => {
    expect(getDaysSinceChecked(null)).toBeNull();
  });

  it('checkedAtがundefinedの場合はnull', () => {
    expect(getDaysSinceChecked(undefined)).toBeNull();
  });

  it('ちょうど30日前 → 30', () => {
    const now = 1_000_000_000_000;
    expect(getDaysSinceChecked(now - 30 * DAY, now)).toBe(30);
  });

  it('未来日時が渡された場合は0（安全側）', () => {
    const now = 1_000_000_000_000;
    expect(getDaysSinceChecked(now + DAY, now)).toBe(0);
  });
});

describe('getVodStaleStatus（境界値）', () => {
  it('経過日数なし（null） → unknown', () => {
    expect(getVodStaleStatus(null)).toBe('unknown');
  });

  it('0日 → fresh', () => {
    expect(getVodStaleStatus(0)).toBe('fresh');
  });

  it('30日（fresh上限） → fresh', () => {
    expect(getVodStaleStatus(30)).toBe('fresh');
  });

  it('31日（aging下限） → aging', () => {
    expect(getVodStaleStatus(31)).toBe('aging');
  });

  it('60日（aging上限） → aging', () => {
    expect(getVodStaleStatus(60)).toBe('aging');
  });

  it('61日（stale下限） → stale', () => {
    expect(getVodStaleStatus(61)).toBe('stale');
  });

  it('365日 → stale', () => {
    expect(getVodStaleStatus(365)).toBe('stale');
  });
});

describe('VOD_STALE_STATUS_LABEL', () => {
  it('全ステータスにテキストラベルが定義されている（色のみ判別を避けるため）', () => {
    expect(VOD_STALE_STATUS_LABEL.fresh).toBeTruthy();
    expect(VOD_STALE_STATUS_LABEL.aging).toBeTruthy();
    expect(VOD_STALE_STATUS_LABEL.stale).toBeTruthy();
    expect(VOD_STALE_STATUS_LABEL.unknown).toBeTruthy();
  });
});
