/**
 * 一括予約「人物固定・テンプレを変える」用の純粋関数。
 * 人物ごとに、選んだテンプレートを順番にすべて使ってから次の人物へ進む投稿キュー（A-H, A-G, A-J, B-H …）を作り、
 * 既存の allocateBulkSlots（予約済み枠のスキップを含む）で空き枠へ順番に割り当てる。
 * 日付が変わってもキューは前日の続きから進む（1日ごとに人物をリセットしない）。
 */
import { addDaysJst, allocateBulkSlots, jstWallClockToUtcDate } from './jst-time';

export type TemplatePlanRule =
  /** 自動ローテーション：選んだテンプレートを選択順に使う */
  | { method: 'rotation'; sequence: string[] }
  /** 手動（1日分）：投稿時刻ごとにテンプレートを指定する（例: 09:00→A, 15:00→B）。人物ごとに時刻順の並びを使う */
  | { method: 'manual-slot'; bySlot: Record<string, string> }
  /** 手動（1週間分）：手動で並べたテンプレート列（同じテンプレートの重複も可） */
  | { method: 'manual-sequence'; sequence: string[] };

/** 1人の人物に使うテンプレートの並び（未指定は null のまま残す＝呼び出し側でエラーにする） */
export function templateSequenceForPerson(rule: TemplatePlanRule, dailySlots: readonly string[]): (string | null)[] {
  if (rule.method === 'manual-slot') return dailySlots.map((t) => rule.bySlot[t] || null);
  return rule.sequence.map((id) => id || null);
}

export interface QueueItem {
  personName: string;
  templateId: string | null;
}

/** 投稿キュー：人物の選択順 × テンプレートの並び順（人物ごとにテンプレートをすべて使ってから次の人物へ） */
export function buildPersonTemplateQueue(personNames: readonly string[], templates: readonly (string | null)[]): QueueItem[] {
  return personNames.flatMap((personName) => templates.map((templateId) => ({ personName, templateId })));
}

export interface FixedPersonPlanItem extends QueueItem {
  dateJst: string;
  timeJst: string;
  scheduledAtIso: string;
  /** その日の何件目か（1始まり）と、その日の件数 */
  dayIndex: number;
  dayTotal: number;
  /** 「最終日の投稿数を±1件調整」で前日に寄せた投稿（通常の投稿時刻の外） */
  adjusted?: boolean;
}

export interface FixedPersonPlan {
  items: FixedPersonPlanItem[];
  /** キュー全体の件数 */
  queueLength: number;
  /** 上限（1週間分の枠数）に入りきらず予約しない件数 */
  omittedCount: number;
  /** 最終日の調整を行わなかった理由（ON で、最終日が1件だけになったのに寄せられなかったときだけ） */
  adjustSkippedReason: string | null;
}

export interface FixedPersonPlanInput {
  startDateJst: string;
  personNames: readonly string[];
  templates: readonly (string | null)[];
  dailySlots: readonly string[];
  /** 使えない枠（予約済み・過去の枠）のISO */
  skipIsos: ReadonlySet<string>;
  /** 予約する件数の上限（1週間分＝7日×1日あたり件数。通常は未指定＝キューをすべて） */
  maxCount?: number;
  /** 最終日の投稿数を±1件調整してまとめる（既定 OFF） */
  adjustLastDay?: boolean;
  /** 調整で追加する時刻が過去にならないかの判定基準 */
  now: Date;
}

/** 'HH:00' の1時間後（23:00 の次は無い） */
function nextHour(time: string): string | null {
  const h = Number(time.slice(0, 2)) + 1;
  return h <= 23 ? `${String(h).padStart(2, '0')}:00` : null;
}

