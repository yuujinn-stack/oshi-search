import { describe, it, expect } from 'vitest';
import { buildPersonTemplateQueue, planFixedPersonSchedule, templateSequenceForPerson, pastSlotIsos, type FixedPersonPlanInput } from '@/lib/instagram-template-plan';
import { allocateBulkSlots, jstWallClockToUtcDate, DEFAULT_DAILY_SLOTS } from '@/lib/jst-time';
import { defaultPostTimes } from '@/lib/instagram-post-times';

const iso = (d: string, t: string) => jstWallClockToUtcDate(d, t).toISOString();
const slots3 = DEFAULT_DAILY_SLOTS;
const NOW = new Date(iso('2026-09-30', '12:00'));
const HGJ = ['H', 'G', 'J'];
const persons = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

function plan(over: Partial<FixedPersonPlanInput> & Pick<FixedPersonPlanInput, 'personNames' | 'templates' | 'dailySlots'>) {
  return planFixedPersonSchedule({ startDateJst: '2026-10-01', skipIsos: new Set(), now: NOW, ...over });
}
/** 日付ごとに「人物-テンプレ」を並べる */
function byDay(items: ReturnType<typeof plan>['items']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const x of items) (out[x.dateJst] ??= []).push(`${x.personName}-${x.templateId}`);
  return out;
}
const dayCounts = (items: ReturnType<typeof plan>['items']) => Object.values(byDay(items)).map((d) => d.length);

describe('投稿キュー：人物ごとに選んだテンプレをすべて使ってから次の人物へ', () => {
  it('A,B,C × H,G,J → A-H, A-G, A-J, B-H, B-G, B-J, C-H, C-G, C-J', () => {
    expect(buildPersonTemplateQueue(['A', 'B', 'C'], HGJ).map((q) => `${q.personName}-${q.templateId}`)).toEqual(
      ['A-H', 'A-G', 'A-J', 'B-H', 'B-G', 'B-J', 'C-H', 'C-G', 'C-J'],
    );
  });
  it('テンプレの並び：自動ローテーション・手動（1週間）は並べた順、手動（1日分）は投稿時刻の順', () => {
    expect(templateSequenceForPerson({ method: 'rotation', sequence: ['J', 'H', 'G'] }, slots3)).toEqual(['J', 'H', 'G']);
    expect(templateSequenceForPerson({ method: 'manual-sequence', sequence: ['H', 'G', 'H'] }, slots3)).toEqual(['H', 'G', 'H']);
    expect(templateSequenceForPerson({ method: 'manual-slot', bySlot: { '20:00': 'J', '09:00': 'H', '15:00': 'G' } }, slots3)).toEqual(['H', 'G', 'J']);
    expect(templateSequenceForPerson({ method: 'manual-slot', bySlot: { '09:00': 'H' } }, slots3)).toEqual(['H', null, null]);
  });
});

