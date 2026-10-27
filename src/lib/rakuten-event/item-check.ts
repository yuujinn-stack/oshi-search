// 楽天イベント管理で、選んだ商品の現在の情報を楽天市場商品検索API（2026-07-01版・itemCode 指定）で確認する。サーバー専用。
//
// - 管理画面で選んだ商品だけを取得する（1回の操作で最大 MAX_CHECK_PER_REQUEST 件。一斉取得・定期取得はしない）。
//   楽天APIの共通の使用権（src/lib/rakuten-api-gate.ts）を1つのセッションで通し、価格更新・新商品の取得・お買い物診断と合わせて
//   1秒1回を守る。使用権が空かなければ待たずに「混雑中」と返す。429 は全経路共通の停止を記録し、残りは呼ばない。
// - 結果は Redis（Upstash）に商品ごと最大24時間だけ保持する（src/lib/oshi-shopping/rakuten-lookup.ts と同じ考え方。
//   公開の場所には置かない・products には保存しない＝既存の価格更新の処理は変えない）。キャッシュがあればAPIは呼ばない。
//   Redis が無い環境（ローカル）ではキャッシュしない。
// - 取得できない・該当なしでも「対象外」とは判断しない。確認状態は管理者が公式ページを確認して手動で変える。
// - API仕様（2026-07-01版）：pointRate / pointRateStartTime / pointRateEndTime は「商品別」のポイント倍付けだけで、
//   ショップ単位の倍付けや買いまわり・楽天カード等の購入者条件の特典は含まない。また24時間以内に終了する倍付けは返らない。
//   startTime / endTime はタイムセール（期間限定価格）が設定された商品だけ。クーポンの項目は無い。
// - ログ・画面にアプリID・アクセスキーを出さない。
import { getRedis } from '@/lib/redis';
import {
  RakutenApiBusyError, RakutenApiCooldownError, RakutenApiLeaseLostError, RakutenApiUnavailableError,
  createRakutenApiSession, type GateDeps, type RakutenApiSession,
} from '@/lib/rakuten-api-gate';
import type { ItemCheckInfo } from './core';
import type { ApiCheckState } from './priority';

export type { ItemCheckInfo };

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
export const MAX_CHECK_PER_REQUEST = 20;

export type ItemCheckResult =
  | { code: 'ok'; info: ItemCheckInfo }
  | { code: 'not_found' | 'no_item_code' | 'busy' | 'cooldown' | 'rate_limited' | 'unavailable' | 'config_missing' | 'error' | 'skipped'; httpStatus?: number };

export const ITEM_CHECK_MESSAGE: Record<Exclude<ItemCheckResult['code'], 'ok'>, string> = {
  not_found: 'APIで該当する商品が見つかりませんでした（販売終了・商品コード変更などの可能性。対象外とは判断していません）',
  no_item_code: '楽天市場の商品コード（itemCode）が無い商品のため、APIでは確認できません（楽天ブックスの商品などは商品ページで確認してください）',
  busy: '楽天APIを他の処理（価格更新など）が使用中です。少し待ってからもう一度押してください',
  cooldown: '楽天APIの利用制限のため一時停止中です。しばらく待ってからもう一度押してください',
  rate_limited: '楽天APIの利用制限（429）に達しました。しばらく待ってからもう一度押してください',
  unavailable: '楽天APIの呼び出し制御（Redis）を使えないため、APIを呼びませんでした',
  config_missing: '楽天APIの認証情報が設定されていません',
  error: '楽天APIから取得できませんでした（対象外とは判断していません）',
  skipped: '利用制限・混雑のため今回は確認しませんでした（もう一度押すと続きから確認します）',
};

// ── キャッシュ（24時間） ─────────────────────────────────────────────────────────

export const ITEM_CHECK_CACHE_PREFIX = 'rakuten-event:item-check:v1:';
const FOUND_TTL_SECONDS = 60 * 60 * 24;
const NOT_FOUND_TTL_SECONDS = 60 * 60 * 6;

