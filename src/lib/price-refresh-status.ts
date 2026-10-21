// 価格の分割自動更新の状況（管理画面 /admin/price-refresh 用）。読み取りのみ（DB・Redis への書き込みなし）。
//
//  - 実行の状態（Redis）：自動停止の印・実行中のロック・直近の実行の要約・人物ごとの直近の結果
//  - 価格の取得状況（DB）：公開中（判定 related）の商品について、価格の取得日時が新しい／古い／不明の件数
//  - 人物ごとの「価格を更新できていない商品」と、その理由の目安（楽天の商品を特定できるか・コード指定できるか）
// 価格の取得に失敗した商品は保存済みのデータ（価格・取得日時）を変えないため、取得日時が古い・不明のまま残る。
import { neonSql } from '@/db/client';
import { getRedis } from '@/lib/redis';
import { getAllStoredProducts, productIdentityKey, CATEGORIES } from '@/lib/product-store';
import { lookupCodeOf } from '@/lib/price-refresh';
import { HALT_KEY, LAST_RUN_KEY, LOCK_KEY, STATE_KEY, type HaltInfo, type LastRunInfo, type PersonRefreshState } from '@/lib/price-refresh-runner';
import { PRICE_FRESH_DAYS } from '@/lib/price-freshness';
import type { RakutenItem } from '@/types/rakuten';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}

export interface PriceRefreshRunStatus {
  redisAvailable: boolean;
  halt: HaltInfo | null;
  running: boolean;
  lastRun: LastRunInfo | null;
  states: Record<string, PersonRefreshState>;
}

/** 実行の状態（Redis。読み取りのみ） */
export async function getPriceRefreshRunStatus(): Promise<PriceRefreshRunStatus> {
  const redis = getRedis();
  if (!redis) return { redisAvailable: false, halt: null, running: false, lastRun: null, states: {} };
  const [halt, lock, lastRun, raw] = await Promise.all([
    redis.get(HALT_KEY),
    redis.exists(LOCK_KEY),
    redis.get(LAST_RUN_KEY),
    redis.hgetall<Record<string, unknown>>(STATE_KEY),
  ]);
  const states: Record<string, PersonRefreshState> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const s = parseJson<PersonRefreshState>(v);
    if (s) states[k] = s;
  }
  return { redisAvailable: true, halt: parseJson<HaltInfo>(halt), running: lock > 0, lastRun: parseJson<LastRunInfo>(lastRun), states };
}

export interface PersonPriceFreshness {
  personName: string;
  /** 公開中（判定 related）の商品数 */
  total: number;
  /** 価格の取得日時が PRICE_FRESH_DAYS 日以内 */
  fresh: number;
  /** 取得日時はあるが古い */
  stale: number;
  /** 取得日時が無い（価格更新で一度も取得できていない） */
  unknown: number;
}

/** 人物ごとの公開中の商品の価格の取得状況（DB 側で集計。転送は人物数×数十バイト） */
export async function getPriceFreshnessByPerson(nowMs: number = Date.now()): Promise<PersonPriceFreshness[]> {
  const cutoff = nowMs - PRICE_FRESH_DAYS * DAY_MS;
  const rows = (await neonSql`
    SELECT p.person_name,
      count(*)::int AS total,
      count(*) FILTER (WHERE jsonb_typeof(e->'priceFetchedAt') = 'number' AND (e->>'priceFetchedAt')::numeric >= ${cutoff})::int AS fresh,
      count(*) FILTER (WHERE jsonb_typeof(e->'priceFetchedAt') = 'number' AND (e->>'priceFetchedAt')::numeric < ${cutoff})::int AS stale,
      count(*) FILTER (WHERE jsonb_typeof(e->'priceFetchedAt') IS DISTINCT FROM 'number')::int AS unknown
    FROM products p
    CROSS JOIN LATERAL jsonb_array_elements(p.items) AS e
    JOIN verdicts v ON v.person_name = p.person_name AND v.product_id = e->>'id' AND v.verdict = 'related'
    GROUP BY p.person_name`) as { person_name: string; total: number; fresh: number; stale: number; unknown: number }[];
  return rows.map((r) => ({ personName: r.person_name, total: r.total, fresh: r.fresh, stale: r.stale, unknown: r.unknown }));
}

export type NotUpdatedReason = 'unidentifiable' | 'search_only' | 'lookup_possible';

export const NOT_UPDATED_REASON_LABEL: Record<NotUpdatedReason, string> = {
  unidentifiable: '楽天の商品を特定できない（商品ページURL・商品コードが無い、短縮URL等）。価格更新の対象外',
  search_only: 'カテゴリ検索の結果に出たときだけ更新（楽天市場の商品コードが保存されていないためコード指定できない）',
  lookup_possible: 'コード指定で取得できる（次回以降の実行で対象。販売終了・在庫切れなら取得できない）',
};

export interface NotUpdatedItem {
  category: string;
  id: string;
  title: string;
  price: number;
  priceFetchedAt?: number;
  reason: NotUpdatedReason;
}

/** 価格を更新できていない理由の目安（純粋関数） */
export function notUpdatedReasonOf(item: Pick<RakutenItem, 'itemUrl' | 'affiliateUrl' | 'itemCode'>): NotUpdatedReason {
  if (lookupCodeOf(item)) return 'lookup_possible';
  if (productIdentityKey(item)) return 'search_only';
  return 'unidentifiable';
}

/** 人物の公開中の商品のうち、価格の取得日時が古い・不明な商品（読み取りのみ） */
export async function getNotUpdatedItems(personName: string, nowMs: number = Date.now()): Promise<NotUpdatedItem[]> {
  const cutoff = nowMs - PRICE_FRESH_DAYS * DAY_MS;
  const [stored, related] = await Promise.all([
    getAllStoredProducts(personName),
    neonSql`SELECT product_id FROM verdicts WHERE person_name = ${personName} AND verdict = 'related'`,
  ]);
  const relatedIds = new Set((related as { product_id: string }[]).map((r) => r.product_id));
  const out: NotUpdatedItem[] = [];
  for (const category of CATEGORIES) {
    for (const item of stored[category]?.products ?? []) {
      if (!relatedIds.has(item.id)) continue;
      if (typeof item.priceFetchedAt === 'number' && item.priceFetchedAt >= cutoff) continue;
      out.push({ category, id: item.id, title: item.title, price: Number(item.price), priceFetchedAt: item.priceFetchedAt, reason: notUpdatedReasonOf(item) });
    }
  }
  return out;
}
