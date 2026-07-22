import { describe, it, expect } from 'vitest';
import {
  validateReviewUpdate,
  isGroupStale,
  computeReviewStats,
  isValidReviewStatus,
  REVIEW_NOTE_MAX_LENGTH,
  type ReviewStatus,
} from '../work-dedup-review';
import { makeGroupId, ALGORITHM_VERSION, GROUP_KEY_SCHEMA_VERSION } from '../work-dedup';

// ─── isValidReviewStatus ─────────────────────────────────────────────────────

describe('isValidReviewStatus', () => {
  it('pending は valid', () => expect(isValidReviewStatus('pending')).toBe(true));
  it('approved_duplicate は valid', () => expect(isValidReviewStatus('approved_duplicate')).toBe(true));
  it('rejected_distinct は valid', () => expect(isValidReviewStatus('rejected_distinct')).toBe(true));
  it('on_hold は valid', () => expect(isValidReviewStatus('on_hold')).toBe(true));
  it('approved は invalid（旧名称）', () => expect(isValidReviewStatus('approved')).toBe(false));
  it('unknown は invalid', () => expect(isValidReviewStatus('unknown')).toBe(false));
  it('null は invalid', () => expect(isValidReviewStatus(null)).toBe(false));
  it('数値は invalid', () => expect(isValidReviewStatus(1)).toBe(false));
});

// ─── validateReviewUpdate ────────────────────────────────────────────────────

const WORK_IDS = ['tmdb-tv-216223', 'csv-tv-離婚しようよ'];