type Cached = { code: 'ok'; info: ItemCheckInfo } | { code: 'not_found'; fetchedAt: number };

export interface ItemCheckCache {
  getMany(codes: readonly string[]): Promise<Map<string, Cached>>;
  set(code: string, v: Cached): Promise<void>;
}

const cacheKey = (code: string) => ITEM_CHECK_CACHE_PREFIX + code.toLowerCase();

export function createRedisItemCheckCache(): ItemCheckCache | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async getMany(codes) {
      const out = new Map<string, Cached>();
      if (!codes.length) return out;
      const values = await redis.mget<unknown[]>(...codes.map(cacheKey));
      values.forEach((v, i) => {
        let x: Cached | null = null;
        try { x = typeof v === 'string' ? JSON.parse(v) : (v as Cached | null); } catch { /* 壊れた値はキャッシュ無し扱い */ }
        if (x && (x.code === 'ok' || x.code === 'not_found')) out.set(codes[i], x);
      });
      return out;
    },
    async set(code, v) {
      await redis.set(cacheKey(code), JSON.stringify(v), { ex: v.code === 'ok' ? FOUND_TTL_SECONDS : NOT_FOUND_TTL_SECONDS });
    },
  };
}

/** キャッシュにある確認結果（API は呼ばない）。商品コードが無ければ no_item_code、キャッシュに無ければ unchecked */
export async function cachedCheckStates(itemCodes: (string | null)[], cache: ItemCheckCache | null = createRedisItemCheckCache()): Promise<ApiCheckState[]> {
  const valid = [...new Set(itemCodes.filter((c): c is string => !!c && isItemCode(c)))];
  let map = new Map<string, Cached>();
  if (cache && valid.length) {
    try { map = await cache.getMany(valid); } catch { /* キャッシュが読めなければ未確認扱い */ }
  }
  return itemCodes.map((c) => {
    if (!c || !isItemCode(c)) return { code: 'no_item_code' };
    const v = map.get(c);
    return v ?? { code: 'unchecked' };
  });
}

// ── API ─────────────────────────────────────────────────────────────────────────

