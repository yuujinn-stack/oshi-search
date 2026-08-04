import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonBatchResult } from '@/lib/batch-processor';

// ── モジュールモック ──────────────────────────────────────────────────────────
// processPerson自体はbatch-processor.test.tsで別途検証済みのため、ここではAPI Route
// (/api/admin/ai-judge) がprocessPersonの結果を正しくレスポンスへ反映するかだけを検証する。

const mockProcessPerson = vi.hoisted(() => vi.fn());
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetRedis = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/batch-processor', () => ({ processPerson: mockProcessPerson }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

import { POST } from '@/app/api/admin/ai-judge/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/ai-judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE_RESULT: PersonBatchResult = {
  personName: 'テスト人物', stored: 0, aiJudged: 0, aiQueued: 0, autoApproved: 0, skipped: 0, excluded: 0,
  usedSuppressed: 0, membershipFiltered: 0, fetchFailed: 0, failedCategories: [], aiFailed: 0, aiKeyMissing: false,
  relatedCount: 0, unrelatedCount: 0, uncertainCount: 0, rakutenConfigMissing: false, aiFailures: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRedis.mockReturnValue({}); // truthy: Redis設定済みガードを通過させるためのダミー
  mockGetAllPersonsMerged.mockResolvedValue([{ name: 'テスト人物', group: '', config: {} }]);
});

describe('POST /api/admin/ai-judge', () => {
  it('personNameが無ければ400', async () => {
    const res = await POST(makePost({}) as never);
    expect(res.status).toBe(400);
  });

  it('人物が見つからなければ404', async () => {
    mockGetAllPersonsMerged.mockResolvedValue([]);
    const res = await POST(makePost({ personName: '存在しない人物' }) as never);
    expect(res.status).toBe(404);
  });

  it('1件成功: aiJudged=1・relatedCount=1・aiFailed=0が返る', async () => {
    mockProcessPerson.mockResolvedValue({
      ...BASE_RESULT, stored: 1, aiQueued: 1, aiJudged: 1, relatedCount: 1,
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.person.aiJudged).toBe(1);
    expect(body.person.relatedCount).toBe(1);
    expect(body.person.aiFailed).toBe(0);
  });

  it('一部失敗: 成功分(aiJudged)は維持され、失敗詳細がaiFailuresに入る', async () => {
    mockProcessPerson.mockResolvedValue({
      ...BASE_RESULT, stored: 2, aiQueued: 2, aiJudged: 1, aiFailed: 1, relatedCount: 1,
      aiFailures: [{ productId: 'item-ng', productTitle: '商品B', code: 'RATE_LIMIT', message: 'OpenAI APIのレート制限に達しました' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.person.aiJudged).toBe(1);
    expect(body.person.aiFailed).toBe(1);
    expect(body.person.aiFailures).toHaveLength(1);
    expect(body.person.aiFailures[0].code).toBe('RATE_LIMIT');
  });

  it('全件失敗: aiJudged=0でも200を返し、失敗理由(message)がaiFailuresに入る', async () => {
    mockProcessPerson.mockResolvedValue({
      ...BASE_RESULT, stored: 1, aiQueued: 1, aiJudged: 0, aiFailed: 1,
      aiFailures: [{ productId: 'item-a', productTitle: '商品A', code: 'OPENAI_API_ERROR', message: 'OpenAI APIエラー（HTTP 500）' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.person.aiJudged).toBe(0);
    expect(body.person.aiFailed).toBe(1);
    expect(body.person.aiFailures[0].message).toBe('OpenAI APIエラー（HTTP 500）');
  });

  it('対象0件（楽天正常・商品0件）: status=no_targetsで正常メッセージが返る', async () => {
    mockProcessPerson.mockResolvedValue({ ...BASE_RESULT, stored: 0, skipped: 0, fetchFailed: 0 });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('no_targets');
    expect(body.person.message).toBe('楽天API正常・該当商品0件');
  });

  it('対象0件（商品はあるが全件判定済み・AI対象なし）: 正常メッセージが返る', async () => {
    mockProcessPerson.mockResolvedValue({ ...BASE_RESULT, stored: 5, skipped: 5, aiQueued: 0, aiJudged: 0 });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.person.message).toContain('全件判定済み');
  });

  it('/admin/product-check はrevalidatePathしない（router.refreshによるソフト更新に一本化）', async () => {
    mockProcessPerson.mockResolvedValue({ ...BASE_RESULT, stored: 1, aiQueued: 1, aiJudged: 1 });
    await POST(makePost({ personName: 'テスト人物' }) as never);
    const calledPaths = mockRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calledPaths).not.toContain('/admin/product-check');
    expect(calledPaths).toContain(`/person/${encodeURIComponent('テスト人物')}`);
  });

  it('Redis未設定なら503（既存仕様: このガードはfixで変更していない）', async () => {
    mockGetRedis.mockReturnValue(null);
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(res.status).toBe(503);
    expect(mockProcessPerson).not.toHaveBeenCalled();
  });
});
