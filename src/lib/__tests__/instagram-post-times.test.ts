import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defaultPostTimes, validatePostTimes, sortPostTimes, isHourlyTime, evaluatePublishingQuota, HOURLY_TIME_OPTIONS, MAX_POSTS_PER_DAY,
} from '@/lib/instagram-post-times';
import { planFixedPersonSchedule, templateSequenceForPerson, pastSlotIsos } from '@/lib/instagram-template-plan';
import { allocateBulkSlots, jstWallClockToUtcDate, DEFAULT_DAILY_SLOTS } from '@/lib/jst-time';

const iso = (d: string, t: string) => jstWallClockToUtcDate(d, t).toISOString();

describe('1日あたり投稿数と投稿時刻', () => {
  it('1〜10件のプリセット。1〜3件は従来の 09:00 / 15:00 / 20:00 の先頭n件と同じ', () => {
    for (let n = 1; n <= MAX_POSTS_PER_DAY; n++) {
      const t = defaultPostTimes(n);
      expect(t).toHaveLength(n);
      expect(validatePostTimes(t, n)).toBeNull();
      expect(sortPostTimes(t)).toEqual(t);
    }
    expect(defaultPostTimes(1)).toEqual(DEFAULT_DAILY_SLOTS.slice(0, 1));
    expect(defaultPostTimes(2)).toEqual(DEFAULT_DAILY_SLOTS.slice(0, 2));
    expect(defaultPostTimes(3)).toEqual([...DEFAULT_DAILY_SLOTS]);
    expect(defaultPostTimes(5)).toEqual(['09:00', '12:00', '15:00', '18:00', '20:00']);
    expect(defaultPostTimes(10)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '18:00', '20:00', '21:00']);
  });
  it('選べる時刻は00:00〜23:00の1時間単位（24個）', () => {
    expect(HOURLY_TIME_OPTIONS).toHaveLength(24);
    expect(isHourlyTime('00:00') && isHourlyTime('23:00')).toBe(true);
    expect(isHourlyTime('10:30') || isHourlyTime('24:00') || isHourlyTime('9:00')).toBe(false);
  });
  it('件数と時刻数の不一致・空欄・重複・1時間単位でない時刻・件数範囲外を拒否', () => {
    expect(validatePostTimes(['09:00', '15:00', '20:00'], 4)).toMatch(/4個/);
    expect(validatePostTimes(['09:00', '', '20:00'], 3)).toMatch(/未入力/);
    expect(validatePostTimes(['09:00', '09:00', '15:00'], 3)).toMatch(/重複/);
    expect(validatePostTimes(['09:00', '10:30'], 2)).toMatch(/10:30/);
    expect(validatePostTimes([], 0)).toMatch(/1〜10件/);
    expect(validatePostTimes(defaultPostTimes(10).concat('22:00'), 11)).toMatch(/1〜10件/);
  });
  it('時刻は昇順で扱う（入力順が逆でも割り当ては早い時刻から）', () => {
    const plan = allocateBulkSlots('2026-10-01', 3, new Set(), sortPostTimes(['20:00', '09:00', '15:00']));
    expect(plan.map((a) => a.timeJst)).toEqual(['09:00', '15:00', '20:00']);
  });
});

