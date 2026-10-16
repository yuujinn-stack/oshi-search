// 楽天市場の商品ID（純粋関数・DB非依存）。Phase 4（docs/development-log.md Task 95）参照。
//
// 旧ID `ic-<アフィリエイトURLの識別部分24文字>` は店舗単位の値で、同じ店舗の別商品が同じIDになっていた。
// 新ID `ich-<店舗コード>:<商品コード>` は楽天市場APIの公式識別子 itemCode（店舗コード:商品コード）から作る。
// - itemCode が無い／形式が不正／商品URLの店舗と一致しない商品は、推測でIDを作らない（null）。
// - 同じ商品は同じID（大文字小文字・URLの表記ゆれは無関係。itemCode だけで決まる）。同じ店舗の別商品は別ID。
// - 楽天ブックス系（bk-/cd-/dv-）と手動登録（mn-）のIDは変更しない。
// - 移行前の既存データ（itemCode を保存していない）向けには、保存済みの遷移先URLから同じ形式のIDを作る関数を別に用意する
//   （移行シミュレーション・移行スクリプト専用。取得時には使わない）。
import { parseAffiliateUrl, productKeyFromPageUrl } from '@/lib/rakuten-affiliate-link';

export const LEGACY_ICHIBA_ID_PREFIX = 'ic-';
export const ICHIBA_ID_PREFIX = 'ich-';

export const isLegacyIchibaId = (id: string | undefined | null): boolean => !!id && id.startsWith(LEGACY_ICHIBA_ID_PREFIX) && !id.startsWith(ICHIBA_ID_PREFIX);
export const isNewIchibaId = (id: string | undefined | null): boolean => !!id && id.startsWith(ICHIBA_ID_PREFIX);

const SHOP_RE = /^[a-z0-9][a-z0-9_-]*$/;
const CODE_RE = /^[a-z0-9][a-z0-9_.-]*$/;

/** 楽天市場APIの itemCode（例 "cocohouse:b01gg4vc32"）を分解する。形式が不正なら null */
export function parseItemCode(itemCode: string | undefined | null): { shop: string; code: string } | null {
  const m = /^([^:\s]+):([^:\s/]+)$/.exec((itemCode ?? '').trim());
  if (!m) return null;
  const shop = m[1].toLowerCase();
  const code = m[2].toLowerCase();
  return SHOP_RE.test(shop) && CODE_RE.test(code) ? { shop, code } : null;
}

/** 楽天市場の商品ページ（アフィリエイトURLなら遷移先）から店舗・商品コードを取り出す（楽天ブックス店 book/<番号> も含む） */
export function ichibaPageKey(url: string | undefined | null): { shop: string; code: string } | null {
  const page = parseAffiliateUrl(url)?.pageUrl ?? url ?? '';
  const key = productKeyFromPageUrl(page);
  if (!key) return null;
  if (key.source === 'books') {
    // 楽天ブックス店（楽天市場上の店舗 "book"）の商品は item.rakuten.co.jp/book/<番号>/ のときだけ楽天市場の商品として扱う
    try {
      const u = new URL(page);
      return u.hostname === 'item.rakuten.co.jp' ? { shop: 'book', code: key.productNumber } : null;
    } catch {
      return null;
    }
  }
  return { shop: key.shop, code: key.itemCode };
}

export type IchibaIdStatus = 'ok' | 'ok_url_differs' | 'missing_itemcode' | 'invalid_itemcode' | 'shop_mismatch' | 'url_unparsable';

/**
 * 楽天市場APIの商品から新IDを決める。
 * - itemCode が無い・不正 → null（推測しない）
 * - 商品URLの店舗が itemCode の店舗と一致しない → null（別商品・別店舗の可能性があるため保存しない）
 * - 店舗は一致し商品コードだけ URL と異なる → itemCode を正としてIDを作る（ok_url_differs として記録）
 */
export function ichibaItemIdFromApi(input: { itemCode?: string | null; itemUrl?: string | null }): { id: string | null; status: IchibaIdStatus } {
  if (!input.itemCode) return { id: null, status: 'missing_itemcode' };
  const ic = parseItemCode(input.itemCode);
  if (!ic) return { id: null, status: 'invalid_itemcode' };
  const page = ichibaPageKey(input.itemUrl);
  if (!page) return { id: null, status: 'url_unparsable' };
  if (page.shop !== ic.shop) return { id: null, status: 'shop_mismatch' };
  return { id: `${ICHIBA_ID_PREFIX}${ic.shop}:${ic.code}`, status: page.code === ic.code ? 'ok' : 'ok_url_differs' };
}

/**
 * 移行用：itemCode を保存していない既存の楽天市場商品から、保存済みの遷移先URLで新IDを作る。
 * URL から店舗・商品コードを取り出せない場合は null（移行しない）。
 */
export function ichibaItemIdFromStoredItem(item: { itemUrl?: string; affiliateUrl?: string; itemCode?: string }): string | null {
  if (item.itemCode) {
    const r = ichibaItemIdFromApi({ itemCode: item.itemCode, itemUrl: item.affiliateUrl || item.itemUrl });
    if (r.id) return r.id;
  }
  const page = ichibaPageKey(item.affiliateUrl) ?? ichibaPageKey(item.itemUrl);
  return page ? `${ICHIBA_ID_PREFIX}${page.shop}:${page.code}` : null;
}
