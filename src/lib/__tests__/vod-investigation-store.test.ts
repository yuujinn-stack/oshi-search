import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup（work-dedup-apply.test.ts と同じ vi.hoisted パターン）───────────
const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateCalls: Array<{ set: unknown }> = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];

  const makeSelectChain = () => {
    const rows = selectQueue.shift() ?? [];
    const result = Object.assign(Promise.resolve(rows), {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      orderBy: () => Object.assign(Promise.resolve(rows), { limit: (n: number) => Promise.resolve(rows.slice(0, n)) }),
    });
    return { from: () => ({ where: () => result, orderBy: () => result }) };
  };

  const returningResult: { rows: unknown[] } = { rows: [] };

  const updateFn = vi.fn((_table: unknown) => ({
    set: (set: unknown) => {
      updateCalls.push({ set });
      return {
        where: () => Object.assign(Promise.resolve(undefined), {
          returning: () => Promise.resolve(returningResult.rows),
        }),
      };
    },
  }));

  const insertFn = vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      insertCalls.push({ table, values });
      return Promise.resolve([]);
    },
  }));

  const selectFn = vi.fn(makeSelectChain);

  return { selectQueue, updateCalls, insertCalls, returningResult, updateFn, insertFn, selectFn };
});

vi.mock('@/db/client', () => ({
  neonSql: vi.fn(async () => []),
  db: {
    select: mockState.selectFn,
    insert: mockState.insertFn,
    update: mockState.updateFn,
  },
}));

const mockResolveActiveWorkTargets = vi.hoisted(() => vi.fn());
vi.mock('@/lib/vod-recheck-store', () => ({
  activeWorkFragment: () => ({ _stub: 'active-fragment' }),
  resolveActiveWorkTargets: mockResolveActiveWorkTargets,
}));

import {
  createInvestigationJob,
  claimNextPendingItems,
  markItemFailed,
  retryFailedItems,
  setItemDecision,
  prepareInvestigationTargets,
  type InvestigationTargetWork,
} from '../vod-investigation-store';
import { MAX_AUTO_RETRY_COUNT } from '../vod-investigation';

beforeEach(() => {
  mockState.selectQueue.length = 0;
  mockState.updateCalls.length = 0;
  mockState.insertCalls.length = 0;
  mockState.returningResult.rows = [];
  vi.clearAllMocks();
  mockResolveActiveWorkTargets.mockReset();
});

function target(overrides: Partial<InvestigationTargetWork> = {}): InvestigationTargetWork {
  return {
    workId: 'work-1',
    personName: '人物A',
    title: 'タイトル',
    workType: 'movie',
    releaseYear: 2020,
    currentProviders: [],
    ...overrides,
  };
}

describe('createInvestigationJob', () => {
  it('ジョブと対象作品を挿入し、jobIdを返す', async () => {
    const jobId = await createInvestigationJob([target()], 'admin:test');
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
    expect(mockState.insertCalls).toHaveLength(2); // job本体 + items
  });

  it('対象0件でもジョブ自体は作成される（items挿入は行わない）', async () => {
    await createInvestigationJob([], 'admin:test');
    expect(mockState.insertCalls).toHaveLength(1); // jobのみ
  });
});

describe('claimNextPendingItems', () => {
  it('pending行を取得し、投機的にinvestigatingへ更新する', async () => {
    mockState.selectQueue.push([{ id: 1, retryCount: 0 }, { id: 2, retryCount: 0 }]);
    const rows = await claimNextPendingItems('job-1', 3);
    expect(rows).toHaveLength(2);
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0].set).toMatchObject({ status: 'investigating' });
  });

  it('対象0件なら更新は発生しない', async () => {
    mockState.selectQueue.push([]);
    const rows = await claimNextPendingItems('job-1', 3);
    expect(rows).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe('markItemFailed — 自動リトライ上限（無限リトライ防止）', () => {
  it('リトライ回数が上限以下ならpendingへ戻す', async () => {
    const result = await markItemFailed(1, 0, 'timeout');
    expect(result).toEqual({ status: 'pending', retryCount: 1 });
    expect(mockState.updateCalls[0].set).toMatchObject({ status: 'pending', retryCount: 1 });
  });

  it(`リトライ回数が上限(${MAX_AUTO_RETRY_COUNT})を超えたらfailedで確定する`, async () => {
    const result = await markItemFailed(1, MAX_AUTO_RETRY_COUNT, '429');
    expect(result.status).toBe('failed');
    expect(result.retryCount).toBe(MAX_AUTO_RETRY_COUNT + 1);
  });

  it('上限ちょうどまではpendingのまま', async () => {
    const result = await markItemFailed(1, MAX_AUTO_RETRY_COUNT - 1, 'network error');
    expect(result.status).toBe('pending');
    expect(result.retryCount).toBe(MAX_AUTO_RETRY_COUNT);
  });
});

describe('retryFailedItems — 明示的な失敗のみ再試行', () => {
  it('失敗件数を返し、pendingへリセットする', async () => {
    mockState.returningResult.rows = [{ id: 1 }, { id: 2 }];
    const count = await retryFailedItems('job-1');
    expect(count).toBe(2);
    expect(mockState.updateCalls[0].set).toMatchObject({ status: 'pending', retryCount: 0, errorMessage: null });
  });
});

describe('setItemDecision', () => {
  it('needs_review（要再調査）はstatusをpendingへ戻し、retryCountをリセットする', async () => {
    await setItemDecision(1, 'needs_review', undefined, 'admin');
    expect(mockState.updateCalls[0].set).toMatchObject({
      decision: 'needs_review',
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
    });
  });

  it('approvedはstatusをapprovedにする（retryCountはリセットしない）', async () => {
    await setItemDecision(1, 'approved', undefined, 'admin');
    const set = mockState.updateCalls[0].set as Record<string, unknown>;
    expect(set.status).toBe('approved');
    expect(set).not.toHaveProperty('retryCount');
  });

  it('manualはmanualProvidersを保存しstatusをapprovedにする', async () => {
    const providers = [{ providerId: 1, providerName: 'Netflix', type: 'flatrate' as const, countryCode: 'JP', source: 'manual_csv' as const }];
    await setItemDecision(1, 'manual', providers, 'admin');
    const set = mockState.updateCalls[0].set as Record<string, unknown>;
    expect(set.status).toBe('approved');
    expect(set.manualProviders).toEqual(providers);
  });

  it('rejectedはstatusをrejectedにする', async () => {
    await setItemDecision(1, 'rejected', undefined, 'admin');
    expect((mockState.updateCalls[0].set as Record<string, unknown>).status).toBe('rejected');
  });
});

describe('prepareInvestigationTargets', () => {
  it('解決済みworkIdが0件ならDB照会せず空を返す', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({ resolved: new Map(), unresolved: ['not-found'] });
    const result = await prepareInvestigationTargets(['not-found']);
    expect(result.targets).toEqual([]);
    expect(result.unresolvedWorkIds).toEqual(['not-found']);
  });

  it('解決済みworkIdをneonSqlで照会し対象作品リストを組み立てる', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([['old-id', { canonicalWorkId: 'work-1', resolvedViaAlias: true, personNames: ['人物A'] }]]),
      unresolved: [],
    });
    const { neonSql } = await import('@/db/client');
    (neonSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'work-1', person_name: '人物A', title: 'タイトル', type: 'movie', release_year: 2020, vod_data: { vodProviders: [] } },
    ]);
    const result = await prepareInvestigationTargets(['old-id']);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({ workId: 'work-1', personName: '人物A', title: 'タイトル', workType: 'movie', releaseYear: 2020 });
  });
});