describe('1日1/2/3/5/10件 × 人物固定（自動ローテーション・手動）・人物を変える', () => {
  for (const n of [1, 2, 3, 5, 10]) {
    it(`${n}件/日：1日分は設定した時刻どおり ${n} 枠`, () => {
      const times = defaultPostTimes(n);
      const plan = allocateBulkSlots('2026-10-01', n, new Set(), times);
      expect(plan.map((a) => a.timeJst)).toEqual(times);
      expect(plan.every((a) => a.dateJst === '2026-10-01')).toBe(true);
      const now = new Date(iso('2026-09-30', '12:00'));
      // 人物固定・自動ローテーション（テンプレ2種）：人物ごとに A,B を使ってから次の人物へ。1日目は設定した時刻どおり
      const rot = planFixedPersonSchedule({ startDateJst: '2026-10-01', personNames: ['P1', 'P2', 'P3', 'P4', 'P5'], templates: ['A', 'B'], dailySlots: times, skipIsos: new Set(), now });
      expect(rot.items.slice(0, n).map((x) => `${x.timeJst} ${x.personName}-${x.templateId}`)).toEqual(
        times.map((t, i) => `${t} P${Math.floor(i / 2) + 1}-${i % 2 === 0 ? 'A' : 'B'}`),
      );
      // 人物固定・手動（時刻ごと）：1人なら1日分の時刻どおり
      const bySlot = Object.fromEntries(times.map((t, i) => [t, `T${i}`]));
      const man = planFixedPersonSchedule({ startDateJst: '2026-10-01', personNames: ['P1'], templates: templateSequenceForPerson({ method: 'manual-slot', bySlot }, times), dailySlots: times, skipIsos: new Set(), now });
      expect(man.items.map((x) => `${x.dateJst} ${x.timeJst} ${x.templateId}`)).toEqual(times.map((t, i) => `2026-10-01 ${t} T${i}`));
    });
  }
  it('人物固定・自動ローテーション（H,作品,サブスク,出演作3選 × 1日5件・2人）は日をまたいでも続き、毎日リセットしない', () => {
    const p = planFixedPersonSchedule({
      startDateJst: '2026-10-01', personNames: ['A', 'B'], templates: ['H', '作品', 'サブスク', '出演作3選'], dailySlots: defaultPostTimes(5),
      skipIsos: new Set(), now: new Date(iso('2026-09-30', '12:00')),
    });
    expect(p.items.map((x) => `${x.dateJst} ${x.timeJst} ${x.personName}-${x.templateId}`)).toEqual([
      '2026-10-01 09:00 A-H', '2026-10-01 12:00 A-作品', '2026-10-01 15:00 A-サブスク', '2026-10-01 18:00 A-出演作3選', '2026-10-01 20:00 B-H',
      '2026-10-02 09:00 B-作品', '2026-10-02 12:00 B-サブスク', '2026-10-02 15:00 B-出演作3選',
    ]);
  });
  it('人物固定・手動（1日5件、同じテンプレを複数回）', () => {
    const bySlot = { '09:00': 'H', '12:00': '作品', '15:00': 'H', '18:00': 'サブスク', '20:00': '出演作3選' };
    expect(templateSequenceForPerson({ method: 'manual-slot', bySlot }, defaultPostTimes(5))).toEqual(['H', '作品', 'H', 'サブスク', '出演作3選']);
  });
  it('人物を変える・テンプレ固定（5人 × 1日5件）：各時刻に1人ずつ。人物より枠が多くても同じ人物は繰り返さない', () => {
    const persons = ['目黒蓮', '梅澤美波', '久保史緒里', '松本若菜', '松村沙友理'];
    const plan = allocateBulkSlots('2026-10-01', persons.length, new Set(), defaultPostTimes(5));
    expect(plan.map((a) => `${a.timeJst} ${persons[a.index]}`)).toEqual(['09:00 目黒蓮', '12:00 梅澤美波', '15:00 久保史緒里', '18:00 松本若菜', '20:00 松村沙友理']);
    // 1日10件でも人数（5）ぶんしか作らない
    expect(allocateBulkSlots('2026-10-01', persons.length, new Set(), defaultPostTimes(10))).toHaveLength(5);
  });
});

