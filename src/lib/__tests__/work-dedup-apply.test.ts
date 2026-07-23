import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup ──────────────────────────────────────────────────────────────
// vi.hoisted: vi.mock 工場より先に評価されるため、クロージャで共有状態を持てる

const mockState = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const neonSqlCalls: unknown[][] = [];

  const makeChain = () => {
    const rows = selectQueue.shift() ?? [];
    const result = Object.assign(Promise.resolve(rows), {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    });
    return { from: () => ({ where: () => result }) };
  };

  const transactionFn = vi.fn().mockResolvedValue([]);
  const neonSqlFn = Object.assign(
    vi.fn((...args: unknown[]) => {
      neonSqlCalls.push(args);
      return { _stub: true };
    }),
    { transaction: transactionFn },
  );

  const insertValuesFn = vi.fn().mockResolvedValue([]);
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));
  const selectFn = vi.fn(makeChain);
  const redisFn = vi.fn(() => null);

  return {
    selectQueue,
    neonSqlCalls,
    neonSqlFn,
    transactionFn,
    insertFn,
    insertValuesFn,
    selectFn,
    redisFn,
    makeChain,
  };
});

vi.mock('@/db/client', () => ({
  neonSql: mockState.neonSqlFn,
  db: {
    select: mockState.selectFn,
    insert: mockState.insertFn,
  },
}));

vi.mock('@/lib/redis', () => ({
  getRedis: mockState.redisFn,
}));

import { validateApplyRequest, mergeVodProviders, buildApplyPreview, executeApply } from '../work-dedup-apply';
import type { VodProvider } from '@/types/vod';

// ─── テスト前処理 ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.selectQueue.length = 0;
  mockState.neonSqlCalls.length = 0;
  vi.clearAllMocks();
  // clearAllMocks 後に実装を再設定
  mockState.selectFn.mockImplementation(mockState.makeChain);
  mockState.transactionFn.mockResolvedValue([]);
  mockState.insertValuesFn.mockResolvedValue([]);
  mockState.insertFn.mockImplementation(() => ({ values: mockState.insertValuesFn }));
  mockState.neonSqlFn.mockImplementation((...args: unknown[]) => {
    mockState.neonSqlCalls.push(args);
    return { _stub: true };
  });
  // neonSql.transaction は Object.assign で付与されているため再設定
  Object.assign(mockState.neonSqlFn, { transaction: mockState.transactionFn });
  mockState.redisFn.mockReturnValue(null);
});

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

const GROUP_KEY   = 'a'.repeat(64); // 64文字の有効な groupKey
const CANONICAL_ID = 'tmdb-movie-12345';
const DUPE_ID_1   = 'csv-movie-test';
const DUPE_ID_2   = 'csv-movie-another';

function makeReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    candidateGroupKey: GROUP_KEY,
    algorithmVersion: 'v1',
    candidateWorkIds: [CANONICAL_ID, DUPE_ID_1],
    normalizedTitle: 'テスト',
    detectedConfidence: 'high',
    reviewStatus: 'approved_duplicate',
    selectedCanonicalWorkId: CANONICAL_ID,
    reviewerNote: null,
    reviewedBy: null,
    reviewedAt: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    appliedAt: null,
    appliedBy: null,
    appliedCanonicalWorkId: null,
    applyResult: null,
    ...overrides,
  };
}

function makeWorkRow(id: string, personName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    personName,
    roleName: null,
    status: 'published',
    vodData: { vodProviders: [] },
    ...overrides,
  };
}

function makeProvider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId:   1,
    providerName: 'Netflix',
    type:         'flatrate',
    countryCode:  'JP',
    source:       'tmdb_watch_provider',
    ...overrides,
  };
}

// ─── validateApplyRequest ────────────────────────────────────────────────────

