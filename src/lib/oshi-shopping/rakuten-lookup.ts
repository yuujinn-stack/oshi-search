// 推し活お買い物診断の一般商品を、楽天市場商品検索API（itemCode 指定）で取得する。サーバー専用。
//
// - 商品情報はリポジトリ・DBに保存せず、表示時に取得した値を使う（楽天ウェブサービス規約 第10条1項(9)）。
//   API の呼び出しを減らすため、サーバー側のキャッシュに商品ごと最大24時間だけ保持する（公開の場所には置かない）。
//   キャッシュがあればAPIは呼ばない。
//   本番（Redis あり）は Redis（Upstash）に保存し、保存の完了を待ってから返す。Vercel では、ストリーミングで後から描画する
//   部分の unstable_cache の保存が関数の終了で失われ、毎回APIを呼んで 429 を受けていたため（2026-10-23 本番で確認）。
//   Redis が無い環境（ローカル）は従来どおり unstable_cache。
// - APIを呼ぶのはキャッシュが無い商品だけで、楽天APIの共通の「使用権」（src/lib/rakuten-api-gate.ts）を通す：
//   アプリID単位1秒1回を、自動更新・管理画面とVercelの複数インスタンスをまたいで守る。使用権が他の処理に使われていれば
//   最大3秒だけ待ち、取れなければ今回はAPIを呼ばない（キャッシュ済みの商品だけ表示）。
// - 429 は再試行せず、全経路共通の停止を記録する。401/403・認証情報なし・Vercel上でRedisなしもその表示では打ち切る。
// - 1回の表示でAPIを待つのは最大 RENDER_API_BUDGET_MS まで（超えた分は今回は表示せず、キャッシュもしない）。
// - 取得できない商品（販売終了・在庫切れ・itemCode 不一致・エラー）は null（表示しない。推測で補わない）。
// - ログにアプリID・アクセスキーを含めない（エンドポイント名と HTTP ステータスのみ）。
import { unstable_cache } from 'next/cache';
import type { GeneralItemData } from './core';
import { getRedis } from '@/lib/redis';
import {
  RakutenApiBusyError,
  RakutenApiCooldownError,
  RakutenApiLeaseLostError,
  RakutenApiUnavailableError,
  createRakutenApiSession,
  type GateDeps,
  type RakutenApiSession,
} from '@/lib/rakuten-api-gate';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const REVALIDATE_SECONDS = 60 * 60 * 24;
const RENDER_API_BUDGET_MS = 12_000;
export const OSHI_SHOPPING_GENERAL_CACHE_TAG = 'oshi-shopping-general';

/** 一般商品のキャッシュ（取得できた商品は24時間、販売終了・在庫なし等の null は6時間） */
export interface GeneralItemCache {
  /** キャッシュにある商品だけを返す（無い商品は含めない） */
  getMany(codes: readonly string[]): Promise<Map<string, GeneralItemData | null>>;
  set(code: string, item: GeneralItemData | null): Promise<void>;
}
export const GENERAL_ITEM_CACHE_PREFIX = 'oshi-shopping:general-item:v1:';
const FOUND_TTL_SECONDS = 60 * 60 * 24;
const NULL_TTL_SECONDS = 60 * 60 * 6;

/** Redis（Upstash）のキャッシュ。Redis が無ければ null */
export function createRedisGeneralItemCache(): GeneralItemCache | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async getMany(codes) {
      const out = new Map<string, GeneralItemData | null>();
      if (codes.length === 0) return out;
      const values = await redis.mget<unknown[]>(...codes.map((c) => GENERAL_ITEM_CACHE_PREFIX + c));
      values.forEach((v, i) => {
        let x: { item?: GeneralItemData | null } | null = null;
        try { x = typeof v === 'string' ? JSON.parse(v) : (v as { item?: GeneralItemData | null } | null); } catch { /* 壊れた値はキャッシュ無し扱い */ }
        if (x && 'item' in x) out.set(codes[i], x.item ?? null);
      });
      return out;
    },
    async set(code, item) {
      await redis.set(GENERAL_ITEM_CACHE_PREFIX + code, JSON.stringify({ item }), { ex: item ? FOUND_TTL_SECONDS : NULL_TTL_SECONDS });
    },
  };
}

interface IchibaApiItem {
  itemCode?: string;
  itemName?: string;
  itemPrice?: number;
  affiliateUrl?: string;
  itemUrl?: string;
  mediumImageUrls?: { imageUrl: string }[];
  shopName?: string;
  reviewCount?: number;
  availability?: number;
}

