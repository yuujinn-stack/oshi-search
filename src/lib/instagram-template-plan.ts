/**
 * 一括予約「人物固定・テンプレを変える」用の純粋関数。
 * 枠の割り当て自体は既存の allocateBulkSlots（予約済み枠のスキップを含む）をそのまま使い、
 * ここでは「割り当てた各枠にどのテンプレートを使うか」だけを決める。
 */
import { addDaysJst, jstWallClockToUtcDate, type BulkSlotAssignment } from './jst-time';

export type TemplatePlanRule =
  /** 自動ローテーション：選んだテンプレートを選択順に、空き枠の順番で繰り返す */
  | { method: 'rotation'; sequence: string[] }
  /** 手動（1日分）：投稿時刻ごとにテンプレートを指定する（例: 09:00→A, 15:00→B） */
  | { method: 'manual-slot'; bySlot: Record<string, string> }
  /** 手動（1週間分）：手動で並べたテンプレート列を、空き枠の順番で繰り返す */
  | { method: 'manual-sequence'; sequence: string[] };

/** 各枠のテンプレートIDを返す（決められない枠は null） */
export function assignTemplatesToSlots(plan: readonly BulkSlotAssignment[], rule: TemplatePlanRule): (string | null)[] {
  if (rule.method === 'manual-slot') return plan.map((a) => rule.bySlot[a.timeJst] || null);
  const seq = rule.sequence.filter(Boolean);
  if (seq.length === 0) return plan.map(() => null);
  return plan.map((_, i) => seq[i % seq.length]);
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
