// vod-refresh / vod-recheck が共有するクールダウン判定のテスト。
// 「配信情報0件の作品を、両Cronが短時間で二重にAI検索しない」ことと、
// 「vodCheckStatus='checking'のまま長時間放置された作品を再試行可能に戻す」ことを検証する。
import { describe, it, expect } from 'vitest';
import {
  isVodCheckThrottled,
  computeNextVodCheckAt,
  isStuckChecking,
  NO_RESULT_RECHECK_COOLDOWN_DAYS,
  STUCK_CHECKING_MS,
} from '../vod-check-throttle';

describe('isVodCheckThrottled', () => {
  it('nextVodCheckAtが未来なら true（直近チェック済みなので再検索しない）', () => {
    const now = 1_000_000;
    expect(isVodCheckThrottled({ nextVodCheckAt: now + 1000 }, now)).toBe(true);
  });

  it('nextVodCheckAtが過去なら false（クールダウン終了、再検索してよい）', () => {
    const now = 1_000_000;
    expect(isVodCheckThrottled({ nextVodCheckAt: now - 1000 }, now)).toBe(false);
  });

  it('nextVodCheckAtが未設定なら false（新規・未確認作品は即座に対象になる）', () => {
    expect(isVodCheckThrottled({ nextVodCheckAt: undefined }, 1_000_000)).toBe(false);
  });
});

describe('computeNextVodCheckAt', () => {
  it('配信情報が見つかった場合は undefined（スロットリング不要）', () => {
    expect(computeNextVodCheckAt(true, 1_000_000)).toBeUndefined();
  });

  it('配信情報が見つからなかった場合は NO_RESULT_RECHECK_COOLDOWN_DAYS 日後を返す', () => {
    const now = 1_000_000;
    const expected = now + NO_RESULT_RECHECK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    expect(computeNextVodCheckAt(false, now)).toBe(expected);
  });

  it('クールダウン日数は30日（既存のwork-processor.tsの基準と統一）', () => {
    expect(NO_RESULT_RECHECK_COOLDOWN_DAYS).toBe(30);
  });
});

describe('isStuckChecking', () => {
  it('checking状態でSTUCK_CHECKING_MS以上経過していれば true（放棄されたとみなす）', () => {
    const now = 10_000_000;
    const work = { vodCheckStatus: 'checking' as const, updatedAt: now - STUCK_CHECKING_MS - 1 };
    expect(isStuckChecking(work, now)).toBe(true);
  });

  it('checking状態でも閾値未満なら false（処理中の可能性があるため触らない）', () => {
    const now = 10_000_000;
    const work = { vodCheckStatus: 'checking' as const, updatedAt: now - 1000 };
    expect(isStuckChecking(work, now)).toBe(false);
  });

  it('checking以外の状態なら経過時間に関わらず false', () => {
    const now = 10_000_000;
    const work = { vodCheckStatus: 'checked' as const, updatedAt: 0 };
    expect(isStuckChecking(work, now)).toBe(false);
  });

  it('vodCheckStatus未設定でも false', () => {
    const now = 10_000_000;
    expect(isStuckChecking({ vodCheckStatus: undefined, updatedAt: 0 }, now)).toBe(false);
  });
});
