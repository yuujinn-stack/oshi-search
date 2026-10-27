// 楽天イベントに紐付けた商品1件の現在の情報を、楽天市場商品検索API（2026-07-01版・itemCode 指定）で確認する。サーバー専用。
//
// - 管理画面で「APIで確認」を押した商品1件だけを取得する（一括取得・定期取得はしない）。
//   楽天APIの共通の使用権（src/lib/rakuten-api-gate.ts）を通し、価格更新・新商品の取得・お買い物診断と合わせて1秒1回を守る。
//   使用権が空かなければ待たずに「混雑中」と返す（再試行しない）。429 は全経路共通の停止を記録する。
// - 取得した値は画面に表示するだけで、products（価格・商品名など）にもイベントの紐付けにも保存しない
//   （既存の価格更新の処理は変えない）。確認状態は管理者が公式ページを確認して手動で変える。
// - 取得できない・該当なしでも「対象外」とは判断しない（APIの結果が無いことは対象外の根拠にならない）。
// - API仕様（2026-07-01版）：pointRate / pointRateStartTime / pointRateEndTime は「商品別」のポイント倍付けだけで、
//   ショップ単位の倍付けや買いまわり・楽天カード等の購入者条件の特典は含まない。また24時間以内に終了する倍付けは返らない。
//   startTime / endTime はタイムセール（期間限定価格）が設定された商品だけ。クーポンの項目は無い。
// - ログ・画面にアプリID・アクセスキーを出さない。
import {
  RakutenApiBusyError, RakutenApiCooldownError, RakutenApiLeaseLostError, RakutenApiUnavailableError,
  createRakutenApiSession, type GateDeps,
} from '@/lib/rakuten-api-gate';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

export interface ItemCheckInfo {
  itemCode: string;
  itemName: string;
  itemPrice: number | null;
  /** 1=在庫あり・0=在庫なし（API の値。無ければ null） */
  availability: number | null;
  /** 商品別のポイント倍率（1 や無しは倍付けなし。24時間以内に終わる倍付けは API が返さない） */
  pointRate: number | null;
  pointRateStartTime: string | null;
  pointRateEndTime: string | null;
  /** タイムセール（期間限定価格）の期間。設定されている商品だけ */
  saleStartTime: string | null;
  saleEndTime: string | null;
  shopName: string | null;
  fetchedAt: number;
}

export type ItemCheckResult =
  | { code: 'ok'; info: ItemCheckInfo }
  | { code: 'not_found' | 'no_item_code' | 'busy' | 'cooldown' | 'rate_limited' | 'unavailable' | 'config_missing' | 'error'; httpStatus?: number };

export const ITEM_CHECK_MESSAGE: Record<Exclude<ItemCheckResult['code'], 'ok'>, string> = {
  not_found: 'APIで該当する商品が見つかりませんでした（販売終了・商品コード変更などの可能性。対象外とは判断していません）',
  no_item_code: '楽天市場の商品コード（itemCode）が無い商品のため、APIでは確認できません（楽天ブックスの商品などは商品ページで確認してください）',
  busy: '楽天APIを他の処理（価格更新など）が使用中です。少し待ってからもう一度押してください',
  cooldown: '楽天APIの利用制限のため一時停止中です。しばらく待ってからもう一度押してください',
  rate_limited: '楽天APIの利用制限（429）に達しました。しばらく待ってからもう一度押してください',
  unavailable: '楽天APIの呼び出し制御（Redis）を使えないため、APIを呼びませんでした',
  config_missing: '楽天APIの認証情報が設定されていません',
  error: '楽天APIから取得できませんでした（対象外とは判断していません）',
};

interface RawItem {
  itemCode?: string; itemName?: string; itemPrice?: number; availability?: number; shopName?: string;
  pointRate?: number; pointRateStartTime?: string; pointRateEndTime?: string; startTime?: string; endTime?: string;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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

export async function checkRakutenItem(itemCode: string | null, gateDeps?: Partial<GateDeps>, fetchImpl: typeof fetch = fetch): Promise<ItemCheckResult> {
  const code = (itemCode ?? '').trim();
  if (!code || !/^[\w.-]+:[\w.-]+$/.test(code)) return { code: 'no_item_code' };
  const appId = (process.env.RAKUTEN_APP_ID ?? '').trim();
  const accessKey = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (!appId || !accessKey) return { code: 'config_missing' };
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://oshi-search.jp';
  // availability=0：在庫切れの商品も返す（既定の1だと在庫切れが「該当なし」に見えるため）。アフィリエイトIDは付けない（表示しか使わない）
  const params = new URLSearchParams({ applicationId: appId, accessKey, itemCode: code, hits: '1', availability: '0' });
  const session = createRakutenApiSession(
    { label: 'rakuten-event-check', maxWaitMs: 3_000, onUnavailable: process.env.VERCEL ? 'skip' : 'local' },
    gateDeps,
  );
  try {
    const res = await session.call(() => fetchImpl(`${ENDPOINT}?${params}`, { cache: 'no-store', headers: { Origin: origin, accessKey } }));
    if (res.status === 429) {
      await session.reportRateLimited(res);
      return { code: 'rate_limited', httpStatus: 429 };
    }
    if (!res.ok) {
      console.warn(`[rakuten-event] IchibaItem/Search HTTP ${res.status}`);
      return { code: 'error', httpStatus: res.status };
    }
    const data = (await res.json()) as { Items?: { Item: RawItem }[] };
    const info = toItemCheckInfo(code, data.Items?.[0]?.Item, Date.now());
    return info ? { code: 'ok', info } : { code: 'not_found' };
  } catch (err) {
    if (err instanceof RakutenApiBusyError || err instanceof RakutenApiLeaseLostError) return { code: 'busy' };
    if (err instanceof RakutenApiCooldownError) return { code: 'cooldown' };
    if (err instanceof RakutenApiUnavailableError) return { code: 'unavailable' };
    console.warn('[rakuten-event] item check failed:', (err as { name?: string })?.name ?? 'Error');
    return { code: 'error' };
  } finally {
    await session.close().catch(() => {});
  }
}