describe('validateApplyRequest', () => {
  const validBody = {
    confirmationText:         '統合を実行',
    expectedCanonicalWorkId:  'tmdb-movie-12345',
    expectedCandidateWorkIds: ['tmdb-movie-12345', 'csv-movie-test'],
    expectedUpdatedAt:        '2024-01-01T00:00:00.000Z',
  };

  it('nullボディ → INVALID_BODY エラー', () => {
    const result = validateApplyRequest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_BODY');
  });

  it('配列ボディ → INVALID_BODY エラー', () => {
    const result = validateApplyRequest([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_BODY');
  });

  it('confirmationText不一致 → INVALID_CONFIRMATION_TEXT', () => {
    const result = validateApplyRequest({ ...validBody, confirmationText: '統合する' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CONFIRMATION_TEXT');
  });

  it('confirmationText一致 → ok', () => {
    const result = validateApplyRequest(validBody);
    expect(result.ok).toBe(true);
  });

  it('expectedCanonicalWorkId 欠落 → MISSING_CANONICAL_WORK_ID', () => {
    const result = validateApplyRequest({ ...validBody, expectedCanonicalWorkId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_CANONICAL_WORK_ID');
  });

  it('expectedCanonicalWorkId が undefined → MISSING_CANONICAL_WORK_ID', () => {
    const body = { ...validBody };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).expectedCanonicalWorkId;
    const result = validateApplyRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_CANONICAL_WORK_ID');
  });

  it('expectedCandidateWorkIds が1件 → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: ['tmdb-movie-12345'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
  });

  it('expectedCandidateWorkIds が空配列 → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
  });

  it('expectedCandidateWorkIds に数値を含む → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: ['tmdb-movie-12345', 123] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
  });

  it('expectedUpdatedAt 欠落 → MISSING_EXPECTED_UPDATED_AT', () => {
    const result = validateApplyRequest({ ...validBody, expectedUpdatedAt: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_EXPECTED_UPDATED_AT');
  });

  it('全パラメータ正常 → ok + input が返る', () => {
    const result = validateApplyRequest(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.confirmationText).toBe('統合を実行');
      expect(result.input.expectedCanonicalWorkId).toBe('tmdb-movie-12345');
      expect(result.input.expectedCandidateWorkIds).toHaveLength(2);
      expect(result.input.expectedUpdatedAt).toBe('2024-01-01T00:00:00.000Z');
    }
  });
});

// ─── mergeVodProviders ───────────────────────────────────────────────────────

describe('mergeVodProviders', () => {
  it('重複なしの場合は両者をマージ', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe      = [makeProvider({ providerName: 'Hulu',    type: 'flatrate' })];
    const result    = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.providerName)).toContain('Netflix');
    expect(result.map((p) => p.providerName)).toContain('Hulu');
  });

  it('同じnormalizeProviderName + type の場合はcanonicalを優先（dupeを捨てる）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate', source: 'tmdb_watch_provider' })];
    const dupe      = [makeProvider({ providerName: 'Netflix Standard with Ads', type: 'flatrate', source: 'openai_supplement' })];
    const result    = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('tmdb_watch_provider');
  });

  it('hidden な providersは引き継がない（dupeのhidden行はスキップ）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe      = [makeProvider({ providerName: 'Hulu', type: 'flatrate', hidden: true })];
    const result    = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('canonical が空の場合、dupeからhiddenでないものをすべて追加', () => {
    const canonical: VodProvider[] = [];
    const dupe = [
      makeProvider({ providerName: 'Netflix', type: 'flatrate' }),
      makeProvider({ providerName: 'Hulu',    type: 'flatrate', hidden: true }),
    ];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('type が異なる場合は別エントリとして両者を保持', () => {
    const canonical = [makeProvider({ providerName: 'Amazon Prime Video', type: 'flatrate' })];
    const dupe      = [makeProvider({ providerName: 'Amazon Prime Video', type: 'rent' })];
    const result    = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(2);
  });

  it('複数dupeからのマージ（canonical + 2件のdupe）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe = [
      makeProvider({ providerName: 'Hulu',   type: 'flatrate' }),
      makeProvider({ providerName: 'U-NEXT', type: 'flatrate' }),
    ];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(3);
  });
});

