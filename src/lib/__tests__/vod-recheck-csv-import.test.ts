import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveActiveWorkTargets = vi.hoisted(() => vi.fn());
const mockGetWork = vi.hoisted(() => vi.fn());
const mockUpsertManualCsvVodProviders = vi.hoisted(() => vi.fn().mockResolvedValue({ added: 0, updated: 0 }));
const mockChatgptFullSyncVodProviders = vi.hoisted(() => vi.fn());
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
    chatgptFullSyncVodProviders: mockChatgptFullSyncVodProviders,
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
  mockChatgptFullSyncVodProviders.mockResolvedValue({
    diff: { added: ['Netflix'], removed: [], updated: [], unchanged: [] },
    resultCount: 1,
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

describe('runVodRecheckCsvImport — mode: chatgpt_full_sync（プレビュー）', () => {
  it('workIdを唯一の基準として解決する（mergeモードのupsertManualCsvVodProvidersは呼ばない）', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    const result = await runVodRecheckCsvImport(csv, false, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    expect(mockUpsertManualCsvVodProviders).not.toHaveBeenCalled();
    expect(mockChatgptFullSyncVodProviders).not.toHaveBeenCalled(); // プレビューはDB書き込みなし（純粋関数でシミュレーション）
    if (result.status === 200 && result.body.commit === false) {
      expect(result.body.mode).toBe('chatgpt_full_sync');
    }
  });

  it('STEP74: vodService=unknownのみの行は対象14VODを0件として扱う（providerを作らない）', async () => {
    mockGetWork.mockResolvedValue({
      title: '既存作品',
      vodProviders: [
        { providerId: 1, providerName: 'Hulu', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' },
        { providerId: 2, providerName: 'Netflix', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' },
      ],
    });
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,unknown,unknown,high,,14サービスを確認したが現在配信を確認できず';
    const result = await runVodRecheckCsvImport(csv, false, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      const entry = result.body.preview[0];
      expect(entry.afterVodCount).toBe(0);
      expect(entry.diff?.removed.sort()).toEqual(['Hulu', 'Netflix']);
      expect(entry.services).toEqual([]); // unknown行はサービスとして計上しない
    }
  });

  it('STEP33: 同名作品で特定できない旨のnoteはambiguous:trueとして検出される', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,unknown,unknown,low,,同名作品があり対象作品を確実に特定できず';
    const result = await runVodRecheckCsvImport(csv, false, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      expect(result.body.preview[0].ambiguous).toBe(true);
      expect(result.body.preview[0].warnings.some((w) => w.includes('特定できなかった'))).toBe(true);
    }
  });

  it('直前のプロンプト対象workIdのうちCSVに含まれないものをmissingFromLastPromptとして報告する', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    const result = await runVodRecheckCsvImport(csv, false, 'chatgpt_full_sync', ['work-1', 'work-2']);
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      expect(result.body.missingFromLastPrompt).toEqual(['work-2']);
    }
  });

  it('差分集計（summary）を返す', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    const result = await runVodRecheckCsvImport(csv, false, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === false) {
      expect(result.body.summary).toBeDefined();
      expect(typeof result.body.summary?.added).toBe('number');
    }
  });
});

describe('runVodRecheckCsvImport — mode: chatgpt_full_sync（実行）', () => {
  it('chatgptFullSyncVodProviders を呼び、mergeモードのupsertManualCsvVodProvidersは呼ばない', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    const result = await runVodRecheckCsvImport(csv, true, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    expect(mockChatgptFullSyncVodProviders).toHaveBeenCalledTimes(1);
    expect(mockUpsertManualCsvVodProviders).not.toHaveBeenCalled();
    if (result.status === 200 && result.body.commit === true) {
      expect(result.body.mode).toBe('chatgpt_full_sync');
      expect(result.body.updatedWorks).toBe(1);
    }
  });

  it('STEP75: 同名タイトルのworkId A/Bが存在してもCSVのworkId Aのみが更新され、Bは一切呼ばれない', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([
        ['work-A', { canonicalWorkId: 'work-A', resolvedViaAlias: false, personNames: ['人物A'] }],
      ]),
      unresolved: [],
    });
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-A,Netflix,flatrate,high,,';
    await runVodRecheckCsvImport(csv, true, 'chatgpt_full_sync');
    expect(mockChatgptFullSyncVodProviders).toHaveBeenCalledTimes(1);
    expect(mockChatgptFullSyncVodProviders).toHaveBeenCalledWith('人物A', 'work-A', expect.any(Array));
    // work-Bへの呼び出しは一切発生しない（workId基準の直接同期のため、タイトル一致による混入はない）
    const calledWorkIds = mockChatgptFullSyncVodProviders.mock.calls.map((c) => c[1]);
    expect(calledWorkIds).not.toContain('work-B');
  });

  it('成功時、対象作品の監査ログをchatgpt_full_syncとして記録する', async () => {
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    await runVodRecheckCsvImport(csv, true, 'chatgpt_full_sync');
    expect(mockInsertVodRecheckLog).toHaveBeenCalledWith(expect.objectContaining({
      performedBy: 'admin:vod-recheck-csv-import:chatgpt_full_sync',
      action: 'complete',
    }));
  });

  it('一部の人物行が失敗した場合、その作品はfailedWorkIdsに含まれる', async () => {
    mockResolveActiveWorkTargets.mockResolvedValue({
      resolved: new Map([
        ['work-1', { canonicalWorkId: 'work-1', resolvedViaAlias: false, personNames: ['人物A', '人物B'] }],
      ]),
      unresolved: [],
    });
    mockChatgptFullSyncVodProviders
      .mockResolvedValueOnce({ diff: { added: [], removed: [], updated: [], unchanged: [] }, resultCount: 0 })
      .mockRejectedValueOnce(new Error('DB error'));
    const csv = 'workId,vodService,availabilityType,confidence,sourceUrl,note\nwork-1,Netflix,flatrate,high,,';
    const result = await runVodRecheckCsvImport(csv, true, 'chatgpt_full_sync');
    expect(result.status).toBe(200);
    if (result.status === 200 && result.body.commit === true) {
      expect(result.body.failedWorkIds).toEqual(['work-1']);
      expect(result.body.errors.length).toBe(1);
    }
  });
});
