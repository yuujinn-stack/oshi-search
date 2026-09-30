import { describe, it, expect, vi } from 'vitest';

// server-only とDB・外部データに触れるモジュールはモックする（ここでは純粋な選択ロジックだけを確かめる）
vi.mock('server-only', () => ({}));
vi.mock('@/server/instagram-post/person-data', () => ({ fetchPersonWorks: vi.fn() }));
vi.mock('@/server/instagram-post/blob', () => ({ findExistingPersonPhoto: vi.fn() }));
vi.mock('@/server/instagram-post/build-post-vod-compare', () => ({ aggregateVodCounts: vi.fn() }));

import { getEligibleTemplates, pickAutoTemplate } from '@/server/instagram-schedule/auto-template';
import { formatGraphErrorDetail } from '@/server/instagram-post/graph-client';
import { H_TEMPLATE_ID, INSTAGRAM_TEMPLATES } from '@/lib/instagram-templates';

const RICH = { hasPhoto: true, workCount: 50, vodServiceCount: 10 };

describe('H は自動（おすすめ）の選択に現れない', () => {
  it('候補テンプレートにHは含まれない（どんなに条件の良い人物でも）', () => {
    expect(getEligibleTemplates(RICH).map((t) => t.id)).not.toContain(H_TEMPLATE_ID);
  });

  it('どの「直前のテンプレート」から回しても、Hは選ばれない', () => {
    const eligible = getEligibleTemplates(RICH);
    for (const prev of [null, H_TEMPLATE_ID, ...INSTAGRAM_TEMPLATES.map((t) => t.id)]) {
      expect(pickAutoTemplate(eligible, prev).id).not.toBe(H_TEMPLATE_ID);
    }
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

describe('Graph APIエラーの詳細（原因切り分け用）', () => {
  it('code・種別・fbtrace_idを付ける（秘密情報は含まない）', () => {
    expect(formatGraphErrorDetail(400, { error: { message: 'API access blocked.', type: 'OAuthException', code: 200, fbtrace_id: 'ABC' } }))
      .toBe('（HTTP 400 / code 200 / OAuthException / fbtrace_id ABC）');
    expect(formatGraphErrorDetail(400, { error: { message: 'x', code: 9004, error_subcode: 2207052 } }))
      .toBe('（HTTP 400 / code 9004/2207052）');
    expect(formatGraphErrorDetail(500, undefined)).toBe('');
  });
});