// ─── buildApplyPreview ───────────────────────────────────────────────────────

describe('buildApplyPreview', () => {
  it('approved_duplicate でない（pending）場合は REVIEW_NOT_APPROVED エラー', async () => {
    mockState.selectQueue.push([makeReviewRow({ reviewStatus: 'pending', selectedCanonicalWorkId: null })]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REVIEW_NOT_APPROVED');
  });

  it('approved_duplicate でない（rejected_distinct）場合は REVIEW_NOT_APPROVED エラー', async () => {
    mockState.selectQueue.push([makeReviewRow({ reviewStatus: 'rejected_distinct', selectedCanonicalWorkId: null })]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REVIEW_NOT_APPROVED');
  });

  it('selectedCanonicalWorkId が null の場合は REVIEW_NOT_APPROVED エラー', async () => {
    mockState.selectQueue.push([makeReviewRow({ selectedCanonicalWorkId: null })]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REVIEW_NOT_APPROVED');
  });

  it('canonical が groupWorkIds に存在しない場合は CANONICAL_NOT_IN_CANDIDATES エラー', async () => {
    // review.selectedCanonicalWorkId = CANONICAL_ID だが、groupWorkIds には含まれない
    mockState.selectQueue.push([makeReviewRow()]);

    const result = await buildApplyPreview(GROUP_KEY, [DUPE_ID_1]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANONICAL_NOT_IN_CANDIDATES');
  });

  it('groupWorkIds が canonical のみの場合は NO_DUPLICATES エラー', async () => {
    mockState.selectQueue.push([makeReviewRow()]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_DUPLICATES');
  });

  it('stale グループの場合は preview.isStale が true', async () => {
    // レビューの保存時候補: [CANONICAL_ID, DUPE_ID_1]
    // 現在渡された groupWorkIds: [CANONICAL_ID, DUPE_ID_2] → 構成不一致 → stale
    mockState.selectQueue.push([makeReviewRow()]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_2, '田中太郎'),
    ]);
    mockState.selectQueue.push([]); // aliases

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_2]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.isStale).toBe(true);
  });

  it('appliedAt 設定済みなら alreadyApplied=true かつ appliedAt が返る', async () => {
    mockState.selectQueue.push([makeReviewRow({ appliedAt: new Date('2024-01-15T00:00:00.000Z') })]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_1, '田中太郎'),
    ]);
    mockState.selectQueue.push([]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.alreadyApplied).toBe(true);
      expect(result.preview.appliedAt).toBe('2024-01-15T00:00:00.000Z');
    }
  });

  it('canonical にいない人物は move、同じ人物がいる場合は remove', async () => {
    mockState.selectQueue.push([makeReviewRow()]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),   // canonical 側
      makeWorkRow(DUPE_ID_1, '山田花子'),      // dupe 側に同一 → remove
      makeWorkRow(DUPE_ID_1, '田中太郎'),      // dupe 側にのみ → move
    ]);
    mockState.selectQueue.push([]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { personLinkChanges } = result.preview;
      const removeChange = personLinkChanges.find((c) => c.personName === '山田花子');
      const moveChange   = personLinkChanges.find((c) => c.personName === '田中太郎');
      expect(removeChange?.action).toBe('remove');
      expect(moveChange?.action).toBe('move');
    }
  });

  it('VOD カウントが複数 dupe で累積される（重複プロバイダーは1件と数える）', async () => {
    // canonical: [Netflix]
    // dupe1:    [Hulu]     → +1
    // dupe2:    [Hulu, U-NEXT] → Hulu は既追加済み、U-NEXT のみ +1 → 累積 +2
    mockState.selectQueue.push([makeReviewRow({
      candidateWorkIds: [CANONICAL_ID, DUPE_ID_1, DUPE_ID_2],
    })]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子', {
        vodData: { vodProviders: [makeProvider({ providerName: 'Netflix', type: 'flatrate' })] },
      }),
      makeWorkRow(DUPE_ID_1, '田中太郎', {
        vodData: { vodProviders: [makeProvider({ providerName: 'Hulu', type: 'flatrate' })] },
      }),
      makeWorkRow(DUPE_ID_2, '佐藤次郎', {
        vodData: {
          vodProviders: [
            makeProvider({ providerName: 'Hulu',   type: 'flatrate' }),
            makeProvider({ providerName: 'U-NEXT', type: 'flatrate' }),
          ],
        },
      }),
    ]);
    mockState.selectQueue.push([]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1, DUPE_ID_2]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.vodProvidersMergedCount).toBe(2);
    }
  });

  it('preview は DB に一切書き込まない（読み取り専用）', async () => {
    mockState.selectQueue.push([makeReviewRow()]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_1, '田中太郎'),
    ]);
    mockState.selectQueue.push([]);

    await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);

    expect(mockState.insertFn).not.toHaveBeenCalled();
    expect(mockState.transactionFn).not.toHaveBeenCalled();
    expect(mockState.neonSqlFn).not.toHaveBeenCalled();
  });

  it('preview は Redis クライアントを一切呼ばない', async () => {
    mockState.selectQueue.push([makeReviewRow()]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_1, '田中太郎'),
    ]);
    mockState.selectQueue.push([]);

    await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);

    expect(mockState.redisFn).not.toHaveBeenCalled();
  });

  it('WORK_DEDUP_APPLY_ENABLED=false でも buildApplyPreview は利用可能', async () => {
    const original = process.env.WORK_DEDUP_APPLY_ENABLED;
    process.env.WORK_DEDUP_APPLY_ENABLED = 'false';

    mockState.selectQueue.push([makeReviewRow()]);
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_1, '田中太郎'),
    ]);
    mockState.selectQueue.push([]);

    const result = await buildApplyPreview(GROUP_KEY, [CANONICAL_ID, DUPE_ID_1]);
    expect(result.ok).toBe(true);

    process.env.WORK_DEDUP_APPLY_ENABLED = original;
  });
});

