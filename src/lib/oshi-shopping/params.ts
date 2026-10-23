// 推し活お買い物診断（/oshi-shopping）の質問の選択肢と URL パラメータ。DB 非依存（'use client' からも import 可）。
//
// 結果URL: /oshi-shopping?p=<人物名>&use=<用途>&budget=<予算>
//   3つが揃い、人物が登録されている場合だけ診断結果を表示する（共有用URL）。

export const OSHI_SHOPPING_PATH = '/oshi-shopping';

export type OshiShoppingUse = 'collection' | 'live' | 'display' | 'gift';
export type OshiShoppingBudget = '1000' | '3000' | '5000' | '10000' | 'any';

export const USE_OPTIONS: readonly { value: OshiShoppingUse; label: string; description: string }[] = [
  { value: 'collection', label: '自分用に集める', description: 'CD・写真集・映像作品とグッズの収納用品' },
  { value: 'live', label: 'ライブ・遠征に持っていく', description: 'ライブ映像作品とライブ・遠征用品' },
  { value: 'display', label: '部屋に飾る', description: '写真集・アクリルグッズ等とディスプレイ用品' },
  { value: 'gift', label: 'プレゼントにする', description: 'CD・写真集・映像作品とプレゼント向け用品' },
];

export const BUDGET_OPTIONS: readonly { value: OshiShoppingBudget; label: string; max: number }[] = [
  { value: '1000', label: '1,000円まで', max: 1000 },
  { value: '3000', label: '3,000円まで', max: 3000 },
  { value: '5000', label: '5,000円まで', max: 5000 },
  { value: '10000', label: '10,000円まで', max: 10000 },
  { value: 'any', label: '上限なし', max: Number.POSITIVE_INFINITY },
];

export function budgetMax(budget: OshiShoppingBudget): number {
  return BUDGET_OPTIONS.find((b) => b.value === budget)?.max ?? Number.POSITIVE_INFINITY;
}

export function useLabel(use: OshiShoppingUse): string {
  return USE_OPTIONS.find((u) => u.value === use)?.label ?? '';
}

export function budgetLabel(budget: OshiShoppingBudget): string {
  return BUDGET_OPTIONS.find((b) => b.value === budget)?.label ?? '';
}

/** 指定した予算より1段階上の予算（無ければ null） */
export function nextBudget(budget: OshiShoppingBudget): OshiShoppingBudget | null {
  const i = BUDGET_OPTIONS.findIndex((b) => b.value === budget);
  return i >= 0 && i < BUDGET_OPTIONS.length - 1 ? BUDGET_OPTIONS[i + 1].value : null;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

export interface ParsedOshiShoppingParams {
  person: string;
  use: OshiShoppingUse | null;
  budget: OshiShoppingBudget | null;
}

export function parseOshiShoppingParams(sp: Record<string, string | string[] | undefined>): ParsedOshiShoppingParams {
  const person = first(sp.p).trim().slice(0, 100);
  const useRaw = first(sp.use);
  const budgetRaw = first(sp.budget);
  return {
    person,
    use: USE_OPTIONS.some((u) => u.value === useRaw) ? (useRaw as OshiShoppingUse) : null,
    budget: BUDGET_OPTIONS.some((b) => b.value === budgetRaw) ? (budgetRaw as OshiShoppingBudget) : null,
  };
}

/** 人物を選択済みの状態で診断を始めるURL（人物ページの導線。用途・予算は利用者が選ぶ） */
export function buildOshiShoppingStartPath(person: string): string {
  return `${OSHI_SHOPPING_PATH}?${new URLSearchParams({ p: person }).toString()}`;
}

export function buildOshiShoppingResultPath(person: string, use: OshiShoppingUse, budget: OshiShoppingBudget): string {
  const q = new URLSearchParams({ p: person, use, budget });
  return `${OSHI_SHOPPING_PATH}?${q.toString()}`;
}
