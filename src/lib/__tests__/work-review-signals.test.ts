import { describe, it, expect } from 'vitest';

// work-review-signals.ts はクライアント安全な純粋関数のみを含む（DBアクセスなし）。
// PersonWorks.tsx（'use client'）から直接importされるため、@/db/client等への依存を
// 一切持たないことがこのファイルの安全性の前提（詳細はvod-review-signals-boundary.test.ts参照）。
import { isReleaseYearTooOld, isReleaseBeforeBirthYear, TOO_OLD_THRESHOLD_YEARS } from '../work-review-signals';

describe('isReleaseYearTooOld', () => {
  it('needs_review かつ 20年以上前 → 古すぎる可能性あり', () => {
    expect(isReleaseYearTooOld(2000, 'needs_review', 2026)).toBe(true);
  });

  it('needs_review かつ ちょうど20年前（境界値） → 古すぎる可能性あり', () => {
    expect(isReleaseYearTooOld(2026 - TOO_OLD_THRESHOLD_YEARS, 'needs_review', 2026)).toBe(true);
  });

  it('needs_review かつ 19年前（境界値未満） → 対象外', () => {
    expect(isReleaseYearTooOld(2026 - TOO_OLD_THRESHOLD_YEARS + 1, 'needs_review', 2026)).toBe(false);
  });

  it('auto_published（公開中）の場合は対象外', () => {
    expect(isReleaseYearTooOld(2000, 'auto_published', 2026)).toBe(false);
  });

  it('releaseYearがnull → 対象外', () => {
    expect(isReleaseYearTooOld(null, 'needs_review', 2026)).toBe(false);
  });

  it('releaseYearがundefined → 対象外', () => {
    expect(isReleaseYearTooOld(undefined, 'needs_review', 2026)).toBe(false);
  });
});

describe('isReleaseBeforeBirthYear', () => {
  it('releaseYear < birthYear → 生年以前候補', () => {
    expect(isReleaseBeforeBirthYear(1990, 2000)).toBe(true);
  });

  it('birthYearなし → 判定なし', () => {
    expect(isReleaseBeforeBirthYear(1990, null)).toBe(false);
    expect(isReleaseBeforeBirthYear(1990, undefined)).toBe(false);
  });

  it('releaseYearなし → 判定なし', () => {
    expect(isReleaseBeforeBirthYear(null, 2000)).toBe(false);
    expect(isReleaseBeforeBirthYear(undefined, 2000)).toBe(false);
  });

  it('正常な年（releaseYear >= birthYear） → 生年以前判定なし', () => {
    expect(isReleaseBeforeBirthYear(2020, 2000)).toBe(false);
  });

  it('releaseYear === birthYear（生まれた年に出演開始）は生年以前としない', () => {
    expect(isReleaseBeforeBirthYear(2000, 2000)).toBe(false);
  });
});
