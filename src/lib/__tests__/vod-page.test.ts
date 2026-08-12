import { describe, it, expect, vi } from 'vitest';

// vod-page.ts は '@/db/client' を静的import しているため、DB接続文字列が
// 無いテスト環境でも読み込めるよう execute() をスタブ化する（本テストでは未使用）。
vi.mock('@/db/client', () => ({ db: { execute: vi.fn() } }));

import {
  VOD_PAGE_PROVIDERS,
  getVodPageProviderConfig,
  CONFIRMED_CONDITION_TEXT,
  parseVodPageParam,
  isVodPageOutOfRange,
} from '../vod-page';

describe('getVodPageProviderConfig', () => {
  it('hulu → Hulu（正規化スラグ hulu）', () => {
    const config = getVodPageProviderConfig('hulu');
    expect(config).not.toBeNull();
    expect(config?.displayName).toBe('Hulu');
    expect(config?.normalizedSlug).toBe('hulu');
  });

  it('disney-plus → Disney+（正規化スラグ disneyplus）', () => {
    const config = getVodPageProviderConfig('disney-plus');
    expect(config).not.toBeNull();
    expect(config?.displayName).toBe('Disney+');
    expect(config?.normalizedSlug).toBe('disneyplus');
  });

  it('dmm-tv → DMM TV（正規化スラグ dmmtv）', () => {
    const config = getVodPageProviderConfig('dmm-tv');
    expect(config).not.toBeNull();
    expect(config?.displayName).toBe('DMM TV');
    expect(config?.normalizedSlug).toBe('dmmtv');
  });

  it('対象外のプロバイダー（netflix等）は null を返す＝無効', () => {
    expect(getVodPageProviderConfig('netflix')).toBeNull();
    expect(getVodPageProviderConfig('not-existing-provider')).toBeNull();
    expect(getVodPageProviderConfig('')).toBeNull();
  });

  it('VOD_PAGE_PROVIDERS は対象3サービスのみで構成される', () => {
    expect(VOD_PAGE_PROVIDERS).toHaveLength(3);
    expect(VOD_PAGE_PROVIDERS.map((p) => p.urlSlug).sort()).toEqual(
      ['disney-plus', 'dmm-tv', 'hulu'].sort(),
    );
  });
});

// getWorksForVodProvider 等のSQLは isConfirmedVodAvailability（vod-dedup.ts）と
// 同じ条件をDB側で再現する必要がある。DB接続なしでその条件文自体を検証する。
describe('CONFIRMED_CONDITION_TEXT（isConfirmedVodAvailability とのSQLレベル一致）', () => {
  it('type=unknown の作品を除外する条件を含む', () => {
    expect(CONFIRMED_CONDITION_TEXT).toContain("item->>'type' <> 'unknown'");
  });

  it('hidden=true の作品を除外する条件を含む', () => {
    expect(CONFIRMED_CONDITION_TEXT).toContain("item->>'hidden')::boolean, false) = false");
  });

  it('AI由来かつ低確度の作品を除外する条件を含む', () => {
    expect(CONFIRMED_CONDITION_TEXT).toContain('openai_supplement');
    expect(CONFIRMED_CONDITION_TEXT).toContain('openai_web_search');
    expect(CONFIRMED_CONDITION_TEXT).toContain("item->>'confidence' = 'low'");
  });
});

describe('parseVodPageParam', () => {
  it('パラメータなし → 1ページ目として有効', () => {
    expect(parseVodPageParam(undefined)).toBe(1);
  });

  it('page=1 → 有効', () => {
    expect(parseVodPageParam('1')).toBe(1);
  });

  it('page=24 のような通常の正の整数 → 有効', () => {
    expect(parseVodPageParam('24')).toBe(24);
  });

  it('page=0 → 無効（null）', () => {
    expect(parseVodPageParam('0')).toBeNull();
  });

  it('page=-1 → 無効（null）', () => {
    expect(parseVodPageParam('-1')).toBeNull();
  });

  it('page=abc（数字以外） → 無効（null）', () => {
    expect(parseVodPageParam('abc')).toBeNull();
  });

  it('page=1.5（小数） → 無効（null）', () => {
    expect(parseVodPageParam('1.5')).toBeNull();
  });

  it('page=999999999（巨大な正の整数の形式） → 形式としては有効（範囲外判定は別関数の責務）', () => {
    expect(parseVodPageParam('999999999')).toBe(999999999);
  });

  it('page=""（空文字） → 無効（null）', () => {
    expect(parseVodPageParam('')).toBeNull();
  });

  it('page=" 1"（前後空白混入） → 無効（null）', () => {
    expect(parseVodPageParam(' 1')).toBeNull();
    expect(parseVodPageParam('1 ')).toBeNull();
  });

  it('page=01（先頭ゼロ） → 無効（null）', () => {
    expect(parseVodPageParam('01')).toBeNull();
  });

  it('文字列配列の場合は先頭要素を評価する', () => {
    expect(parseVodPageParam(['2', '3'])).toBe(2);
    expect(parseVodPageParam(['abc'])).toBeNull();
  });
});

describe('isVodPageOutOfRange', () => {
  it('総ページ数を超えるpage指定（作品が実在するprovider） → 範囲外', () => {
    expect(isVodPageOutOfRange(999999, 1454, 61)).toBe(true);
  });

  it('総ページ数以内のpage指定 → 範囲内', () => {
    expect(isVodPageOutOfRange(61, 1454, 61)).toBe(false);
    expect(isVodPageOutOfRange(1, 1454, 61)).toBe(false);
  });

  it('該当作品が1件もない場合（totalCount=0）は、pageが1でも範囲外扱いにしない（通常の空一覧表示を維持）', () => {
    expect(isVodPageOutOfRange(1, 0, 0)).toBe(false);
  });
});
