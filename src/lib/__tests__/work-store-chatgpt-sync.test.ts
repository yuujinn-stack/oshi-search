import { describe, it, expect, vi, beforeEach } from 'vitest';

// chatgptFullSyncVodProviders は withWorkFromDB（db.select().from().where() → upsertWork）を使う。
const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    return { from: () => ({ where: () => Promise.resolve(rows) }) };
  };
  const selectFn = vi.fn(makeSelectChain);
  const upsertWorkFn = vi.fn().mockResolvedValue(undefined);
  return { selectQueue, selectFn, upsertWorkFn };
});

vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: mockState.selectFn },
}));

vi.mock('@/db/write', () => ({
  upsertWork: mockState.upsertWorkFn,
}));

import { chatgptFullSyncVodProviders } from '../work-store';
import type { VodProvider } from '@/types/vod';

function dbWorkRow(vodProviders: VodProvider[]) {
  const now = new Date();
  return {
    id: 'work-1', personName: '人物A', title: '作品A', originalTitle: null, normalizedTitle: '作品A',
    type: 'tv', tmdbId: 1, source: 'tmdb', releaseYear: 2020, roleName: null, overview: null,
    posterUrl: null, manualImageUrl: null, ogImageUrl: null, ogSourceUrl: null, ogImageFetchedAt: null,
    ogImageStatus: null, ogImageError: null, confidenceScore: '100', status: 'auto_published',
    deleted: false, deletedAt: null, deletedBy: null, checkedAt: null,
    aiData: {}, vodData: { vodProviders }, createdAt: now, updatedAt: now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.selectQueue.length = 0;
});

describe('chatgptFullSyncVodProviders', () => {
  it('該当行がない場合はnullを返す', async () => {
    mockState.selectQueue.push([]);
    const result = await chatgptFullSyncVodProviders('人物A', 'work-1', [{ providerName: 'Hulu', type: 'flatrate' }]);
    expect(result).toBeNull();
    expect(mockState.upsertWorkFn).not.toHaveBeenCalled();
  });

  it('成功時、ChatGPT調査履歴（lastChatgptResearchAt等）を更新し、priorityRecheckを解除する', async () => {
    mockState.selectQueue.push([dbWorkRow([{ providerId: 1, providerName: 'Lemino', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' }])]);
    const result = await chatgptFullSyncVodProviders('人物A', 'work-1', [{ providerName: 'Disney+', type: 'flatrate' }]);

    expect(result).not.toBeNull();
    expect(result?.diff.added).toEqual(['Disney+']);
    expect(result?.diff.removed).toEqual(['Lemino']);

    expect(mockState.upsertWorkFn).toHaveBeenCalledTimes(1);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    expect(saved.lastChatgptResearchAt).toBeGreaterThan(0);
    expect(saved.chatgptResultCount).toBe(1);
    expect(saved.chatgptResearchMode).toBe('full_sync');
    expect(saved.chatgptServiceScope).toBe('major14');
    expect(saved.priorityRecheck).toBe(false);
    // Leminoが消え、Disney+が入っている（完全同期）
    const names = (saved.vodProviders as VodProvider[]).map((p) => p.providerName);
    expect(names).toContain('Disney+');
    expect(names).not.toContain('Lemino');
  });

  it('lastVodCheckAtも更新する（既存のCron/AI再確認staleness判定と競合しないため）', async () => {
    mockState.selectQueue.push([dbWorkRow([])]);
    const before = Date.now();
    const result = await chatgptFullSyncVodProviders('人物A', 'work-1', [{ providerName: 'Hulu', type: 'flatrate' }]);
    expect(result).not.toBeNull();
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    expect(saved.lastVodCheckAt).toBeGreaterThanOrEqual(before);
  });

  it('ケース7: 再実行するとlastChatgptResearchAtが更新され、最新CSV結果が対象14サービスの正となる', async () => {
    // 1回目: Huluのみで完全同期
    mockState.selectQueue.push([dbWorkRow([])]);
    const first = await chatgptFullSyncVodProviders('人物A', 'work-1', [{ providerName: 'Hulu', type: 'flatrate' }]);
    const firstSaved = mockState.upsertWorkFn.mock.calls[0][0];
    expect(firstSaved.vodProviders.map((p: VodProvider) => p.providerName)).toEqual(['Hulu']);
    const firstResearchAt = firstSaved.lastChatgptResearchAt as number;

    // 2回目: 1回目の結果を「既存」として、Disney+のみへ再同期（Huluは今回の結果に含まれないため削除される）
    await new Promise((r) => setTimeout(r, 2));
    mockState.selectQueue.push([dbWorkRow(firstSaved.vodProviders)]);
    const second = await chatgptFullSyncVodProviders('人物A', 'work-1', [{ providerName: 'Disney+', type: 'flatrate' }]);
    const secondSaved = mockState.upsertWorkFn.mock.calls[1][0];

    expect(second?.diff.removed).toEqual(['Hulu']);
    expect(second?.diff.added).toEqual(['Disney+']);
    expect(secondSaved.lastChatgptResearchAt).toBeGreaterThan(firstResearchAt);
    const names = secondSaved.vodProviders.map((p: VodProvider) => p.providerName);
    expect(names).toEqual(['Disney+']);
    expect(names).not.toContain('Hulu');
    void first;
  });
});
