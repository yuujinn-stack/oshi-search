// 楽天市場の旧ID（ic-）と新ID（ich-）の対応づけ（純粋関数・DB非依存）。Phase 4 追記（docs/development-log.md Task 95）。
//
// 商品ID移行後も旧IDの判定行（verdicts）は削除せずに残すため、そのままでは「商品が存在しない孤立判定」に見える。
// 復旧API・データ損失監査がそれを独立した商品として扱うと、Redis に残る旧データから同じ商品を旧IDで二重に復活させたり、
// 新IDへ引き継いだ判定を同じ店舗の別商品に付け直したりしてしまう。ここではその対応関係を判定する。
//
// - 旧IDは stableId('ic', itemUrl)（src/lib/rakuten.ts）＝ itemUrl の最後のパス要素の先頭24文字（店舗単位の値）。
//   移行は id だけを書き換え itemUrl は変えないため、新IDの商品の itemUrl から元の旧IDを再計算できる。
// - 「移行済み」は、同じ人物の新ID商品のうち旧IDが一致するものに、旧IDと同じ内容の判定（verdict・source・score・reason）が
//   付いている場合だけ（＝移行スクリプトが引き継いだ判定）。旧IDだけ一致する場合は「同じ店舗の新ID商品あり（要確認）」。
import { parseAffiliateUrl } from '@/lib/rakuten-affiliate-link';
import { isLegacyIchibaId, isNewIchibaId, LEGACY_ICHIBA_ID_PREFIX } from '@/lib/rakuten-item-id';

/**
 * 商品の同一性判定用のURLキー（アフィリエイトURLなら遷移先 pc の商品ページ。ホスト＋パス・小文字・末尾スラッシュなし）。
 * product-store.ts の mergeProductItems・復旧APIで共通に使う。
 */
export function normalizeItemUrl(url: string): string {
  if (!url) return '';
  const target = parseAffiliateUrl(url)?.pageUrl ?? url;
  try {
    const u = new URL(target);
    return (u.hostname + u.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return target.toLowerCase();
  }
}

/** 旧ID（stableId('ic', itemUrl)）を itemUrl から再計算する。src/lib/rakuten.ts の stableId と同じ規則 */
export function legacyIchibaIdFromItemUrl(itemUrl: string | undefined | null): string {
  const s = itemUrl ?? '';
  try {
    const url = new URL(s);
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    if (last.length >= 4) return `${LEGACY_ICHIBA_ID_PREFIX}${last.slice(0, 24)}`;
  } catch { /* fall through */ }
  return `${LEGACY_ICHIBA_ID_PREFIX}${s.replace(/\W/g, '').slice(-16)}`;
}

export interface VerdictLike {
  productId: string;
  verdict: string;
  source: string;
  score?: string | number | null;
  reason?: string | null;
}
export interface ItemLike { id: string; itemUrl?: string | null }

/** 孤立判定の分類：migrated＝新IDへ引き継ぎ済み（孤立ではない） / same_shop_new_id＝同じ店舗の新ID商品あり（要確認） / orphan */
export type LegacyOrphanKind = 'migrated' | 'same_shop_new_id' | 'orphan';

const sameVerdict = (a: VerdictLike, b: VerdictLike) =>
  a.verdict === b.verdict &&
  a.source === b.source &&
  Number(a.score ?? 0) === Number(b.score ?? 0) &&
  (a.reason ?? '') === (b.reason ?? '');

/** 人物の新ID商品を、元の旧IDごとにまとめる */
export function newIdItemsByLegacyId(items: readonly ItemLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const it of items) {
    if (!isNewIchibaId(it.id) || !it.itemUrl) continue;
    const legacy = legacyIchibaIdFromItemUrl(it.itemUrl);
    const list = map.get(legacy) ?? [];
    if (!list.includes(it.id)) list.push(it.id);
    map.set(legacy, list);
  }
  return map;
}

/**
 * 1人分の孤立判定（商品が見つからない判定）を分類する。
 * @param orphans      その人物の孤立判定
 * @param personItems  その人物の現在の全商品（全カテゴリ）
 * @param newIdVerdicts その人物の新ID（ich-）の判定（productId → 判定）
 */
export function classifyOrphanVerdicts(
  orphans: readonly VerdictLike[],
  personItems: readonly ItemLike[],
  newIdVerdicts: ReadonlyMap<string, VerdictLike>,
): Map<string, LegacyOrphanKind> {
  const byLegacy = newIdItemsByLegacyId(personItems);
  const result = new Map<string, LegacyOrphanKind>();
  for (const o of orphans) {
    const newIds = isLegacyIchibaId(o.productId) ? byLegacy.get(o.productId) : undefined;
    if (!newIds) { result.set(o.productId, 'orphan'); continue; }
    const carried = newIds.some((id) => { const v = newIdVerdicts.get(id); return !!v && sameVerdict(v, o); });
    result.set(o.productId, carried ? 'migrated' : 'same_shop_new_id');
  }
  return result;
}

export type RecoveryConflict = 'already_in_db' | 'same_product_exists' | 'legacy_id_has_new_id_item';

/**
 * 復旧候補（Redis に残る商品）を、その人物の現在の商品（全カテゴリ）へ追加してよいかを判定する。追加してよければ null。
 * - already_in_db: 同じIDの商品がある
 * - same_product_exists: IDは違うが同じ商品ページの商品がある（旧IDと新IDの二重登録防止）
 * - legacy_id_has_new_id_item: 旧IDの商品で、同じ旧IDに対応する新ID商品がある（移行済み、または同じ店舗の別商品。
 *   旧IDで復活させると、新IDへ引き継いだ判定が別の商品に付くおそれがあるため自動では追加しない）
 */
export function recoveryConflict(candidate: ItemLike, existingItems: readonly ItemLike[]): RecoveryConflict | null {
  if (existingItems.some((i) => i.id === candidate.id)) return 'already_in_db';
  const page = normalizeItemUrl(candidate.itemUrl ?? '');
  if (page && existingItems.some((i) => normalizeItemUrl(i.itemUrl ?? '') === page)) return 'same_product_exists';
  if (isLegacyIchibaId(candidate.id) && newIdItemsByLegacyId(existingItems).has(candidate.id)) return 'legacy_id_has_new_id_item';
  return null;
}
