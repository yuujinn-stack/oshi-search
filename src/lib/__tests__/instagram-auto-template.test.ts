import { describe, it, expect, vi } from 'vitest';

// server-only とDB・外部データに触れるモジュールはモックする（ここでは純粋な選択ロジックだけを確かめる）
vi.mock('server-only', () => ({}));
vi.mock('@/server/instagram-post/person-data', () => ({ fetchPersonWorks: vi.fn() }));
vi.mock('@/server/instagram-post/blob', () => ({ findExistingPersonPhoto: vi.fn() }));
vi.mock('@/server/instagram-post/build-post-vod-compare', () => ({ aggregateVodCounts: vi.fn() }));
vi.mock('@/server/instagram-post/site-ui/builders', () => ({ evaluateSiteUiAvailability: vi.fn() }));

import { getEligibleTemplates, pickAutoTemplate } from '@/server/instagram-schedule/auto-template';
import { formatGraphErrorDetail } from '@/server/instagram-post/graph-client';
import { H_TEMPLATE_ID } from '@/lib/instagram-templates';

const RICH = { hasPhoto: true, workCount: 50, vodServiceCount: 10 };

// siteUi を渡さない場合（H・G・J の判定なし）は、従来の既存4テンプレートだけで動く
describe('既存4テンプレートの自動ローテーション（従来どおり）', () => {
  it('H・G・J の判定がなければ候補は既存4テンプレートだけ', () => {
    expect(getEligibleTemplates(RICH).map((t) => t.id)).toEqual(['default-person', 'works-only', 'works-picks', 'vod-compare']);
  });

  it('既存のローテーション順（works-only → works-picks → vod-compare → default-person）は変わらない', () => {
    const eligible = getEligibleTemplates(RICH);
    expect(pickAutoTemplate(eligible, null).id).toBe('works-only');
    expect(pickAutoTemplate(eligible, 'works-only').id).toBe('works-picks');
    expect(pickAutoTemplate(eligible, 'works-picks').id).toBe('vod-compare');
    expect(pickAutoTemplate(eligible, 'vod-compare').id).toBe('default-person');
    expect(pickAutoTemplate(eligible, 'default-person').id).toBe('works-only');
  });
});

/** 直前のテンプレートから n 回続けて自動選択した結果（1日複数投稿・日をまたぐ一括予約と同じ連鎖） */
function chain(ctx: Parameters<typeof getEligibleTemplates>[0], prev: string | null, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    prev = pickAutoTemplate(getEligibleTemplates(ctx), prev).id;
    out.push(prev);
  }
  return out;
}
const OLD4 = ['works-only', 'works-picks', 'vod-compare', 'default-person'];

describe('自動（おすすめ）に H・G・J を含める', () => {
  it('① 通常データの人物（7テンプレートとも可）：既存4 → H → G → J → 既存4…と巡回する', () => {
    const ctx = { ...RICH, siteUi: { h: true, g: true, j: true } };
    expect(chain(ctx, null, 9)).toEqual([...OLD4, H_TEMPLATE_ID, 'search-too-much', 'real-screen', 'works-only', 'works-picks']);
  });
  it('既存4テンプレートが使えない人物（作品が少ない・写真なし）では H → G → J → H …', () => {
    const ctx = { hasPhoto: false, workCount: 2, vodServiceCount: 1, siteUi: { h: true, g: true, j: true } };
    expect(chain(ctx, null, 6)).toEqual([H_TEMPLATE_ID, 'search-too-much', 'real-screen', H_TEMPLATE_ID, 'search-too-much', 'real-screen']);
  });
  it('② J 不可・H/G 可：J を飛ばして H → G → H → G …', () => {
    const ctx = { hasPhoto: false, workCount: 2, vodServiceCount: 1, siteUi: { h: true, g: true, j: false } };
    expect(chain(ctx, null, 5)).toEqual([H_TEMPLATE_ID, 'search-too-much', H_TEMPLATE_ID, 'search-too-much', H_TEMPLATE_ID]);
  });
  it('③ G/J 不可で H のみ：毎回 H', () => {
    const ctx = { hasPhoto: false, workCount: 2, vodServiceCount: 1, siteUi: { h: true, g: false, j: false } };
    expect(chain(ctx, 'search-too-much', 3)).toEqual([H_TEMPLATE_ID, H_TEMPLATE_ID, H_TEMPLATE_ID]);
  });
  it('H/G/J と既存4テンプレートがすべて不可なら候補なし（エラー＝予約を作らない）', () => {
    const ctx = { hasPhoto: false, workCount: 0, vodServiceCount: 0, siteUi: { h: false, g: false, j: false } };
    expect(getEligibleTemplates(ctx)).toEqual([]);
    expect(() => pickAutoTemplate([], null)).toThrow();
  });
  it('直前がこの人物では作れないテンプレート（例：直前が J、この人物は J 不可）でも先頭に戻さず、その位置から続ける', () => {
    const noJ = { ...RICH, siteUi: { h: true, g: true, j: false } };
    // 並びは 既存4 → H → G → J → 先頭。J の次は works-only
    expect(pickAutoTemplate(getEligibleTemplates(noJ), 'real-screen').id).toBe('works-only');
    // 直前が G なら、J を飛ばして works-only
    expect(pickAutoTemplate(getEligibleTemplates(noJ), 'search-too-much').id).toBe('works-only');
    // H のみ可の人物で直前が vod-compare → H
    const onlyH = { hasPhoto: false, workCount: 0, vodServiceCount: 0, siteUi: { h: true, g: false, j: false } };
    expect(pickAutoTemplate(getEligibleTemplates(onlyH), 'vod-compare').id).toBe(H_TEMPLATE_ID);
  });
  it('候補が2種類以上なら同じテンプレートが連続しない（1日複数投稿でも偏らない）', () => {
    for (const siteUi of [{ h: true, g: true, j: true }, { h: true, g: true, j: false }, { h: false, g: true, j: true }]) {
      const seq = chain({ ...RICH, siteUi }, null, 30);
      expect(seq.every((t, i) => i === 0 || t !== seq[i - 1])).toBe(true);
    }
  });
});

describe('Graph APIエラーの詳細（原因切り分け用）', () => {
  it('code・種別・fbtrace_idを付ける（秘密情報は含まない）', () => {
    expect(formatGraphErrorDetail(400, { error: { message: 'API access blocked.', type: 'OAuthException', code: 200, fbtrace_id: 'ABC' } }))
      .toBe('（HTTP 400 / code 200 / OAuthException / fbtrace_id ABC）');
    expect(formatGraphErrorDetail(400, { error: { message: 'x', code: 9004, error_subcode: 2207052 } }))
      .toBe('（HTTP 400 / code 9004/2207052）');
    expect(formatGraphErrorDetail(500, undefined)).toBe('');
  });
});