interface RawItem {
  itemCode?: string; itemName?: string; itemPrice?: number; availability?: number; shopName?: string;
  pointRate?: number; pointRateStartTime?: string; pointRateEndTime?: string; startTime?: string; endTime?: string;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const isItemCode = (code: string) => /^[\w.-]+:[\w.-]+$/.test(code.trim());

/** API の1件を表示用にする。itemCode が一致しなければ null（別の商品の情報を見せない） */
export function toItemCheckInfo(requested: string, raw: RawItem | undefined, fetchedAt: number): ItemCheckInfo | null {
  if (!raw || (raw.itemCode ?? '').toLowerCase() !== requested.toLowerCase()) return null;
  return {
    itemCode: requested,
    itemName: s(raw.itemName) ?? '',
    itemPrice: n(raw.itemPrice),
    availability: n(raw.availability),
    pointRate: n(raw.pointRate),
    pointRateStartTime: s(raw.pointRateStartTime),
    pointRateEndTime: s(raw.pointRateEndTime),
    saleStartTime: s(raw.startTime),
    saleEndTime: s(raw.endTime),
    shopName: s(raw.shopName),
    fetchedAt,
  };
}

type StopCode = Exclude<ItemCheckResult['code'], 'ok'>;
class Stop extends Error { constructor(public code: StopCode) { super(code); } }

async function fetchOne(code: string, session: RakutenApiSession, fetchImpl: typeof fetch): Promise<ItemCheckResult> {
  const appId = (process.env.RAKUTEN_APP_ID ?? '').trim();
  const accessKey = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (!appId || !accessKey) throw new Stop('config_missing');
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://oshi-search.jp';
  // availability=0：在庫切れの商品も返す（既定の1だと在庫切れが「該当なし」に見えるため）。アフィリエイトIDは付けない（表示しか使わない）
  const params = new URLSearchParams({ applicationId: appId, accessKey, itemCode: code, hits: '1', availability: '0' });
  let res: Response;
  try {
    res = await session.call(() => fetchImpl(`${ENDPOINT}?${params}`, { cache: 'no-store', headers: { Origin: origin, accessKey } }));
  } catch (err) {
    if (err instanceof RakutenApiBusyError || err instanceof RakutenApiLeaseLostError) throw new Stop('busy');
    if (err instanceof RakutenApiCooldownError) throw new Stop('cooldown');
    if (err instanceof RakutenApiUnavailableError) throw new Stop('unavailable');
    console.warn('[rakuten-event] item check failed:', (err as { name?: string })?.name ?? 'Error');
    return { code: 'error' };
  }
  if (res.status === 429) {
    await session.reportRateLimited(res);
    throw new Stop('rate_limited');
  }
  if (!res.ok) {
    console.warn(`[rakuten-event] IchibaItem/Search HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new Stop('error');
    return { code: 'error', httpStatus: res.status };
  }
  const data = (await res.json()) as { Items?: { Item: RawItem }[] };
  const info = toItemCheckInfo(code, data.Items?.[0]?.Item, Date.now());
  return info ? { code: 'ok', info } : { code: 'not_found' };
}

/**
 * 選んだ商品の情報を確認する（最大 MAX_CHECK_PER_REQUEST 件）。24時間以内のキャッシュがある商品は API を呼ばない（force でも呼ばない）。
 * 利用制限・混雑・呼び出し制御なしで止まったら、残りは skipped（呼ばない）。
 */
export async function checkRakutenItems(
  itemCodes: (string | null)[],
  opts: { gateDeps?: Partial<GateDeps>; fetchImpl?: typeof fetch; cache?: ItemCheckCache | null } = {},
): Promise<ItemCheckResult[]> {
  const list = itemCodes.slice(0, MAX_CHECK_PER_REQUEST);
  const cache = opts.cache === undefined ? createRedisItemCheckCache() : opts.cache;
  const cached = await cachedCheckStates(list, cache);
  const results: ItemCheckResult[] = cached.map((c) => (c.code === 'ok' ? c : c.code === 'not_found' ? { code: 'not_found' } : c.code === 'no_item_code' ? { code: 'no_item_code' } : { code: 'skipped' }));
  const todo = list.map((c, i) => ({ c, i })).filter(({ i }) => cached[i].code === 'unchecked');
  if (!todo.length) return results;
  const session = createRakutenApiSession(
    { label: 'rakuten-event-check', maxWaitMs: 3_000, onUnavailable: process.env.VERCEL ? 'skip' : 'local' },
    opts.gateDeps,
  );
  const fetchImpl = opts.fetchImpl ?? fetch;
  const done = new Map<string, ItemCheckResult>();
  try {
    for (const { c, i } of todo) {
      const code = c!.trim();
      const prev = done.get(code.toLowerCase());
      if (prev) { results[i] = prev; continue; }
      let r: ItemCheckResult;
      try {
        r = await fetchOne(code, session, fetchImpl);
      } catch (err) {
        if (err instanceof Stop) { results[i] = { code: err.code }; break; }
        throw err;
      }
      results[i] = r;
      done.set(code.toLowerCase(), r);
      if (cache && (r.code === 'ok' || r.code === 'not_found')) {
        await cache.set(code, r.code === 'ok' ? r : { code: 'not_found', fetchedAt: Date.now() }).catch(() => {});
      }
    }
  } finally {
    await session.close().catch(() => {});
  }
  return results;
}

/** Phase 1 互換：1件だけ確認 */
export async function checkRakutenItem(itemCode: string | null, gateDeps?: Partial<GateDeps>, fetchImpl: typeof fetch = fetch): Promise<ItemCheckResult> {
  const code = (itemCode ?? '').trim();
  if (!code || !isItemCode(code)) return { code: 'no_item_code' };
  const [r] = await checkRakutenItems([code], { gateDeps, fetchImpl, cache: null });
  return r;
}
