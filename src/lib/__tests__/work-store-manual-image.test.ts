import { describe, it, expect, vi, beforeEach } from 'vitest';

// setManualImageUrl は DBから1件読み取り→対象フィールドのみ書き換え→upsertWork で保存する。
// work-store.ts が @/db/client をモジュール読み込み時に参照するため、既存の慣例どおりモックする。
const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertValuesCalls: unknown[] = [];

  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    return { from: () => ({ where: () => Promise.resolve(rows) }) };
  };

  const insertValuesFn = vi.fn((values: unknown) => {
    insertValuesCalls.push(values);
    return { onConflictDoUpdate: () => Promise.resolve() };
  });
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));
  const selectFn = vi.fn(makeSelectChain);

  return { selectQueue, insertValuesCalls, insertValuesFn, insertFn, selectFn, makeSelectChain };
});

vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: mockState.selectFn, insert: mockState.insertFn },
}));

import { setManualImageUrl } from '../work-store';

function dbWorkRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'work-1',
    personName: '人物A',
    title: 'タイトル',
    originalTitle: null,
    normalizedTitle: 'タイトル',
    type: 'movie',
    tmdbId: null,
    source: 'tmdb',
    releaseYear: 2021,
    roleName: null,
    overview: null,
    posterUrl: 'https://image.tmdb.org/poster.jpg',
    manualImageUrl: null,
    ogImageUrl: 'https://lemino.docomo.ne.jp/logo.png',
    ogSourceUrl: null,
    ogImageFetchedAt: null,
    ogImageStatus: null,
    ogImageError: null,
    confidenceScore: '0',
    status: 'auto_published',
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    checkedAt: null,
    aiData: {},
    vodData: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  mockState.selectQueue.length = 0;
  mockState.insertValuesCalls.length = 0;
  vi.clearAllMocks();
  mockState.selectFn.mockImplementation(mockState.makeSelectChain);
});

describe('setManualImageUrl', () => {
  it('作品が存在しなければfalseを返す（保存もしない）', async () => {
    mockState.selectQueue.push([]);
    const ok = await setManualImageUrl('人物A', 'work-1', 'https://example.com/manual.jpg');
    expect(ok).toBe(false);
    expect(mockState.insertValuesCalls).toHaveLength(0);
  });

  it('URLを設定すると保存される（他フィールドは変更しない）', async () => {
    mockState.selectQueue.push([dbWorkRow()]);
    const ok = await setManualImageUrl('人物A', 'work-1', 'https://example.com/manual.jpg');
    expect(ok).toBe(true);
    expect(mockState.insertValuesCalls).toHaveLength(1);
    const saved = mockState.insertValuesCalls[0] as { manualImageUrl: string | null; posterUrl: string | null; ogImageUrl: string | null };
    expect(saved.manualImageUrl).toBe('https://example.com/manual.jpg');
    // 手動画像を設定しても既存のposterUrl/ogImageUrlは消えない（優先順位の下位として保持される）
    expect(saved.posterUrl).toBe('https://image.tmdb.org/poster.jpg');
    expect(saved.ogImageUrl).toBe('https://lemino.docomo.ne.jp/logo.png');
  });

  it('nullを渡すと手動画像を解除する', async () => {
    mockState.selectQueue.push([dbWorkRow({ manualImageUrl: 'https://example.com/old.jpg' })]);
    const ok = await setManualImageUrl('人物A', 'work-1', null);
    expect(ok).toBe(true);
    const saved = mockState.insertValuesCalls[0] as { manualImageUrl: string | null };
    expect(saved.manualImageUrl).toBeNull();
  });
});