// ─── executeApply ────────────────────────────────────────────────────────────

describe('executeApply', () => {
  const defaultParams = {
    groupKey:          GROUP_KEY,
    canonicalWorkId:   CANONICAL_ID,
    duplicateWorkIds:  [DUPE_ID_1],
    expectedUpdatedAt: '2024-01-01T00:00:00.000Z',
    appliedBy:         'test-admin',
  };

  function setupWorkRows() {
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子', { roleName: '主人公' }),
      makeWorkRow(DUPE_ID_1, '田中太郎', { roleName: null }),
    ]);
  }

  it('transaction 成功時は success=true を返す', async () => {
    setupWorkRows();

    const result = await executeApply(defaultParams);
    expect(result.success).toBe(true);
  });

  it('transaction 失敗時（APPLY_PRECONDITION_FAILED）は success=false を返す', async () => {
    setupWorkRows();
    mockState.transactionFn.mockRejectedValueOnce(new Error('APPLY_PRECONDITION_FAILED'));

    const result = await executeApply(defaultParams);
    expect(result.success).toBe(false);
    expect(result.personLinksMoved).toBe(0);
    expect(result.aliasesCreated).toBe(0);
  });

  it('transaction 失敗時は work_merge_logs にエラーログを INSERT する', async () => {
    setupWorkRows();
    mockState.transactionFn.mockRejectedValueOnce(new Error('TX_ERROR'));

    await executeApply(defaultParams);

    expect(mockState.insertFn).toHaveBeenCalled();
    expect(mockState.insertValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorMessage: 'TX_ERROR' }),
    );
  });

  it('success 時は dupe work への status=hidden UPDATE クエリが含まれる', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    // neonSql 呼び出しのうち 'hidden' を含むものが存在すること
    const hiddenCall = mockState.neonSqlCalls.find(
      (args) => (args[0] as string[]).some((s) => s.includes("'hidden'")),
    );
    expect(hiddenCall).toBeDefined();

    // そのクエリに dupeId が補間されている
    expect((hiddenCall as unknown[]).slice(1)).toContain(DUPE_ID_1);
  });

  it('canonical work 自体は hidden/deleted にしない', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    // 'hidden' を含むクエリの補間値に canonicalId が含まれないこと
    const hiddenCalls = mockState.neonSqlCalls.filter(
      (args) => (args[0] as string[]).some((s) => s.includes("'hidden'")),
    );
    for (const call of hiddenCalls) {
      expect((call as unknown[]).slice(1)).not.toContain(CANONICAL_ID);
    }
  });

  it('success 時は work_aliases への INSERT クエリが含まれる', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    const aliasCall = mockState.neonSqlCalls.find(
      (args) => (args[0] as string[]).some((s) => s.includes('work_aliases')),
    );
    expect(aliasCall).toBeDefined();
  });

  it('success 時は work_dedup_reviews の applied_at 更新クエリが含まれる', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    const reviewUpdateCall = mockState.neonSqlCalls.find(
      (args) =>
        (args[0] as string[]).some(
          (s) => s.includes('work_dedup_reviews') && s.includes('applied_at'),
        ),
    );
    expect(reviewUpdateCall).toBeDefined();
  });

  it('success 時は work_merge_logs に成功ログを INSERT する', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    expect(mockState.insertFn).toHaveBeenCalled();
    expect(mockState.insertValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('canonical にいない人物は personLinksMoved++ / canonical にいる人物は personLinksRemoved++', async () => {
    // canonical(山田花子) / dupe(田中太郎): 別人 → move=1, remove=0
    setupWorkRows();

    const result = await executeApply(defaultParams);
    expect(result.success).toBe(true);
    expect(result.personLinksMoved).toBe(1);
    expect(result.personLinksRemoved).toBe(0);
  });

  it('同一 personName が canonical と dupe 両方に存在する場合は personLinksRemoved++', async () => {
    mockState.selectQueue.push([
      makeWorkRow(CANONICAL_ID, '山田花子'),
      makeWorkRow(DUPE_ID_1,    '山田花子'), // 同一人物
    ]);

    const result = await executeApply(defaultParams);
    expect(result.success).toBe(true);
    expect(result.personLinksMoved).toBe(0);
    expect(result.personLinksRemoved).toBe(1);
  });

  it('DO ガードブロック（precondition check）が transaction の先頭クエリに含まれる', async () => {
    setupWorkRows();

    await executeApply(defaultParams);

    // 最初の neonSql 呼び出しが DO $$ ... RAISE EXCEPTION ブロックであること
    const firstCall    = mockState.neonSqlCalls[0];
    const firstStrings = (firstCall?.[0] as string[]) ?? [];
    expect(firstStrings.some((s) => s.includes('DO'))).toBe(true);
    expect(firstStrings.some((s) => s.includes('APPLY_PRECONDITION_FAILED'))).toBe(true);
  });

  it('executeApply 自体は WORK_DEDUP_APPLY_ENABLED を参照しない（チェックはルート層の責務）', async () => {
    const original = process.env.WORK_DEDUP_APPLY_ENABLED;
    process.env.WORK_DEDUP_APPLY_ENABLED = 'false';

    setupWorkRows();
    const result = await executeApply(defaultParams);
    expect(result.success).toBe(true);

    process.env.WORK_DEDUP_APPLY_ENABLED = original;
  });
});

// ─── WORK_DEDUP_APPLY_ENABLED 環境変数の保護 ─────────────────────────────────

describe('WORK_DEDUP_APPLY_ENABLED 保護', () => {
  it('現在の環境では WORK_DEDUP_APPLY_ENABLED が "true" でない（本番データ保護）', () => {
    // apply ルートハンドラは process.env.WORK_DEDUP_APPLY_ENABLED !== 'true' で 403 を返す。
    // 実装中はこのフラグを true にしてはならない。
    expect(process.env.WORK_DEDUP_APPLY_ENABLED).not.toBe('true');
  });
});
