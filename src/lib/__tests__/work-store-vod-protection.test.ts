import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateWorkVod は withWorkFromDB（db.select().from().where() → upsertWork）を使う。
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

import { updateWorkVod } from '../work-store';
import type { VodProvider } from '@/types/vod';

const DAY_MS = 24 * 60 * 60 * 1000;

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1, providerName: 'Hulu', type: 'flatrate', countryCode: 'JP', source: 'manual_csv',
    ...overrides,
  };
}

function dbWorkRow(vodData: Record<string, unknown>) {
  const now = new Date();
  return {
    id: 'work-1', personName: '人物A', title: '作品A', originalTitle: null, normalizedTitle: '作品A',
    type: 'tv', tmdbId: 1, source: 'tmdb', releaseYear: 2020, roleName: null, overview: null,
    posterUrl: null, manualImageUrl: null, ogImageUrl: null, ogSourceUrl: null, ogImageFetchedAt: null,
    ogImageStatus: null, ogImageError: null, confidenceScore: '100', status: 'auto_published',
    deleted: false, deletedAt: null, deletedBy: null, checkedAt: null,
    aiData: {}, vodData, createdAt: now, updatedAt: now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.selectQueue.length = 0;
});

describe('updateWorkVod — ChatGPT完全同期保護期間（High修正の回帰テスト）', () => {
  it('ケース1: ChatGPT未調査作品はTMDb結果を従来通り登録できる', async () => {
    mockState.selectQueue.push([dbWorkRow({ vodProviders: [] })]);
    await updateWorkVod('人物A', 'work-1', [provider({ providerName: 'Hulu', source: 'tmdb_watch_provider' })]);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    expect(saved.vodProviders.map((p: VodProvider) => p.providerName)).toEqual(['Hulu']);
  });

  it('ケース2: ChatGPT完全同期済み(Huluのみ)・保護期間内にTMDbがHulu+Disney+を返しても、Disney+は追加されない', async () => {
    const now = Date.now();
    mockState.selectQueue.push([dbWorkRow({
      vodProviders: [provider({ providerName: 'Hulu', source: 'manual_csv', sourceLabel: 'ChatGPT完全調査' })],
      lastChatgptResearchAt: now - 10 * DAY_MS, // 保護期間内（180日以内）
      chatgptResearchMode: 'full_sync',
      chatgptServiceScope: 'major14',
    })]);
    await updateWorkVod('人物A', 'work-1', [
      provider({ providerName: 'Hulu', source: 'tmdb_watch_provider' }),
      provider({ providerName: 'Disney+', source: 'tmdb_watch_provider' }),
    ]);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    const names = saved.vodProviders.map((p: VodProvider) => p.providerName);
    expect(names).toContain('Hulu'); // ChatGPT由来のHuluは保持
    expect(names).not.toContain('Disney+'); // TMDb由来の新規追加はブロックされる
  });

  it('ケース3: ChatGPT完全同期済み(Disney+のみ)・保護期間内は、旧AI補完がLeminoを返しても再追加されない', async () => {
    const now = Date.now();
    mockState.selectQueue.push([dbWorkRow({
      vodProviders: [provider({ providerName: 'Disney+', source: 'manual_csv', sourceLabel: 'ChatGPT完全調査' })],
      lastChatgptResearchAt: now - 5 * DAY_MS,
      chatgptResearchMode: 'full_sync',
    })]);
    await updateWorkVod('人物A', 'work-1', [provider({ providerName: 'Lemino', source: 'openai_web_search' })], {
      replaceSources: ['openai_supplement', 'openai_web_search', 'ai_recheck'],
    });
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    const names = saved.vodProviders.map((p: VodProvider) => p.providerName);
    expect(names).toEqual(['Disney+']);
    expect(names).not.toContain('Lemino');
  });

  it('保護期間を過ぎた場合はTMDb/AIによる更新を通常どおり許可する', async () => {
    const now = Date.now();
    mockState.selectQueue.push([dbWorkRow({
      vodProviders: [provider({ providerName: 'Hulu', source: 'manual_csv', sourceLabel: 'ChatGPT完全調査' })],
      lastChatgptResearchAt: now - 200 * DAY_MS, // 保護期間(180日)を超過
      chatgptResearchMode: 'full_sync',
    })]);
    await updateWorkVod('人物A', 'work-1', [
      provider({ providerName: 'Disney+', source: 'tmdb_watch_provider' }),
    ]);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    const names = saved.vodProviders.map((p: VodProvider) => p.providerName);
    expect(names).toContain('Disney+'); // 保護期間終了後は通常どおり追加される
  });

  it('保護期間中でも対象14サービス以外（特殊provider）は通常どおり追加できる', async () => {
    const now = Date.now();
    mockState.selectQueue.push([dbWorkRow({
      vodProviders: [provider({ providerName: 'Hulu', source: 'manual_csv', sourceLabel: 'ChatGPT完全調査' })],
      lastChatgptResearchAt: now - 5 * DAY_MS,
      chatgptResearchMode: 'full_sync',
    })]);
    await updateWorkVod('人物A', 'work-1', [
      provider({ providerName: 'WOWOW', source: 'tmdb_watch_provider' }), // 14サービス外
    ]);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    const names = saved.vodProviders.map((p: VodProvider) => p.providerName);
    expect(names).toContain('Hulu');
    expect(names).toContain('WOWOW'); // scope外は保護の対象外なので通常どおり追加される
  });

  it('ケース6: TMDb Cronが実行されてもlastChatgptResearchAtは変更されない（updateWorkVodはこのフィールドを書き換えない）', async () => {
    const now = Date.now();
    const lastChatgptResearchAt = now - 5 * DAY_MS;
    mockState.selectQueue.push([dbWorkRow({
      vodProviders: [provider({ providerName: 'Hulu', source: 'manual_csv' })],
      lastChatgptResearchAt,
      chatgptResearchMode: 'full_sync',
    })]);
    await updateWorkVod('人物A', 'work-1', [provider({ providerName: 'WOWOW', source: 'tmdb_watch_provider' })]);
    const saved = mockState.upsertWorkFn.mock.calls[0][0];
    expect(saved.lastChatgptResearchAt).toBe(lastChatgptResearchAt); // 変更されていない
  });
});