/** API のレスポンス（1件）を表示用データにする。itemCode が一致しない・必須項目が無い場合は null */
export function toGeneralItemData(requested: string, raw: IchibaApiItem | undefined, fetchedAt: number): GeneralItemData | null {
  if (!raw || (raw.itemCode ?? '').toLowerCase() !== requested.toLowerCase()) return null;
  if (raw.availability === 0) return null;
  const image = raw.mediumImageUrls?.[0]?.imageUrl ?? '';
  const affiliateUrl = raw.affiliateUrl || '';
  const price = Number(raw.itemPrice ?? 0);
  if (!raw.itemName || !image || !affiliateUrl || !(price > 0)) return null;
  return {
    itemCode: requested,
    itemName: raw.itemName,
    price,
    // 楽天の画像サーバーのURLをそのまま使う（画像は保存しない）。サイズ指定だけ大きくする
    imageUrl: image.replace(/\?_ex=\d+x\d+/, '?_ex=300x300'),
    affiliateUrl,
    shopName: raw.shopName ?? '',
    reviewCount: Number(raw.reviewCount ?? 0),
    fetchedAt,
  };
}

/** この表示での呼び出しを打ち切る理由（以降の商品はAPIを呼ばない） */
export class StopLookup extends Error {}

const GATE_ERRORS = [RakutenApiBusyError, RakutenApiCooldownError, RakutenApiLeaseLostError, RakutenApiUnavailableError];

async function fetchOne(
  itemCode: string,
  session: RakutenApiSession,
  deadline: number,
  now: () => number,
  isStopped: () => boolean,
): Promise<GeneralItemData | null> {
  const appId = (process.env.RAKUTEN_APP_ID ?? '').trim();
  const accessKey = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  const affiliateId = (process.env.RAKUTEN_AFFILIATE_ID ?? '').trim();
  if (!appId || !accessKey) {
    console.warn('[oshi-shopping] 楽天APIの認証情報が未設定のため一般商品を取得できません');
    // null を返すと「商品なし」としてキャッシュされるため、例外にしてキャッシュさせない
    throw new StopLookup('credentials missing');
  }
  if (now() > deadline) throw new StopLookup('render budget exceeded');

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://oshi-search.jp';
  const params = new URLSearchParams({ applicationId: appId, accessKey, itemCode, hits: '1', availability: '1' });
  if (affiliateId) params.set('affiliateId', affiliateId);
  let res: Response;
  try {
    // 列に並んでいる間に打ち切られた場合は送らない（送信の直前に確認する）
    res = await session.call(async () => {
      if (isStopped()) throw new StopLookup('stopped');
      return fetch(`${ENDPOINT}?${params}`, { cache: 'no-store', headers: { Origin: origin, accessKey } });
    });
  } catch (err) {
    if (err instanceof StopLookup) throw err;
    if (GATE_ERRORS.some((E) => err instanceof E)) throw new StopLookup(err instanceof Error ? err.constructor.name : 'gate');
    throw err;
  }
  if (!res.ok) {
    console.warn(`[oshi-shopping] IchibaItem/Search HTTP ${res.status}`);
    if (res.status === 429) {
      // 再試行しない。全経路共通の停止を記録する
      await session.reportRateLimited(res);
      throw new StopLookup('429');
    }
    if (res.status === 401 || res.status === 403) throw new StopLookup(String(res.status));
    // 一時的なエラーはキャッシュさせない（例外にして unstable_cache に保存させない）
    throw new Error(`rakuten ${res.status}`);
  }
  const data = (await res.json()) as { Items?: { Item: IchibaApiItem }[] };
  return toGeneralItemData(itemCode, data.Items?.[0]?.Item, Date.now());
}

/**
 * 選定リストの商品を取得する。キャッシュ済みの商品はAPIを呼ばずに返る。
 * 失敗した商品は null（他の商品の取得は続ける）。打ち切り後の商品はAPIを呼ばない。
 * gateDeps はテスト用（共通の呼び出し制御の Redis・時計の差し替え）。
 */
