import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupplementVodWithAIOrThrow = vi.hoisted(() => vi.fn());
const mockClaimNextPendingItems = vi.hoisted(() => vi.fn());
const mockMarkItemInvestigated = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMarkItemFailed = vi.hoisted(() => vi.fn());
const mockGetInactiveProviderSlugs = vi.hoisted(() => vi.fn().mockResolvedValue(new Set(['dtv'])));

vi.mock('@/lib/vod-supplement', () => ({
  supplementVodWithAIOrThrow: mockSupplementVodWithAIOrThrow,
}));
vi.mock('@/lib/provider-store', () => ({
  getInactiveProviderSlugs: mockGetInactiveProviderSlugs,
}));
vi.mock('@/lib/vod-investigation-store', () => ({
  claimNextPendingItems: mockClaimNextPendingItems,
  markItemInvestigated: mockMarkItemInvestigated,
  markItemFailed: mockMarkItemFailed,
}));

import { processInvestigationBatch } from '../vod-investigation-runner';
import { INVESTIGATION_CONCURRENCY } from '../vod-investigation';

function item(overrides: Partial<{ id: number; workId: string; personName: string; title: string; workType: string; releaseYear: number | null; retryCount: number }> = {}) {
  return {
    id: 1, workId: 'work-1', personName: '人物A', title: 'タイトル', workType: 'movie', releaseYear: 2020, retryCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInactiveProviderSlugs.mockResolvedValue(new Set(['dtv']));
});

describe('processInvestigationBatch', () => {
  it('対象0件なら何もせず終了する', async () => {
    mockClaimNextPendingItems.mockResolvedValue([]);
    const result = await processInvestigationBatch('job-1');
    expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0, requeuedForRetry: 0 });
    expect(mockSupplementVodWithAIOrThrow).not.toHaveBeenCalled();
  });

  it('成功した項目はmarkItemInvestigatedへ候補を渡す', async () => {
    mockClaimNextPendingItems.mockResolvedValue([item({ id: 1 })]);
    mockSupplementVodWithAIOrThrow.mockResolvedValue([
      { providerId: 1, providerName: 'Netflix', type: 'flatrate', countryCode: 'JP', source: 'openai_web_search', sourceUrl: 'https://example.com' },
    ]);
    const result = await processInvestigationBatch('job-1');
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, requeuedForRetry: 0 });
    expect(mockMarkItemInvestigated).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ providerName: 'Netflix' }),
    ]));
  });

  it('AI呼び出しが失敗（例外）した項目はmarkItemFailedへ回る（無限リトライにならない）', async () => {
    mockClaimNextPendingItems.mockResolvedValue([item({ id: 2, retryCount: 0 })]);
    mockSupplementVodWithAIOrThrow.mockRejectedValue(new Error('429 rate limited'));
    mockMarkItemFailed.mockResolvedValue({ status: 'pending', retryCount: 1 });

    const result = await processInvestigationBatch('job-1');
    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1, requeuedForRetry: 1 });
    expect(mockMarkItemFailed).toHaveBeenCalledWith(2, 0, expect.stringContaining('429'));
    expect(mockMarkItemInvestigated).not.toHaveBeenCalled();
  });

  it('リトライ上限超過でfailed確定した場合はrequeuedForRetryに数えない', async () => {
    mockClaimNextPendingItems.mockResolvedValue([item({ id: 3, retryCount: 2 })]);
    mockSupplementVodWithAIOrThrow.mockRejectedValue(new Error('timeout'));
    mockMarkItemFailed.mockResolvedValue({ status: 'failed', retryCount: 3 });

    const result = await processInvestigationBatch('job-1');
    expect(result.requeuedForRetry).toBe(0);
    expect(result.failed).toBe(1);
  });

  it(`同時実行数はINVESTIGATION_CONCURRENCY(${INVESTIGATION_CONCURRENCY})を超えない`, async () => {
    const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3 })];
    mockClaimNextPendingItems.mockResolvedValue(items);

    let inFlight = 0;
    let maxInFlight = 0;
    mockSupplementVodWithAIOrThrow.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return [];
    });

    await processInvestigationBatch('job-1');
    expect(maxInFlight).toBeLessThanOrEqual(INVESTIGATION_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1); // 直列(1)ではなく並行実行されていることも確認
  });

  it('AIが空配列（配信サービス確認できず）を返した場合、失敗ではなくunknown候補として成功扱い', async () => {
    mockClaimNextPendingItems.mockResolvedValue([item({ id: 4 })]);
    mockSupplementVodWithAIOrThrow.mockResolvedValue([]);
    const result = await processInvestigationBatch('job-1');
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    const candidates = mockMarkItemInvestigated.mock.calls[0][1];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerName).toBe('unknown');
  });
});
