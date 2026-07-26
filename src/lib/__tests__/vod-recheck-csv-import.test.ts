import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveActiveWorkTargets = vi.hoisted(() => vi.fn());
const mockGetWork = vi.hoisted(() => vi.fn());
const mockUpsertManualCsvVodProviders = vi.hoisted(() => vi.fn().mockResolvedValue({ added: 0, updated: 0 }));
const mockInsertVodRecheckLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetInactiveProviderSlugs = vi.hoisted(() => vi.fn().mockResolvedValue(new Set(['dtv'])));

vi.mock('@/lib/vod-recheck-store', () => ({
  resolveActiveWorkTargets: mockResolveActiveWorkTargets,
}));

vi.mock('@/lib/work-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../work-store')>();
  return {
    ...actual,
    getWork: mockGetWork,
    upsertManualCsvVodProviders: mockUpsertManualCsvVodProviders,
  };
});

vi.mock('@/db/write', () => ({
  insertVodRecheckLog: mockInsertVodRecheckLog,
}));

vi.mock('@/lib/provider-store', () => ({
  getInactiveProviderSlugs: mockGetInactiveProviderSlugs,
}));

// work-store.ts の実体には @/db/client への直接参照は無いが、間接的にimportされるモジュールが
// neon()を初期化しうるため、既存の慣例どおりモックしておく
vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));

import { runVodRecheckCsvImport } from '../vod-recheck-csv-import';

const CSV = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,https://example.com,テスト';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInactiveProviderSlugs.mockResolvedValue(new Set(['dtv']));
  mockResolveActiveWorkTargets.mockResolvedValue({
    resolved: new Map([['work-1', { canonicalWorkId: 'work-1', resolvedViaAlias: false, personNames: ['人物A'] }]]),
    unresolved: [],
  });
  mockGetWork.mockResolvedValue({
    title: '既存作品', vodProviders: [
      { providerId: 9, providerName: 'Amazon Prime Video', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' },
    ],
    lastVodCheckAt: undefined, vodAiCheckedAt: undefined, vodCheckStatus: 'fresh',
  });
});

describe('runVodRecheckCsvImport — 入力検証', () => {
  it('空CSVは400', async () => {
    const result = await runVodRecheckCsvImport('', false);
    expect(result.status).toBe(400);
  });
});

describe('runVodRecheckCsvImport — プレビュー（commit=false）', () => {
  it('現在のVOD件数・反映後のVOD件数・追加サービスを返す', async () => {
    const result = await runVodRecheckCsvImport(CSV, false);
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      const entry = result.body.preview[0];
      expect(entry.workId).toBe('work-1');
      expect(entry.services).toEqual([{ providerName: 'Netflix', availabilityType: 'flatrate' }]);
      expect(entry.currentVodCount).toBe(1);
      expect(entry.afterVodCount).toBe(2);
    }
  });

  it('DBへは書き込まない（upsertManualCsvVodProvidersを呼ばない）', async () => {
    await runVodRecheckCsvImport(CSV, false);
    expect(mockUpsertManualCsvVodProviders).not.toHaveBeenCalled();
  });
});

describe('runVodRecheckCsvImport — 実行（commit=true）', () => {
  it('upsertManualCsvVodProviders（同名manual_csvは上書き、他は保持）を呼ぶ', async () => {
    const result = await runVodRecheckCsvImport(CSV, true);
    expect(result.status).toBe(200);
    expect(mockUpsertManualCsvVodProviders).toHaveBeenCalledTimes(1);
  });

  it('監査ログを記録する', async () => {
    await runVodRecheckCsvImport(CSV, true);
    expect(mockInsertVodRecheckLog).toHaveBeenCalledWith(expect.objectContaining({
      performedBy: 'admin:vod-recheck-csv-import',
      action: 'complete',
    }));
  });
});

describe('runVodRecheckCsvImport — 未解決workId', () => {
  it('解決できないworkIdはunresolvedWorkIdsに入りhasFatalErrorsがtrueになる', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({ resolved: new Map(), unresolved: ['ghost-id'] });
    const result = await runVodRecheckCsvImport(CSV, false);
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      expect(result.body.unresolvedWorkIds).toEqual(['ghost-id']);
      expect(result.body.hasFatalErrors).toBe(true);
    }
  });
});
