import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonBatchResult } from '@/lib/batch-processor';

// /api/admin/rakuten-refetch は旧 /api/admin/ai-judge の楽天取得+AI判定の挙動をそのまま
// 引き継いだエンドポイント（「楽天再取得」ボタン専用）。processPerson()を呼ぶことだけを確認する
// （processPerson自体の詳細な挙動はbatch-processor.test.tsで既に検証済み）。

const mockProcessPerson = vi.hoisted(() => vi.fn());
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetRedis = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/batch-processor', () => ({ processPerson: mockProcessPerson }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

import { POST } from '@/app/api/admin/rakuten-refetch/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/rakuten-refetch', {
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
  mockGetRedis.mockReturnValue({});
  mockGetAllPersonsMerged.mockResolvedValue([{ name: 'テスト人物', group: '', config: {} }]);
});

describe('POST /api/admin/rakuten-refetch', () => {
  it('processPerson() を呼ぶ（楽天取得+AI判定の既存挙動を維持）', async () => {
    mockProcessPerson.mockResolvedValue({ ...BASE_RESULT, stored: 5 });
    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(mockProcessPerson).toHaveBeenCalledWith('テスト人物', false, expect.objectContaining({ name: 'テスト人物' }));
  });

  it('楽天429・全カテゴリ取得0件: rate_limited・専用メッセージを返す', async () => {
    mockProcessPerson.mockResolvedValue({
      ...BASE_RESULT, fetchFailed: 6, stored: 0, upstreamHttpStatus: 429,
      failedCategories: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.status).toBe('rate_limited');
    expect(body.error).toBe('楽天APIが一時的な利用制限中です。しばらく待ってから楽天再取得を実行してください。');
  });

  it('正常系: stored>0でsuccessを返す', async () => {
    mockProcessPerson.mockResolvedValue({ ...BASE_RESULT, stored: 5, aiQueued: 5, aiJudged: 5 });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('success');
  });

  it('/api/admin/ai-judgeとは別エンドポイントとして独立している', async () => {
    // このファイル自体が /api/admin/rakuten-refetch/route.ts から直接importしていることが
    // /api/admin/ai-judge とは別ルートである証拠。processPerson呼び出しの有無で分離を確認する。
    mockProcessPerson.mockResolvedValue(BASE_RESULT);
    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(mockProcessPerson).toHaveBeenCalledTimes(1);
  });
});
