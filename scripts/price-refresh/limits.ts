// 価格更新の1回の上限と、人物ごとの最短更新間隔を環境変数から決める（純粋関数。scripts/price-refresh/run.ts から使う）。
//
//   PRICE_REFRESH_MAX_PERSONS        … 1回に処理する人物の上限（既定 30）
//   PRICE_REFRESH_MAX_API_CALLS      … 1回に使う楽天APIの回数の上限（既定 400。800 を超える値は 800 にする）
//   PRICE_REFRESH_MAX_CATEGORIES     … 1回に楽天を検索するカテゴリ数の上限（既定 200）
//   PRICE_REFRESH_MIN_INTERVAL_DAYS  … 人物ごとの最短更新間隔（日。既定 3。1〜14）
//   PRICE_REFRESH_LIMITED=1          … 少人数の通常実行（limited-full）：人物 10人・楽天API 400回を超えない
//
// 楽天APIの 429 が出ている間は 800 回へ引き上げない運用（docs/price-refresh-runbook.md）。800 を超える値はコードの変更が必要。
export const DEFAULT_MAX_API_CALLS = 400;
export const HARD_MAX_API_CALLS = 800;
export const LIMITED_MAX_PERSONS = 10;
export const LIMITED_MAX_API_CALLS = 400;
export const DEFAULT_MIN_INTERVAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunLimits {
  maxPersons: number;
  maxApiCalls: number;
  maxCategories: number;
  minIntervalDays: number;
  minIntervalMs: number;
  limited: boolean;
}

type Env = Record<string, string | undefined>;

function intEnv(env: Env, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), min), max) : def;
}

export function resolveRunLimits(env: Env): RunLimits {
  const limited = env.PRICE_REFRESH_LIMITED === '1';
  const minIntervalDays = intEnv(env, 'PRICE_REFRESH_MIN_INTERVAL_DAYS', DEFAULT_MIN_INTERVAL_DAYS, 1, 14);
  return {
    maxPersons: intEnv(env, 'PRICE_REFRESH_MAX_PERSONS', limited ? 3 : 30, 1, limited ? LIMITED_MAX_PERSONS : 400),
    maxApiCalls: intEnv(env, 'PRICE_REFRESH_MAX_API_CALLS', DEFAULT_MAX_API_CALLS, 20, limited ? LIMITED_MAX_API_CALLS : HARD_MAX_API_CALLS),
    maxCategories: intEnv(env, 'PRICE_REFRESH_MAX_CATEGORIES', 200, 1, 2000),
    minIntervalDays,
    minIntervalMs: minIntervalDays * DAY_MS,
    limited,
  };
}