describe('validateReviewUpdate', () => {
  it('null ボディは INVALID_BODY エラー', () => {
    const r = validateReviewUpdate(null, WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_BODY');
  });

  it('配列ボディは INVALID_BODY エラー', () => {
    const r = validateReviewUpdate([], WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_BODY');
  });

  it('不正な reviewStatus は INVALID_REVIEW_STATUS エラー', () => {
    const r = validateReviewUpdate({ reviewStatus: 'approved' }, WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_REVIEW_STATUS');
  });

  it('pending は canonical なしで OK', () => {
    const r = validateReviewUpdate({ reviewStatus: 'pending' }, WORK_IDS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.reviewStatus).toBe('pending');
      expect(r.input.selectedCanonicalWorkId).toBeNull();
    }
  });

  it('rejected_distinct は canonical なしで OK', () => {
    const r = validateReviewUpdate({ reviewStatus: 'rejected_distinct' }, WORK_IDS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.selectedCanonicalWorkId).toBeNull();
  });

  it('approved_duplicate で canonical 未指定は CANONICAL_REQUIRED エラー', () => {
    const r = validateReviewUpdate({ reviewStatus: 'approved_duplicate' }, WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANONICAL_REQUIRED');
  });

  it('approved_duplicate で空文字 canonical は CANONICAL_REQUIRED エラー', () => {
    const r = validateReviewUpdate({ reviewStatus: 'approved_duplicate', selectedCanonicalWorkId: '' }, WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANONICAL_REQUIRED');
  });

  it('approved_duplicate で候補外 canonical は CANONICAL_NOT_IN_CANDIDATES エラー', () => {
    const r = validateReviewUpdate(
      { reviewStatus: 'approved_duplicate', selectedCanonicalWorkId: 'tmdb-tv-99999' },
      WORK_IDS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANONICAL_NOT_IN_CANDIDATES');
  });

  it('approved_duplicate で候補内 canonical は OK', () => {
    const r = validateReviewUpdate(
      { reviewStatus: 'approved_duplicate', selectedCanonicalWorkId: 'tmdb-tv-216223' },
      WORK_IDS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.reviewStatus).toBe('approved_duplicate');
      expect(r.input.selectedCanonicalWorkId).toBe('tmdb-tv-216223');
    }
  });

  it('on_hold で canonical なしは OK', () => {
    const r = validateReviewUpdate({ reviewStatus: 'on_hold' }, WORK_IDS);
    expect(r.ok).toBe(true);
  });

  it(`note が ${REVIEW_NOTE_MAX_LENGTH} 文字超で NOTE_TOO_LONG エラー`, () => {
    const r = validateReviewUpdate(
      { reviewStatus: 'pending', reviewerNote: 'a'.repeat(REVIEW_NOTE_MAX_LENGTH + 1) },
      WORK_IDS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOTE_TOO_LONG');
  });

  it(`note が ${REVIEW_NOTE_MAX_LENGTH} 文字ちょうどは OK`, () => {
    const r = validateReviewUpdate(
      { reviewStatus: 'pending', reviewerNote: 'a'.repeat(REVIEW_NOTE_MAX_LENGTH) },
      WORK_IDS,
    );
    expect(r.ok).toBe(true);
  });

  it('note が数値型は INVALID_NOTE エラー', () => {
    const r = validateReviewUpdate({ reviewStatus: 'pending', reviewerNote: 123 }, WORK_IDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_NOTE');
  });

  it('note が空文字は null に変換される', () => {
    const r = validateReviewUpdate({ reviewStatus: 'pending', reviewerNote: '' }, WORK_IDS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.reviewerNote).toBeNull();
  });

  it('approved_duplicate + note も保存できる', () => {
    const r = validateReviewUpdate(
      {
        reviewStatus:            'approved_duplicate',
        selectedCanonicalWorkId: 'tmdb-tv-216223',
        reviewerNote:            'CSV作品とTMDb作品は同一',
      },
      WORK_IDS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.reviewStatus).toBe('approved_duplicate');
      expect(r.input.selectedCanonicalWorkId).toBe('tmdb-tv-216223');
      expect(r.input.reviewerNote).toBe('CSV作品とTMDb作品は同一');
    }
  });
});

// ─── isGroupStale ────────────────────────────────────────────────────────────

const CURRENT_ALGORITHM = 'v1';

describe('isGroupStale', () => {
  it('workId と algorithmVersion が一致 → not stale', () => {
    expect(
      isGroupStale(['a', 'b'], CURRENT_ALGORITHM, ['a', 'b']),
    ).toBe(false);
  });

  it('workId の順序が逆でも not stale（ソート比較）', () => {
    expect(
      isGroupStale(['b', 'a'], CURRENT_ALGORITHM, ['a', 'b']),
    ).toBe(false);
  });

  it('workId が変わったら stale', () => {
    expect(
      isGroupStale(['a', 'b'], CURRENT_ALGORITHM, ['a', 'c']),
    ).toBe(true);
  });

  it('workId が増えたら stale', () => {
    expect(
      isGroupStale(['a', 'b'], CURRENT_ALGORITHM, ['a', 'b', 'c']),
    ).toBe(true);
  });

  it('algorithmVersion が違ったら stale', () => {
    expect(
      isGroupStale(['a', 'b'], 'v0', ['a', 'b']),
    ).toBe(true);
  });

  it('空配列 vs 空配列 → not stale', () => {
    expect(
      isGroupStale([], CURRENT_ALGORITHM, []),
    ).toBe(false);
  });
});

// ─── computeReviewStats ──────────────────────────────────────────────────────

function makeReviewMapEntry(
  key: string,
  status: ReviewStatus,
  workIds: string[],
  algorithmVersion = CURRENT_ALGORITHM,
) {
  return [key, { reviewStatus: status, candidateWorkIds: workIds, algorithmVersion }] as const;
}

describe('computeReviewStats', () => {
  it('レビューが1件もない場合 pending = total', () => {
    const stats = computeReviewStats(5, new Map(), new Map());
    expect(stats.total).toBe(5);
    expect(stats.pending).toBe(5);
    expect(stats.approved).toBe(0);
    expect(stats.rejected).toBe(0);
    expect(stats.onHold).toBe(0);
    expect(stats.stale).toBe(0);
    expect(stats.completionRate).toBe(0);
  });

  it('承認1件、却下1件でカウントが正しい', () => {
    const reviewMap = new Map([
      makeReviewMapEntry('key1', 'approved_duplicate', ['a', 'b']),
      makeReviewMapEntry('key2', 'rejected_distinct',  ['c', 'd']),
    ]);
    const groupWorkIdsMap = new Map([
      ['key1', ['a', 'b']],
      ['key2', ['c', 'd']],
    ]);
    const stats = computeReviewStats(4, reviewMap, groupWorkIdsMap);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.onHold).toBe(0);
    expect(stats.pending).toBe(2); // 4 - 2 reviewed
    expect(stats.completionRate).toBe(50);
  });

  it('workId 変更で stale になったレビューは pending にカウントしない', () => {
    const reviewMap = new Map([
      makeReviewMapEntry('key1', 'approved_duplicate', ['a', 'b']),
    ]);
    // 現在は ['a', 'c'] → stale
    const groupWorkIdsMap = new Map([['key1', ['a', 'c']]]);
    const stats = computeReviewStats(2, reviewMap, groupWorkIdsMap);
    expect(stats.stale).toBe(1);
    expect(stats.approved).toBe(0);
    expect(stats.pending).toBe(1); // 2 - 0 reviewed - 1 stale
    expect(stats.completionRate).toBe(0);
  });

  it('completionRate は小数点を丸める', () => {
    const reviewMap = new Map([
      makeReviewMapEntry('key1', 'approved_duplicate', ['a', 'b']),
    ]);
    const groupWorkIdsMap = new Map([['key1', ['a', 'b']]]);
    const stats = computeReviewStats(3, reviewMap, groupWorkIdsMap);
    expect(stats.completionRate).toBe(33); // Math.round(1/3 * 100)
  });

  it('total=0 は completionRate=0 で割り算しない', () => {
    const stats = computeReviewStats(0, new Map(), new Map());
    expect(stats.completionRate).toBe(0);
  });
});

// ─── candidateGroupKey × algorithmVersion の独立性 ─────────────────────────

describe('candidateGroupKey × algorithmVersion の独立性', () => {
  const workIds = ['tmdb-tv-216223', 'csv-tv-離婚しようよ'];

  it('algorithmVersion が変わっても candidateGroupKey は同じ', () => {
    // makeGroupId は algorithmVersion を使わない（GROUP_KEY_SCHEMA_VERSION のみ使用）
    const key = makeGroupId(workIds);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // 同じ workIds から常に同一キーが生成される
    expect(makeGroupId(workIds)).toBe(key);
    expect(makeGroupId([...workIds].reverse())).toBe(key);
  });

  it('GROUP_KEY_SCHEMA_VERSION がハッシュに含まれる', () => {
    // gk1 プレフィックスが入っている実装であることを確認
    expect(GROUP_KEY_SCHEMA_VERSION).toBe('gk1');
    const key = makeGroupId(workIds);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // GROUP_KEY_SCHEMA_VERSION なしの素の SHA-256 とは別キーになる
    const { createHash } = require('crypto');
    const sorted = [...new Set(workIds)].sort().join('|');
    const bareKey = createHash('sha256').update(sorted).digest('hex');
    expect(key).not.toBe(bareKey);
  });

  it('algorithmVersion が違うと stale になる（キーは同じ）', () => {
    const key = makeGroupId(workIds);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // algorithmVersion='v0' で保存されたレビューは現在 v1 と異なる → stale
    expect(isGroupStale(workIds, 'v0', workIds)).toBe(true);
    // algorithmVersion が一致していれば stale でない
    expect(isGroupStale(workIds, ALGORITHM_VERSION, workIds)).toBe(false);
  });

  it('workId 構成が変わると別のキーになる', () => {
    const key1 = makeGroupId(['a', 'b']);
    const key2 = makeGroupId(['a', 'c']); // b→c で別候補
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key2).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isGroupStale: workId 順序が違っても not stale（ソート比較）', () => {
    expect(isGroupStale(['z', 'a', 'm'], CURRENT_ALGORITHM, ['a', 'm', 'z'])).toBe(false);
    expect(isGroupStale(['a', 'm', 'z'], CURRENT_ALGORITHM, ['z', 'a', 'm'])).toBe(false);
  });

  it('isGroupStale: workId 追加で stale', () => {
    expect(isGroupStale(['a', 'b'], CURRENT_ALGORITHM, ['a', 'b', 'c'])).toBe(true);
  });
});
