import { describe, it, expect, vi } from 'vitest';

// DB への接続を避けるためにモジュールをモック
vi.mock('@/db/client', () => ({
  neonSql: Object.assign(vi.fn(), { transaction: vi.fn() }),
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn() })) })),
  },
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => null),
}));

import { validateApplyRequest, mergeVodProviders } from '../work-dedup-apply';
import type { VodProvider } from '@/types/vod';

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
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_BODY');
    }
  });

  it('配列ボディ → INVALID_BODY エラー', () => {
    const result = validateApplyRequest([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_BODY');
    }
  });

  it('confirmationText不一致 → INVALID_CONFIRMATION_TEXT', () => {
    const result = validateApplyRequest({ ...validBody, confirmationText: '統合する' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CONFIRMATION_TEXT');
    }
  });

  it('confirmationText一致 → ok', () => {
    const result = validateApplyRequest(validBody);
    expect(result.ok).toBe(true);
  });

  it('expectedCanonicalWorkId 欠落 → MISSING_CANONICAL_WORK_ID', () => {
    const result = validateApplyRequest({ ...validBody, expectedCanonicalWorkId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_CANONICAL_WORK_ID');
    }
  });

  it('expectedCanonicalWorkId が undefined → MISSING_CANONICAL_WORK_ID', () => {
    const body = { ...validBody };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).expectedCanonicalWorkId;
    const result = validateApplyRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_CANONICAL_WORK_ID');
    }
  });

  it('expectedCandidateWorkIds が1件 → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: ['tmdb-movie-12345'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
    }
  });

  it('expectedCandidateWorkIds が空配列 → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
    }
  });

  it('expectedCandidateWorkIds に数値を含む → INVALID_CANDIDATE_WORK_IDS', () => {
    const result = validateApplyRequest({ ...validBody, expectedCandidateWorkIds: ['tmdb-movie-12345', 123] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CANDIDATE_WORK_IDS');
    }
  });

  it('expectedUpdatedAt 欠落 → MISSING_EXPECTED_UPDATED_AT', () => {
    const result = validateApplyRequest({ ...validBody, expectedUpdatedAt: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_EXPECTED_UPDATED_AT');
    }
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

function makeProvider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId:  1,
    providerName: 'Netflix',
    type:        'flatrate',
    countryCode: 'JP',
    source:      'tmdb_watch_provider',
    ...overrides,
  };
}

describe('mergeVodProviders', () => {
  it('重複なしの場合は両者をマージ', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe = [makeProvider({ providerName: 'Hulu', type: 'flatrate' })];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.providerName)).toContain('Netflix');
    expect(result.map((p) => p.providerName)).toContain('Hulu');
  });

  it('同じnormalizeProviderName + type の場合はcanonicalを優先（dupeを捨てる）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate', source: 'tmdb_watch_provider' })];
    const dupe = [makeProvider({ providerName: 'Netflix Standard with Ads', type: 'flatrate', source: 'openai_supplement' })];
    // Netflixは同じnormalizeProviderNameになるのでcanonicalを維持
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('tmdb_watch_provider');
  });

  it('hidden な providersは引き継がない（dupeのhidden行はスキップ）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe = [makeProvider({ providerName: 'Hulu', type: 'flatrate', hidden: true })];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('canonical が空の場合、dupeからhiddenでないものをすべて追加', () => {
    const canonical: VodProvider[] = [];
    const dupe = [
      makeProvider({ providerName: 'Netflix', type: 'flatrate' }),
      makeProvider({ providerName: 'Hulu', type: 'flatrate', hidden: true }),
    ];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('Netflix');
  });

  it('type が異なる場合は別エントリとして両者を保持', () => {
    const canonical = [makeProvider({ providerName: 'Amazon Prime Video', type: 'flatrate' })];
    const dupe = [makeProvider({ providerName: 'Amazon Prime Video', type: 'rent' })];
    const result = mergeVodProviders(canonical, dupe);
    // flatrate と rent は別 key なので両方保持
    expect(result).toHaveLength(2);
  });

  it('複数dupeからのマージ（canonical + 2件のdupe）', () => {
    const canonical = [makeProvider({ providerName: 'Netflix', type: 'flatrate' })];
    const dupe = [
      makeProvider({ providerName: 'Hulu', type: 'flatrate' }),
      makeProvider({ providerName: 'U-NEXT', type: 'flatrate' }),
    ];
    const result = mergeVodProviders(canonical, dupe);
    expect(result).toHaveLength(3);
  });
});

// ─── executeApply (requires DB) ─────────────────────────────────────────────

describe.skip('executeApply (requires DB)', () => {
  it('approved_duplicate のみ apply 可能');
  it('pending は apply 不可（ガードDOブロックでエラー）');
  it('stale は apply 不可（前提条件チェック失敗）');
  it('alreadyApplied は apply 不可（applied_at IS NULL チェック失敗）');
  it('canonical workId が候補内に存在しない場合はエラー');
  it('トランザクション失敗時はwork_merge_logsにエラーログを記録');
  it('成功時はwork_aliasesにalias行を作成');
  it('成功時はdupeWorksがstatus=hidden, deleted=trueになる');
  it('成功時はwork_dedup_reviewsのapplied_atが更新される');
});