describe('日付・時刻への割り当て（日をまたいでもキューの続きから）', () => {
  it('ケース1：1日5件・3人・H,G,J → 1日目 A-H,A-G,A-J,B-H,B-G / 2日目 B-J,C-H,C-G,C-J', () => {
    const p = plan({ personNames: ['A', 'B', 'C'], templates: HGJ, dailySlots: defaultPostTimes(5) });
    expect(byDay(p.items)).toEqual({
      '2026-10-01': ['A-H', 'A-G', 'A-J', 'B-H', 'B-G'],
      '2026-10-02': ['B-J', 'C-H', 'C-G', 'C-J'],
    });
    expect(p.items.map((x) => `${x.timeJst} ${x.dayIndex}/${x.dayTotal}`)).toEqual([
      '09:00 1/5', '12:00 2/5', '15:00 3/5', '18:00 4/5', '20:00 5/5', '09:00 1/4', '12:00 2/4', '15:00 3/4', '18:00 4/4',
    ]);
  });
  it('ケース1（4人）：2日目の最後は次の人物の H から続く（1日ごとに人物をリセットしない）', () => {
    const p = plan({ personNames: ['A', 'B', 'C', 'D'], templates: HGJ, dailySlots: defaultPostTimes(5) });
    expect(byDay(p.items)).toEqual({
      '2026-10-01': ['A-H', 'A-G', 'A-J', 'B-H', 'B-G'],
      '2026-10-02': ['B-J', 'C-H', 'C-G', 'C-J', 'D-H'],
      '2026-10-03': ['D-G', 'D-J'],
    });
  });
  it('ケース2：1日3件・2人・H,G,J → 1日目 A-H,A-G,A-J / 2日目 B-H,B-G,B-J', () => {
    const p = plan({ personNames: ['A', 'B'], templates: HGJ, dailySlots: slots3 });
    expect(byDay(p.items)).toEqual({ '2026-10-01': ['A-H', 'A-G', 'A-J'], '2026-10-02': ['B-H', 'B-G', 'B-J'] });
  });
  it('ケース3：1日10件・4人・H,G,J（12件）→ 1日目10件、2日目は D-G, D-J', () => {
    const p = plan({ personNames: ['A', 'B', 'C', 'D'], templates: HGJ, dailySlots: defaultPostTimes(10) });
    expect(byDay(p.items)).toEqual({
      '2026-10-01': ['A-H', 'A-G', 'A-J', 'B-H', 'B-G', 'B-J', 'C-H', 'C-G', 'C-J', 'D-H'],
      '2026-10-02': ['D-G', 'D-J'],
    });
    expect(p.items.map((x) => x.timeJst).slice(0, 10)).toEqual(defaultPostTimes(10));
  });
  it('ケース4：途中の時刻が予約済み・過去なら、投稿内容は飛ばさずに次の空き時刻へずらす', () => {
    const skip = new Set([iso('2026-10-01', '12:00'), iso('2026-10-01', '18:00'), iso('2026-10-02', '09:00')]);
    const p = plan({ personNames: ['A', 'B'], templates: HGJ, dailySlots: defaultPostTimes(5), skipIsos: skip });
    expect(p.items.map((x) => `${x.dateJst} ${x.timeJst} ${x.personName}-${x.templateId}`)).toEqual([
      '2026-10-01 09:00 A-H', '2026-10-01 15:00 A-G', '2026-10-01 20:00 A-J',
      '2026-10-02 12:00 B-H', '2026-10-02 15:00 B-G', '2026-10-02 18:00 B-J',
    ]);
    expect(p.items.some((x) => skip.has(x.scheduledAtIso))).toBe(false);
  });
  it('ケース5：1週間（1日5件×7日＝35枠）。キューが39件なら35件だけ、4件は予約しない', () => {
    const p = plan({ personNames: persons(13), templates: HGJ, dailySlots: defaultPostTimes(5), maxCount: 35 });
    expect(p.items).toHaveLength(35);
    expect(p).toMatchObject({ queueLength: 39, omittedCount: 4 });
    expect(p.items.at(-1)).toMatchObject({ dateJst: '2026-10-07', timeJst: '20:00', personName: 'P12', templateId: 'G' });
    expect(dayCounts(p.items)).toEqual([5, 5, 5, 5, 5, 5, 5]);
  });
  it('ケース5：1週間でもキューが35件未満なら必要な件数だけ（3人×3＝9件）', () => {
    const p = plan({ personNames: ['A', 'B', 'C'], templates: HGJ, dailySlots: defaultPostTimes(5), maxCount: 35 });
    expect(p.items).toHaveLength(9);
    expect(p.omittedCount).toBe(0);
  });
  it('1人でも同じルール（人物1人×テンプレ3個＝3件。テンプレを繰り返さない）', () => {
    const p = plan({ personNames: ['A'], templates: HGJ, dailySlots: defaultPostTimes(5) });
    expect(p.items.map((x) => `${x.timeJst} ${x.templateId}`)).toEqual(['09:00 H', '12:00 G', '15:00 J']);
  });
  it('手動（1日分）：人物ごとに時刻順の並びを使う。予約済み枠が無ければ各人物が1日分の時刻どおり', () => {
    const templates = templateSequenceForPerson({ method: 'manual-slot', bySlot: { '09:00': 'H', '15:00': 'G', '20:00': 'J' } }, slots3);
    const p = plan({ personNames: ['A', 'B'], templates, dailySlots: slots3 });
    expect(p.items.map((x) => `${x.dateJst} ${x.timeJst} ${x.personName}-${x.templateId}`)).toEqual([
      '2026-10-01 09:00 A-H', '2026-10-01 15:00 A-G', '2026-10-01 20:00 A-J',
      '2026-10-02 09:00 B-H', '2026-10-02 15:00 B-G', '2026-10-02 20:00 B-J',
    ]);
  });
  it('人物・テンプレが空なら0件', () => {
    expect(plan({ personNames: [], templates: HGJ, dailySlots: slots3 }).items).toEqual([]);
    expect(plan({ personNames: ['A'], templates: [], dailySlots: slots3 }).items).toEqual([]);
  });
});

