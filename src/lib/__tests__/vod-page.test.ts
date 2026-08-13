import { describe, it, expect, vi, beforeEach } from 'vitest';

// vod-page.ts は '@/db/client' を静的import しているため、DB接続文字列が
// 無いテスト環境でも読み込めるよう execute() をスタブ化する。
const mockExecute = vi.fn();
vi.mock('@/db/client', () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));

import {
  VOD_PAGE_PROVIDERS,
  getVodPageProviderConfig,
  CONFIRMED_CONDITION_TEXT,
  parseVodPageParam,
  isVodPageOutOfRange,
  getVodProviderWorkCounts,
} from '../vod-page';

describe('getVodPageProviderConfig（対象14サービスのslug/displayName変換）', () => {
  const expected: { urlSlug: string; displayName: string; normalizedSlug: string }[] = [
    { urlSlug: 'hulu', displayName: 'Hulu', normalizedSlug: 'hulu' },
    { urlSlug: 'u-next', displayName: 'U-NEXT', normalizedSlug: 'unext' },
    { urlSlug: 'netflix', displayName: 'Netflix', normalizedSlug: 'netflix' },
    { urlSlug: 'prime-video', displayName: 'Prime Video', normalizedSlug: 'primevideo' },
    { urlSlug: 'disney-plus', displayName: 'Disney+', normalizedSlug: 'disneyplus' },
    { urlSlug: 'dmm-tv', displayName: 'DMM TV', normalizedSlug: 'dmmtv' },
    { urlSlug: 'lemino', displayName: 'Lemino', normalizedSlug: 'lemino' },
    { urlSlug: 'fod', displayName: 'FOD', normalizedSlug: 'fod' },
    { urlSlug: 'telasa', displayName: 'TELASA', normalizedSlug: 'telasa' },
    { urlSlug: 'abema', displayName: 'ABEMA', normalizedSlug: 'abema' },
    { urlSlug: 'tver', displayName: 'TVer', normalizedSlug: 'tver' },
    { urlSlug: 'youtube', displayName: 'YouTube', normalizedSlug: 'youtube' },
    { urlSlug: 'nhk-ondemand', displayName: 'NHKオンデマンド', normalizedSlug: 'nhkオンデマンド' },
    { urlSlug: 'nogidoga', displayName: 'のぎ動画', normalizedSlug: 'のぎ動画' },
  ];

  for (const { urlSlug, displayName, normalizedSlug } of expected) {
    it(`${urlSlug} → ${displayName}（正規化スラグ ${normalizedSlug}）`, () => {
      const config = getVodPageProviderConfig(urlSlug);
      expect(config).not.toBeNull();
      expect(config?.displayName).toBe(displayName);
      expect(config?.normalizedSlug).toBe(normalizedSlug);
    });
  }

  it('対象外のプロバイダー（未対応サービス）は null を返す＝無効', () => {
    expect(getVodPageProviderConfig('spotify')).toBeNull();
    expect(getVodPageProviderConfig('not-existing-provider')).toBeNull();
    expect(getVodPageProviderConfig('')).toBeNull();
  });

  it('VOD_PAGE_PROVIDERS は対象14サービスのみで構成される', () => {
    expect(VOD_PAGE_PROVIDERS).toHaveLength(14);
    expect(VOD_PAGE_PROVIDERS.map((p) => p.urlSlug).sort()).toEqual(
      expected.map((e) => e.urlSlug).sort(),
    );
  });

  it('urlSlugに重複がない', () => {
    const slugs = VOD_PAGE_PROVIDERS.map((p) => p.urlSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
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

describe('getVodProviderWorkCounts（トップページ・sitemap用の一括件数集計）', () => {
  beforeEach(() => { mockExecute.mockReset(); });

  it('同一サービスの表記ゆれ（例: Netflix / Netflix Standard with Ads）で同じ作品が両方に該当しても二重カウントしない', async () => {
    mockExecute
      // Stage 1: distinct providerName一覧
      .mockResolvedValueOnce({
        rows: [
          { provider_name: 'Netflix' },
          { provider_name: 'Netflix Standard with Ads' },
        ],
      })
      // Stage 2: (providerName, workId) の組。work-1がNetflixの両表記に該当する
      .mockResolvedValueOnce({
        rows: [
          { provider_name: 'Netflix', work_id: 'work-1' },
          { provider_name: 'Netflix Standard with Ads', work_id: 'work-1' },
          { provider_name: 'Netflix', work_id: 'work-2' },
        ],
      });

    const counts = await getVodProviderWorkCounts();
    expect(counts.get('netflix')).toBe(2); // work-1とwork-2のみ（work-1の重複表記は1件として数える）
  });

  it('対象14サービス以外のproviderNameは集計対象に含めない', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ provider_name: 'Hulu' }, { provider_name: 'Spotify' }] })
      .mockResolvedValueOnce({ rows: [{ provider_name: 'Hulu', work_id: 'work-1' }] });

    const counts = await getVodProviderWorkCounts();
    expect(counts.get('hulu')).toBe(1);
    expect([...counts.keys()]).toHaveLength(VOD_PAGE_PROVIDERS.length);
  });

  it('該当するproviderNameが1件もない場合は全サービス0件を返す', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const counts = await getVodProviderWorkCounts();
    for (const p of VOD_PAGE_PROVIDERS) {
      expect(counts.get(p.normalizedSlug)).toBe(0);
    }
  });
});