/**
 * 人物固定モードの配置。キューの順番を崩さず、使えない枠は飛ばして次の空き枠へ送る（投稿内容は飛ばさない）。
 *
 * 最終日の調整（adjustLastDay）：
 * - ＋1：最終日が1件だけになり、前日が設定どおりの件数で埋まっている場合に限り、その1件を前日の最後の投稿時刻の
 *   1時間後へ寄せて、前日を「1日あたり件数＋1」件で終える。
 * - −1：最終日が「1日あたり件数−1」件になる場合は、そのまま最終日を少ない件数で終える（OFF でも同じ）。
 * - 寄せる時刻が予約済み・過去・23時より後の場合や、上限で打ち切った場合は調整しない（無理に調整しない）。
 * - 通常の日の件数は変えない。±1件を超える変更はしない。
 */
export function planFixedPersonSchedule(input: FixedPersonPlanInput): FixedPersonPlan {
  const queue = buildPersonTemplateQueue(input.personNames, input.templates);
  const count = input.maxCount !== undefined ? Math.min(queue.length, input.maxCount) : queue.length;
  const slots = count > 0 ? allocateBulkSlots(input.startDateJst, count, input.skipIsos, input.dailySlots) : [];
  const items: Omit<FixedPersonPlanItem, 'dayIndex' | 'dayTotal'>[] = slots.map((s, i) => ({
    ...queue[i],
    dateJst: s.dateJst,
    timeJst: s.timeJst,
    scheduledAtIso: s.scheduledAtIso,
  }));

  let adjustSkippedReason: string | null = null;
  const last = items.at(-1);
  const prev = items.at(-2);
  if (input.adjustLastDay && last && prev && prev.dateJst !== last.dateJst && items.filter((x) => x.dateJst === last.dateJst).length === 1) {
    const prevDayCount = items.filter((x) => x.dateJst === prev.dateJst).length;
    const extra = nextHour(prev.timeJst);
    const extraIso = extra ? jstWallClockToUtcDate(prev.dateJst, extra).toISOString() : null;
    if (count < queue.length) {
      adjustSkippedReason = '上限で打ち切っているため、最終日の調整は行いません。';
    } else if (prev.dateJst !== addDaysJst(last.dateJst, -1) || prevDayCount !== input.dailySlots.length) {
      adjustSkippedReason = '前日が設定どおりの件数で埋まっていないため、最終日の調整は行いません。';
    } else if (!extra || !extraIso) {
      adjustSkippedReason = `前日の最後の投稿（${prev.timeJst}）より後に時刻がないため、最終日の調整は行いません。`;
    } else if (input.skipIsos.has(extraIso) || new Date(extraIso).getTime() <= input.now.getTime()) {
      adjustSkippedReason = `${prev.dateJst} ${extra} が予約済み・過去の枠のため、最終日の調整は行いません。`;
    } else {
      items[items.length - 1] = { ...last, dateJst: prev.dateJst, timeJst: extra, scheduledAtIso: extraIso, adjusted: true };
    }
  }

  const dayTotals = new Map<string, number>();
  for (const x of items) dayTotals.set(x.dateJst, (dayTotals.get(x.dateJst) ?? 0) + 1);
  const seen = new Map<string, number>();
  return {
    items: items.map((x) => {
      const n = (seen.get(x.dateJst) ?? 0) + 1;
      seen.set(x.dateJst, n);
      return { ...x, dayIndex: n, dayTotal: dayTotals.get(x.dateJst)! };
    }),
    queueLength: queue.length,
    omittedCount: queue.length - count,
    adjustSkippedReason,
  };
}

/**
 * 開始日〜今日の枠のうち、現在時刻以前のもの（予約できない枠）のISO文字列。
 * 予約済み枠と同じように allocateBulkSlots へ渡してスキップさせる（人物固定モード専用。既存の配置は変えない）。
 */
export function pastSlotIsos(startDateJst: string, todayJst: string, dailySlots: readonly string[], now: Date): string[] {
  const out: string[] = [];
  for (let d = startDateJst, guard = 0; d <= todayJst && guard < 3660; d = addDaysJst(d, 1), guard++) {
    for (const t of dailySlots) {
      const at = jstWallClockToUtcDate(d, t);
      if (at.getTime() <= now.getTime()) out.push(at.toISOString());
    }
  }
  return out;
}
