import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveActiveWorkTargets = vi.hoisted(() => vi.fn());
const mockGetWork = vi.hoisted(() => vi.fn());
const mockUpsertManualCsvVodProviders = vi.hoisted(() => vi.fn().mockResolvedValue({ added: 0, updated: 0 }));
const mockSyncManualCsvVodProviders = vi.hoisted(() => vi.fn().mockResolvedValue({ added: 0, removed: 0 }));
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
    syncManualCsvVodProviders: mockSyncManualCsvVodProviders,
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

describe('runVodRecheckCsvImport — mergeStrategy: additive（既定・既存仕様）', () => {
  it('プレビュー: sync特有の警告は出ない', async () => {
    const result = await runVodRecheckCsvImport(CSV, false);
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      const entry = result.body.preview[0];
      expect(entry.warnings.some((w) => w.includes('置き換えられます'))).toBe(false);
    }
  });

  it('実行: upsertManualCsvVodProviders（追加型）を呼び、syncは呼ばない', async () => {
    const result = await runVodRecheckCsvImport(CSV, true);
    expect(result.status).toBe(200);
    expect(mockUpsertManualCsvVodProviders).toHaveBeenCalledTimes(1);
    expect(mockSyncManualCsvVodProviders).not.toHaveBeenCalled();
  });
});

describe('runVodRecheckCsvImport — mergeStrategy: sync（自動調査ジョブの反映で使用）', () => {
  it('プレビュー: 既存manual_csvが置き換えられる旨の警告が出る', async () => {
    const result = await runVodRecheckCsvImport(CSV, false, { mergeStrategy: 'sync' });
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      const entry = result.body.preview[0];
      expect(entry.warnings.some((w) => w.includes('置き換えられます'))).toBe(true);
    }
  });

  it('実行: syncManualCsvVodProviders（完全置換）を呼び、upsertは呼ばない', async () => {
    const result = await runVodRecheckCsvImport(CSV, true, { mergeStrategy: 'sync' });
    expect(result.status).toBe(200);
    expect(mockSyncManualCsvVodProviders).toHaveBeenCalledTimes(1);
    expect(mockUpsertManualCsvVodProviders).not.toHaveBeenCalled();
  });

  it('実行: 監査ログにmergeStrategyを含むnoteとperformedByオーバーライドを記録する', async () => {
    await runVodRecheckCsvImport(CSV, true, { mergeStrategy: 'sync', performedBy: 'admin:test-apply' });
    expect(mockInsertVodRecheckLog).toHaveBeenCalledWith(expect.objectContaining({
      performedBy: 'admin:test-apply',
      note: expect.stringContaining('sync'),
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