export async function lookupGeneralItems(
  itemCodes: readonly string[],
  gateDeps?: Partial<GateDeps>,
  /** テスト用（省略時は Redis があれば Redis、無ければ unstable_cache） */
  cacheOverride?: GeneralItemCache | null,
): Promise<{ items: Map<string, GeneralItemData | null>; failed: number }> {
  const cache = cacheOverride === undefined ? createRedisGeneralItemCache() : cacheOverride;
  if (cache) return lookupWithCache(itemCodes, cache, gateDeps);
  const now = gateDeps?.now ?? (() => Date.now());
  const deadline = now() + RENDER_API_BUDGET_MS;
  // Vercel 上では Redis が使えないとき呼ばない（安全側）。ローカルではプロセス内の間隔制御で代用
  const session = createRakutenApiSession(
    { label: 'oshi-shopping', maxWaitMs: 3_000, onUnavailable: process.env.VERCEL ? 'skip' : 'local' },
    gateDeps,
  );
  let stopped = false;
  const fetchViaSession = async (itemCode: string) => {
    if (stopped) throw new StopLookup('stopped');
    try {
      return await fetchOne(itemCode, session, deadline, now, () => stopped);
    } catch (err) {
      if (err instanceof StopLookup) stopped = true;
      throw err;
    }
  };

  try {
    const results = await Promise.allSettled(
      itemCodes.map((code) =>
        // null（販売終了・在庫なし）も確実にキャッシュされるよう、オブジェクトに包んで保存する
        unstable_cache(async () => ({ item: await fetchViaSession(code) }), ['oshi-shopping-general-item', 'v2', code], {
          revalidate: REVALIDATE_SECONDS,
          tags: [OSHI_SHOPPING_GENERAL_CACHE_TAG],
        })(),
      ),
    );
    const items = new Map<string, GeneralItemData | null>();
    let failed = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') items.set(itemCodes[i], r.value.item);
      else {
        failed++;
        items.set(itemCodes[i], null);
      }
    });
    return { items, failed };
  } finally {
    await session.close();
  }
}

/**
 * キャッシュ（Redis）を使う取得：キャッシュにある商品は API を呼ばない。無い商品だけを共通の使用権で1件ずつ順に取得する。
 * - 送信の直前にもう一度キャッシュを確かめ（同時に開かれた別の表示が先に取得・保存していれば API を呼ばない）、
 *   取得できた結果（販売終了・在庫なし等の null を含む）はすぐに保存する（保存の完了を待つ。失敗しても表示は続ける）。
 * - 429・503・通信エラー・使用権を取れない等の一時的な失敗は保存しない（次の表示で取り直す）。
 */
async function lookupWithCache(
  itemCodes: readonly string[],
  cache: GeneralItemCache,
  gateDeps?: Partial<GateDeps>,
): Promise<{ items: Map<string, GeneralItemData | null>; failed: number }> {
  let hits = new Map<string, GeneralItemData | null>();
  try {
    hits = await cache.getMany(itemCodes);
  } catch (err) {
    console.warn('[oshi-shopping] 一般商品のキャッシュを読めませんでした:', err instanceof Error ? err.name : 'error');
  }
  const items = new Map<string, GeneralItemData | null>(hits);
  const misses = itemCodes.filter((c) => !hits.has(c));
  if (misses.length === 0) return { items, failed: 0 };

  const now = gateDeps?.now ?? (() => Date.now());
  const deadline = now() + RENDER_API_BUDGET_MS;
  const session = createRakutenApiSession(
    { label: 'oshi-shopping', maxWaitMs: 3_000, onUnavailable: process.env.VERCEL ? 'skip' : 'local' },
    gateDeps,
  );
  let stopped: string | null = null;
  let failed = 0;
  let filledByOthers = 0;
  try {
    for (const code of misses) {
      if (stopped) { failed++; items.set(code, null); continue; }
      // 送信の直前の再確認（別の表示が取得・保存済みなら使う）
      const again = await cache.getMany([code]).catch(() => new Map<string, GeneralItemData | null>());
      if (again.has(code)) { items.set(code, again.get(code) ?? null); filledByOthers++; continue; }
      try {
        const item = await fetchOne(code, session, deadline, now, () => !!stopped);
        items.set(code, item);
        await cache.set(code, item).catch(() => { /* 保存できなくても表示は続ける */ });
      } catch (err) {
        if (err instanceof StopLookup) stopped = err.message;
        failed++;
        items.set(code, null);
      }
    }
    if (stopped) console.warn(`[oshi-shopping] 一般商品の取得を打ち切りました（理由: ${stopped}・未取得 ${failed}件）`);
    if (filledByOthers) console.info(`[oshi-shopping] 一般商品 ${filledByOthers}件は別の表示が取得済みのキャッシュを使いました`);
    return { items, failed };
  } finally {
    await session.close();
  }
}
