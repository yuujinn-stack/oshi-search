import { describe, it, expect } from 'vitest';
import { assignTemplatesToSlots, pastSlotIsos } from '@/lib/instagram-template-plan';
import { allocateBulkSlots, jstWallClockToUtcDate, DEFAULT_DAILY_SLOTS } from '@/lib/jst-time';

const iso = (d: string, t: string) => jstWallClockToUtcDate(d, t).toISOString();
const slots3 = DEFAULT_DAILY_SLOTS;

describe('人物固定・テンプレを変える：テンプレートの割り当て', () => {
  it('自動ローテーション A,B,C × 1日3投稿 → 09:00 A / 15:00 B / 20:00 C', () => {
    const plan = allocateBulkSlots('2026-10-01', 3, new Set(), slots3);
    expect(assignTemplatesToSlots(plan, { method: 'rotation', sequence: ['A', 'B', 'C'] })).toEqual(['A', 'B', 'C']);
  });
  it('自動ローテーション A,B × 1日3投稿 → A, B, A（翌日は B から続く）', () => {
    const plan = allocateBulkSlots('2026-10-01', 6, new Set(), slots3);
    expect(assignTemplatesToSlots(plan, { method: 'rotation', sequence: ['A', 'B'] })).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
  });
  it('1週間分 A,B,C：毎日 09:00 A / 15:00 B / 20:00 C を繰り返す（21枠）', () => {
    const plan = allocateBulkSlots('2026-10-01', 21, new Set(), slots3);
    const t = assignTemplatesToSlots(plan, { method: 'rotation', sequence: ['A', 'B', 'C'] });
    expect(plan[20].dateJst).toBe('2026-10-07');
    expect(t.filter((_, i) => plan[i].timeJst === '09:00').every((x) => x === 'A')).toBe(true);
    expect(t.filter((_, i) => plan[i].timeJst === '20:00').every((x) => x === 'C')).toBe(true);
  });
  it('予約済みの枠はスキップし、次の空き枠でローテーション順を保つ', () => {
    const occupied = new Set([iso('2026-10-01', '15:00')]);
    const plan = allocateBulkSlots('2026-10-01', 3, occupied, slots3);
    expect(plan.map((a) => `${a.dateJst} ${a.timeJst}`)).toEqual(['2026-10-01 09:00', '2026-10-01 20:00', '2026-10-02 09:00']);
    expect(assignTemplatesToSlots(plan, { method: 'rotation', sequence: ['A', 'B', 'C'] })).toEqual(['A', 'B', 'C']);
  });
  it('手動（1日分）：投稿時刻ごとの指定。未指定の枠は null', () => {
    const plan = allocateBulkSlots('2026-10-01', 2, new Set(), ['09:00', '15:00']);
    expect(assignTemplatesToSlots(plan, { method: 'manual-slot', bySlot: { '09:00': 'A', '15:00': 'D' } })).toEqual(['A', 'D']);
    expect(assignTemplatesToSlots(plan, { method: 'manual-slot', bySlot: { '09:00': 'A' } })).toEqual(['A', null]);
  });
  it('手動（1週間分）：並べた列 A,C,H,B を空き枠順に繰り返す（重複指定も可）', () => {
    const plan = allocateBulkSlots('2026-10-01', 6, new Set(), slots3);
    expect(assignTemplatesToSlots(plan, { method: 'manual-sequence', sequence: ['A', 'C', 'H', 'B'] })).toEqual(['A', 'C', 'H', 'B', 'A', 'C']);
  });
  it('テンプレートが1つも無ければ全枠 null（予約させない）', () => {
    const plan = allocateBulkSlots('2026-10-01', 2, new Set(), slots3);
    expect(assignTemplatesToSlots(plan, { method: 'rotation', sequence: [] })).toEqual([null, null]);
  });
});

describe('人物固定・テンプレを変える：過去の枠を除外', () => {
  it('今日の経過済みの枠だけを返す（未来の枠・前日以前の指定なし日は含まない）', () => {
    const now = new Date(iso('2026-09-30', '16:00'));
    expect(pastSlotIsos('2026-09-30', '2026-09-30', slots3, now)).toEqual([iso('2026-09-30', '09:00'), iso('2026-09-30', '15:00')]);
  });
  it('開始日が未来なら空', () => {
    expect(pastSlotIsos('2026-10-01', '2026-09-30', slots3, new Date(iso('2026-09-30', '16:00')))).toEqual([]);
  });
  it('allocateBulkSlots に渡すと、過去の枠を飛ばして未来の空き枠から割り当てる', () => {
    const now = new Date(iso('2026-09-30', '16:00'));
    const skip = new Set([...pastSlotIsos('2026-09-30', '2026-09-30', slots3, now), iso('2026-09-30', '20:00')]);
    const plan = allocateBulkSlots('2026-09-30', 2, skip, slots3);
    expect(plan.map((a) => `${a.dateJst} ${a.timeJst}`)).toEqual(['2026-10-01 09:00', '2026-10-01 15:00']);
  });
});