describe('最終日の投稿数を±1件調整してまとめる', () => {
  it('ケース6：OFF（既定）→ 1日あたり件数を厳守（最後に6件残る → 5件・1件）', () => {
    const p = plan({ personNames: persons(11), templates: ['H'], dailySlots: defaultPostTimes(5) });
    expect(dayCounts(p.items)).toEqual([5, 5, 1]);
    expect(p.items.some((x) => x.adjusted)).toBe(false);
    expect(p.adjustSkippedReason).toBeNull();
  });
  it('ケース7：ON → 最後に6件残るなら最終日に6件投稿して終了（追加は前日最後の投稿の1時間後）', () => {
    const p = plan({ personNames: persons(11), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([5, 6]);
    expect(p.items.at(-1)).toMatchObject({ dateJst: '2026-10-02', timeJst: '21:00', personName: 'P11', adjusted: true, dayIndex: 6, dayTotal: 6 });
    expect(p.adjustSkippedReason).toBeNull();
  });
  it('ケース7：ON → 最後に4件残るなら最終日は4件で終了（OFF と同じ。勝手に増やさない）', () => {
    const p = plan({ personNames: ['A', 'B', 'C'], templates: HGJ, dailySlots: defaultPostTimes(5), adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([5, 4]);
    expect(p.items.some((x) => x.adjusted)).toBe(false);
  });
  it('ケース7：ON でも通常の日は増やさない（16件 → 5・5・6）', () => {
    const p = plan({ personNames: persons(16), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([5, 5, 6]);
  });
  it('ケース7：ON でも、寄せる時刻が予約済みなら調整しない（理由を返す）', () => {
    const p = plan({ personNames: persons(11), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true, skipIsos: new Set([iso('2026-10-02', '21:00')]) });
    expect(dayCounts(p.items)).toEqual([5, 5, 1]);
    expect(p.adjustSkippedReason).toMatch(/予約済み/);
  });
  it('ケース7：ON でも、前日の最後が23:00なら調整しない', () => {
    const p = plan({ personNames: persons(4), templates: ['H'], dailySlots: ['21:00', '22:00', '23:00'], adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([3, 1]);
    expect(p.adjustSkippedReason).toMatch(/23:00/);
  });
  it('ケース7：ON でも、前日が設定件数で埋まっていない（予約済み枠あり）なら調整しない', () => {
    const p = plan({ personNames: persons(5), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true, skipIsos: new Set([iso('2026-10-01', '12:00')]) });
    // 1日目は4件（12:00が予約済み）、2日目1件
    expect(dayCounts(p.items)).toEqual([4, 1]);
    expect(p.items.some((x) => x.adjusted)).toBe(false);
    expect(p.adjustSkippedReason).toMatch(/埋まっていない/);
  });
  it('ケース7：ON でも、1週間の上限で打ち切った場合は調整しない（36件目を入れない）', () => {
    const p = plan({ personNames: persons(36), templates: ['H'], dailySlots: defaultPostTimes(5), maxCount: 35, adjustLastDay: true });
    expect(p.items).toHaveLength(35);
    expect(p.omittedCount).toBe(1);
    expect(p.items.some((x) => x.adjusted)).toBe(false);
  });
  it('ケース7：1週間で31件（最終日=7日目が1件）なら6日目に寄せて終了', () => {
    const p = plan({ personNames: persons(31), templates: ['H'], dailySlots: defaultPostTimes(5), maxCount: 35, adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([5, 5, 5, 5, 5, 6]);
  });
  it('ケース7：ON の調整で追加する時刻が過去なら調整しない', () => {
    const now = new Date(iso('2026-10-01', '21:30'));
    const p = plan({ personNames: persons(6), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true, now });
    expect(p.items.some((x) => x.adjusted)).toBe(false);
    expect(p.adjustSkippedReason).toMatch(/過去/);
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
    const p = allocateBulkSlots('2026-09-30', 2, skip, slots3);
    expect(p.map((a) => `${a.dateJst} ${a.timeJst}`)).toEqual(['2026-10-01 09:00', '2026-10-01 15:00']);
  });
});

describe('必要日数の自動計算（総投稿数＝人物数×テンプレ数、日数＝総投稿数÷1日あたり件数の切り上げ）', () => {
  const sum = (over: Partial<FixedPersonPlanInput> & Pick<FixedPersonPlanInput, 'personNames' | 'templates' | 'dailySlots'>) => plan(over).summary;
  it('ケース1：3人×3テンプレ・1日5件 → 9投稿・2日（10/01〜10/02）', () => {
    expect(sum({ personNames: persons(3), templates: HGJ, dailySlots: defaultPostTimes(5) })).toMatchObject({
      totalPosts: 9, scheduledCount: 9, omittedCount: 0, perDay: 5, baseDays: 2, days: 2, startDateJst: '2026-10-01', endDateJst: '2026-10-02', dayDiff: 0,
    });
  });
  it('ケース2：6人×3テンプレ・1日5件 → 18投稿・4日（10/01〜10/04）', () => {
    expect(sum({ personNames: persons(6), templates: HGJ, dailySlots: defaultPostTimes(5) })).toMatchObject({ totalPosts: 18, baseDays: 4, days: 4, endDateJst: '2026-10-04' });
  });
  it('ケース3：10人×3テンプレ・1日10件 → 30投稿・3日', () => {
    expect(sum({ personNames: persons(10), templates: HGJ, dailySlots: defaultPostTimes(10) })).toMatchObject({ totalPosts: 30, baseDays: 3, days: 3 });
  });
  it('ケース4：33人×3テンプレ・1日5件 → 99投稿・20日（全件を予約）', () => {
    expect(sum({ personNames: persons(33), templates: HGJ, dailySlots: defaultPostTimes(5) })).toMatchObject({
      totalPosts: 99, scheduledCount: 99, omittedCount: 0, baseDays: 20, days: 20, endDateJst: '2026-10-20',
    });
  });
  it('ケース5：同じく「最大7日分まで予約」ON → 予約予定35件・未予約64件・7日', () => {
    expect(sum({ personNames: persons(33), templates: HGJ, dailySlots: defaultPostTimes(5), maxCount: 7 * 5 })).toMatchObject({
      totalPosts: 99, scheduledCount: 35, omittedCount: 64, baseDays: 7, days: 7, endDateJst: '2026-10-07',
    });
  });
  it('ケース6：途中の予約済み枠で4日以内に18枠取れない（20枠−3枠＝17枠）→ 投稿は飛ばさず、実際は5日（1日延長）', () => {
    const skip = new Set([iso('2026-10-02', '12:00'), iso('2026-10-03', '18:00'), iso('2026-10-04', '09:00')]);
    const p = plan({ personNames: persons(6), templates: HGJ, dailySlots: defaultPostTimes(5), skipIsos: skip });
    expect(p.summary).toMatchObject({ totalPosts: 18, scheduledCount: 18, baseDays: 4, days: 5, endDateJst: '2026-10-05', dayDiff: 1 });
    expect(p.items.map((x) => `${x.personName}-${x.templateId}`)).toEqual(buildPersonTemplateQueue(persons(6), HGJ).map((q) => `${q.personName}-${q.templateId}`));
    expect(p.items.at(-1)).toMatchObject({ dateJst: '2026-10-05', dayNumber: 5 });
  });
  it('ケース6：予約済みが2枠だけなら4日（20枠）に収まり延長なし', () => {
    const skip = new Set([iso('2026-10-02', '12:00'), iso('2026-10-03', '18:00')]);
    expect(plan({ personNames: persons(6), templates: HGJ, dailySlots: defaultPostTimes(5), skipIsos: skip }).summary).toMatchObject({ baseDays: 4, days: 4, dayDiff: 0 });
  });
  it('ケース6：1日まるごと予約済みの日があっても通し日数で数える（その日は投稿0件）', () => {
    const skip = new Set(defaultPostTimes(5).map((t) => iso('2026-10-02', t)));
    const p = plan({ personNames: persons(3), templates: HGJ, dailySlots: defaultPostTimes(5), skipIsos: skip });
    expect(p.summary).toMatchObject({ baseDays: 2, days: 3, startDateJst: '2026-10-01', endDateJst: '2026-10-03', dayDiff: 1 });
    expect(p.items.filter((x) => x.dateJst === '2026-10-03').every((x) => x.dayNumber === 3)).toBe(true);
  });
  it('ケース7：11投稿・1日5件・最終日±1 OFF → 5/5/1・3日', () => {
    const p = plan({ personNames: persons(11), templates: ['H'], dailySlots: defaultPostTimes(5) });
    expect(dayCounts(p.items)).toEqual([5, 5, 1]);
    expect(p.summary).toMatchObject({ totalPosts: 11, baseDays: 3, days: 3, dayDiff: 0, adjusted: false });
  });
  it('ケース8：11投稿・1日5件・最終日±1 ON → 5/6・2日（計算上3日から1日短縮）', () => {
    const p = plan({ personNames: persons(11), templates: ['H'], dailySlots: defaultPostTimes(5), adjustLastDay: true });
    expect(dayCounts(p.items)).toEqual([5, 6]);
    expect(p.summary).toMatchObject({ totalPosts: 11, baseDays: 3, days: 2, dayDiff: -1, adjusted: true, endDateJst: '2026-10-02' });
  });
  it('ケース11：テンプレ4種類 → 人数×4で計算（5人×4＝20投稿・1日5件で4日）', () => {
    const p = plan({ personNames: persons(5), templates: ['H', 'G', 'J', 'K'], dailySlots: defaultPostTimes(5) });
    expect(p.summary).toMatchObject({ totalPosts: 20, baseDays: 4, days: 4 });
    expect(p.items.slice(0, 5).map((x) => `${x.personName}-${x.templateId}`)).toEqual(['P1-H', 'P1-G', 'P1-J', 'P1-K', 'P2-H']);
  });
  it('人物・テンプレが0なら 0投稿・0日', () => {
    expect(sum({ personNames: [], templates: HGJ, dailySlots: slots3 })).toMatchObject({ totalPosts: 0, scheduledCount: 0, days: 0, startDateJst: null, endDateJst: null });
  });
});
