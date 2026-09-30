/**
 * 一括予約の「1日あたり投稿数」と「投稿時刻」、Instagramの投稿上限（Publishing quota）の判定（純粋関数・JST）。
 *
 * 自動投稿のCron（vercel.json）は、Vercel Hobbyの制約（1本あたり1日1回・実行は指定時刻から最大約59分遅れる）の範囲で
 * 毎時0分（JST 00:00〜23:00）の24本に分けている。そのため投稿時刻は1時間単位（HH:00）だけを選べるようにする。
 */

export const MAX_POSTS_PER_DAY = 10;

/** 選べる投稿時刻（JST 00:00〜23:00、1時間単位） */
export const HOURLY_TIME_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

/**
 * 投稿数ごとの初期時刻（プリセット）。1〜3件は従来の 09:00 / 15:00 / 20:00 から先頭n件と同じ
 * （＝既定の3件なら従来と同じ配置になる）。
 */
const PRESETS: Record<number, string[]> = {
  1: ['09:00'],
  2: ['09:00', '15:00'],
  3: ['09:00', '15:00', '20:00'],
  4: ['09:00', '12:00', '15:00', '20:00'],
  5: ['09:00', '12:00', '15:00', '18:00', '20:00'],
  6: ['09:00', '12:00', '15:00', '18:00', '20:00', '21:00'],
  7: ['09:00', '11:00', '13:00', '15:00', '18:00', '20:00', '21:00'],
  8: ['09:00', '10:00', '12:00', '13:00', '15:00', '18:00', '20:00', '21:00'],
  9: ['09:00', '10:00', '11:00', '12:00', '13:00', '15:00', '18:00', '20:00', '21:00'],
  10: ['09:00', '10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '18:00', '20:00', '21:00'],
};

export function defaultPostTimes(count: number): string[] {
  return [...(PRESETS[count] ?? PRESETS[3])];
}

export function isHourlyTime(t: string): boolean {
  return /^([01]\d|2[0-3]):00$/.test(t);
}

/** 投稿時刻を昇順に並べる（割り当ては常にこの順） */
export function sortPostTimes(times: readonly string[]): string[] {
  return [...times].sort();
}

/** 投稿数と投稿時刻の入力チェック。問題があれば日本語のメッセージ（問題なければ null） */
export function validatePostTimes(times: readonly string[], count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_POSTS_PER_DAY) return `1日あたり投稿数は1〜${MAX_POSTS_PER_DAY}件で選んでください。`;
  if (times.length !== count) return `投稿時刻を${count}個設定してください（現在${times.length}個）。`;
  if (times.some((t) => !t)) return '未入力の投稿時刻があります。';
  const invalid = times.find((t) => !isHourlyTime(t));
  if (invalid) return `投稿時刻「${invalid}」は選べません（00:00〜23:00の1時間単位）。`;
  const dup = times.find((t, i) => times.indexOf(t) !== i);
  if (dup) return `投稿時刻「${dup}」が重複しています。同じ時刻は1回だけ設定できます。`;
  return null;
}

// ── Instagram Publishing quota（24時間あたりの投稿上限）の警告 ──

export interface PublishingQuota {
  /** 直近24時間の投稿数 */
  quotaUsage: number;
  /** 24時間あたりの上限 */
  quotaTotal: number;
}

/** 上限に対してこの割合以上になったら警告する */
export const QUOTA_WARN_RATIO = 0.8;

/**
 * 予約しようとしている投稿（plannedIsos）と既存の予約（existingIsos）を合わせた、任意の24時間に入る最大件数と、
 * 今から24時間以内の投稿数＋直近24時間の投稿済み数をもとに、上限に近づく・超える場合の警告文を返す。
 */
export function evaluatePublishingQuota(
  quota: PublishingQuota,
  plannedIsos: readonly string[],
  existingIsos: readonly string[],
  now: Date,
): string[] {
  const DAY = 24 * 60 * 60 * 1000;
  const all = [...new Set([...plannedIsos, ...existingIsos])].map((x) => new Date(x).getTime()).filter((t) => t > now.getTime()).sort((a, b) => a - b);
  let maxIn24h = 0;
  for (let i = 0, j = 0; i < all.length; i++) {
    while (all[i] - all[j] >= DAY) j++;
    maxIn24h = Math.max(maxIn24h, i - j + 1);
  }
  const next24h = all.filter((t) => t - now.getTime() < DAY).length;
  const warnings: string[] = [];
  const limit = quota.quotaTotal;
  if (limit > 0) {
    if (quota.quotaUsage + next24h >= limit * QUOTA_WARN_RATIO) {
      warnings.push(`直近24時間の投稿済み${quota.quotaUsage}件＋今後24時間の予約${next24h}件＝${quota.quotaUsage + next24h}件で、Instagramの上限（24時間に${limit}件）に近づいています。`);
    }
    if (maxIn24h >= limit * QUOTA_WARN_RATIO) {
      warnings.push(`予約済みと今回の予約を合わせると、24時間に最大${maxIn24h}件の投稿になり、Instagramの上限（24時間に${limit}件）に近づいています。`);
    }
  }
  return warnings;
}