describe('1週間分（1件・3件・10件＝70件）と予約済み枠のスキップ', () => {
  it('1週間 × 1件 = 7件、× 3件 = 21件', () => {
    expect(allocateBulkSlots('2026-10-01', 7, new Set(), defaultPostTimes(1)).map((a) => a.dateJst)).toEqual(
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
    );
    expect(allocateBulkSlots('2026-10-01', 21, new Set(), defaultPostTimes(3)).at(-1)).toMatchObject({ dateJst: '2026-10-07', timeJst: '20:00' });
  });
  it('1週間 × 10件 = 70件（10/01〜10/07、各日10枠・重複なし）', () => {
    const plan = allocateBulkSlots('2026-10-01', 70, new Set(), defaultPostTimes(10));
    expect(plan).toHaveLength(70);
    expect(new Set(plan.map((a) => a.scheduledAtIso)).size).toBe(70);
    expect(plan.at(-1)).toMatchObject({ dateJst: '2026-10-07', timeJst: '21:00' });
  });
  it('途中に予約済み枠（10/01 15:00）があれば上書きせずスキップし、次の空き枠へ（ローテーション順も保つ）', () => {
    const occupied = new Set([iso('2026-10-01', '15:00')]);
    const plan = allocateBulkSlots('2026-10-01', 70, occupied, defaultPostTimes(10));
    expect(plan.some((a) => a.scheduledAtIso === iso('2026-10-01', '15:00'))).toBe(false);
    expect(plan).toHaveLength(70);
    expect(plan.at(-1)).toMatchObject({ dateJst: '2026-10-08', timeJst: '09:00' });
    // 人物固定（10人×7テンプレ＝70件）でも、予約済み枠を飛ばしてキュー順を保つ
    const p = planFixedPersonSchedule({
      startDateJst: '2026-10-01', personNames: Array.from({ length: 10 }, (_, i) => `P${i + 1}`), templates: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      dailySlots: defaultPostTimes(10), skipIsos: occupied, maxCount: 70, now: new Date(iso('2026-09-30', '12:00')),
    });
    expect(p.items).toHaveLength(70);
    expect(p.items.slice(0, 6).map((x) => `${x.timeJst} ${x.personName}-${x.templateId}`)).toEqual(
      ['09:00 P1-A', '10:00 P1-B', '11:00 P1-C', '12:00 P1-D', '13:00 P1-E', '16:00 P1-F'],
    );
  });
  it('過去の枠（今日の経過済みの時刻）は割り当てない', () => {
    const now = new Date(iso('2026-10-01', '12:30'));
    const times = defaultPostTimes(10);
    const plan = allocateBulkSlots('2026-10-01', 3, new Set(pastSlotIsos('2026-10-01', '2026-10-01', times, now)), times);
    expect(plan.map((a) => a.timeJst)).toEqual(['13:00', '15:00', '16:00']);
  });
});

describe('Instagramの投稿上限（Publishing quota）の警告', () => {
  const now = new Date(iso('2026-10-01', '08:00'));
  const plan70 = allocateBulkSlots('2026-10-01', 70, new Set(), defaultPostTimes(10)).map((a) => a.scheduledAtIso);
  it('上限100件/24時間に対して1日10件なら警告しない', () => {
    expect(evaluatePublishingQuota({ quotaUsage: 0, quotaTotal: 100 }, plan70, [], now)).toEqual([]);
  });
  it('直近の投稿済み数＋今後24時間の予約が上限の80%以上なら警告する', () => {
    expect(evaluatePublishingQuota({ quotaUsage: 75, quotaTotal: 100 }, plan70, [], now).join()).toMatch(/85件/);
  });
  it('どこかの24時間に入る投稿数が上限の80%以上なら警告する（上限が小さい場合）', () => {
    expect(evaluatePublishingQuota({ quotaUsage: 0, quotaTotal: 12 }, plan70, [], now).length).toBeGreaterThan(0);
  });
});

describe('vercel.json：Instagram自動投稿のCronは毎時0分×24本（各1日1回＝Hobbyの制限内）', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
  const ig = vercel.crons.filter((c) => c.path === '/api/cron/instagram-publish');
  it('24本・00〜23時（UTC）が1本ずつ、すべて「0 H * * *」形式（1日1回）', () => {
    expect(ig).toHaveLength(24);
    const hours = ig.map((c) => {
      const m = c.schedule.match(/^0 (\d{1,2}) \* \* \*$/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    });
    expect([...hours].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, h) => h));
  });
  it('他のCronは変更しない。Cronの合計はVercelの上限（100本）以内', () => {
    expect(vercel.crons.filter((c) => c.path !== '/api/cron/instagram-publish')).toEqual([
      { path: '/api/cron/refresh', schedule: '0 3 * * *' },
      { path: '/api/cron/vod-refresh', schedule: '0 4 * * *' },
      { path: '/api/cron/vod-recheck', schedule: '0 5 1,4,7,10,13,16,19,22,25,28 * *' },
    ]);
    expect(vercel.crons.length).toBeLessThanOrEqual(100);
  });
});
