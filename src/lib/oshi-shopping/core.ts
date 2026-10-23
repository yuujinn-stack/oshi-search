// 推し活お買い物診断の商品選定（純粋関数。DB・API 非依存）。AI は使わない。
//
// 推し本人の関連商品：人物ページと同じ公開条件（verdict=related）と分類・重複除去・並び順の関数を使う。
//   - 分類   … classifyProductForDisplay（取得元API＋商品名の明示的な語）
//   - 重複   … dedupeProducts
//   - 並び順 … calcDisplayTier（本人名入り → 期別 → グループ）→ calcDisplayScore
//   診断ではさらに、中古・まとめ買い・「その他」・公式を名乗る商品名・手作り/名入れ品・楽天以外のリンクを除く。
//   公式かどうかは確認できないため、「公式」とは表示しない（ラベルは本人名入り／期別／グループの作品のみ）。
// 一般商品：楽天市場商品検索APIから取得した、推しサーチの選定リストの商品。人物とは結び付けない。
//
// どちらも「用途に合う × 予算以内」の商品だけを最大4件返す。足りない場合に条件外の商品で埋めない。
// 予算を超える商品は件数だけを返し、商品としては返さない（予算内の商品と混ぜない）。
import type { ProductCategory, RakutenItem } from '@/types/rakuten';
import {
  classifyProductForDisplay,
  dedupeProducts,
  isBulkResaleSet,
  isUsedListing,
  type DisplaySectionLabel,
} from '@/lib/product-curation';
import { calcDisplayScore, calcDisplayTier, type PersonDisplayContext } from '@/lib/product-display-score';
import { budgetMax, type OshiShoppingBudget, type OshiShoppingUse } from './params';
import { withPriceFreshness } from '@/lib/price-freshness';
import { productKeyOfLink, productKeyString } from '@/lib/rakuten-affiliate-link';
import { parseItemCode } from '@/lib/rakuten-item-id';
import type { GeneralItemEntry } from './general-items';

export const MAX_ITEMS_PER_BLOCK = 4;
const MAX_PER_SECTION = 2;

const NEW_PRODUCT_CATS: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD'];

// 公式と確認できない表記（ショップの自称）。表示すると公式商品と誤認させるおそれがあるため診断では出さない
const OFFICIAL_CLAIM_RE = /公式|オフィシャル|official|非売品/i;
// ファンによる手作り・名入れ・オーダー品（本人・事務所の商品ではない）
const FAN_MADE_RE = /手作り|ハンドメイド|名入れ|名前入り|オーダー|カット済み|プリントシール|ネームボード|文字パネル/;
const LIVE_TITLE_RE = /LIVE|ライブ|コンサート|CONCERT|TOUR|ツアー|ドーム|アリーナ|武道館|公演/i;
const LIVE_GOODS_RE = /ペンライト|タオル|うちわ|Tシャツ|ツアー|ライブ|コンサート|LIVE|TOUR/i;
const DISPLAY_GOODS_RE = /アクリルスタンド|アクスタ|ポスター|カレンダー|タペストリー|フォト|ブロマイド|パネル|フィギュア|ぬいぐるみ/;

type Section = Exclude<DisplaySectionLabel, 'その他'>;

/** 用途ごとに対象にするセクションと、商品名で用途を確認する条件（明示的な語のみ。推測しない） */
const USE_RULES: Record<OshiShoppingUse, { section: Section; titleRe?: RegExp }[]> = {
  collection: [{ section: '写真集・書籍' }, { section: 'CD' }, { section: 'Blu-ray・DVD' }, { section: 'グッズ' }],
  live: [{ section: 'Blu-ray・DVD', titleRe: LIVE_TITLE_RE }, { section: 'グッズ', titleRe: LIVE_GOODS_RE }],
  display: [{ section: '写真集・書籍' }, { section: 'グッズ', titleRe: DISPLAY_GOODS_RE }],
  gift: [{ section: '写真集・書籍' }, { section: 'CD' }, { section: 'Blu-ray・DVD' }],
};

/** 楽天のリンクか（楽天ウェブサービス規約 第8条4項：APIを使った部分には楽天サイト以外へのリンクを置かない） */
export function isRakutenLink(url: string | undefined | null): boolean {
  try {
    const host = new URL(url ?? '').hostname;
    return host === 'a.r10.to' || host === 'rakuten.co.jp' || host.endsWith('.rakuten.co.jp');
  } catch {
    return false;
  }
}

export type PersonItemLabel = '本人名入り' | '期別の作品' | 'グループの作品';

export interface PersonPick {
  product: RakutenItem;
  section: Section;
  /** 商品名・著者・アーティスト欄から分かる範囲の関連の種類（分からなければ null） */
  label: PersonItemLabel | null;
  /** 販売元の種類（楽天ブックス／楽天市場のショップ。手動登録で判断できなければ null） */
  seller: { kind: 'books' } | { kind: 'shop'; shopName: string } | null;
}

export interface PersonPickResult {
  /** 関連商品データがあるか（人物の商品が1件も保存されていなければ false） */
  hasData: boolean;
  /** 診断の対象になる関連商品（新品・除外条件に該当しない）の件数（用途・予算を問わない） */
  eligibleCount: number;
  /** 用途に合う商品のうち予算以内の件数 */
  matchedCount: number;
  /** 用途に合うが予算を超える件数（商品は返さない） */
  overBudgetCount: number;
  /** 判定が不確か・価格の確認待ち・販売終了の確認済みとして出さなかった件数（related の新品のうち。表示には使わない） */
  excluded?: { ambiguousId: number; priceReview: number; unavailable: number };
  items: PersonPick[];
}

export interface StoredProductsInput {
  storedData: Partial<Record<ProductCategory, { products: RakutenItem[]; fetchedAt?: number }>>;
  verdicts: Record<string, { verdict: string } | undefined>;
  /** 価格の確認待ち（price_reviews が pending）の商品ID：保存中の価格が現在の価格と30%以上違う可能性があるため出さない */
  priceReviewIds?: ReadonlySet<string>;
  /** 価格更新で楽天ブックスの品切れ・販売終了等を確認した商品ID（直近3日以内の確認結果）：出さない */
  unavailableIds?: ReadonlySet<string>;
}

/**
 * 楽天の商品としての同一性（src/lib/product-store.ts の productIdentityKey と同じ規則。純粋関数として持つ）。
 * 商品ページURL（アフィリエイトURLなら遷移先）から作り、無ければ楽天市場の itemCode。判断できなければ ''。
 */
function identityOf(p: Pick<RakutenItem, 'itemUrl' | 'affiliateUrl' | 'itemCode'>): string {
  const fromUrl = productKeyString(productKeyOfLink(p.itemUrl) ?? productKeyOfLink(p.affiliateUrl));
  if (fromUrl) return fromUrl;
  const code = parseItemCode(p.itemCode);
  return code ? `ichiba:${code.shop}/${code.code}` : '';
}

/**
 * 同じ人物の中で、同じ商品IDが別の商品に付いている（旧ID〔店舗単位の ic-〕の重複。グッズと中古の組など）商品ID。
 * 判定（verdicts）は商品ID単位のため、どちらの商品に対する判定か分からない。診断では出さない（判定データは変更しない）。
 */
export function ambiguousProductIds(storedData: StoredProductsInput['storedData']): Set<string> {
  const keysById = new Map<string, Set<string>>();
  for (const row of Object.values(storedData)) {
    for (const p of row?.products ?? []) {
      const key = identityOf(p) || `url:${p.itemUrl ?? ''}`;
      (keysById.get(p.id) ?? keysById.set(p.id, new Set()).get(p.id)!).add(key);
    }
  }
  return new Set([...keysById].filter(([, keys]) => keys.size > 1).map(([id]) => id));
}

/** 診断で出さない理由（出してよければ null） */
export function personItemExcludeReason(p: RakutenItem, section: DisplaySectionLabel): string | null {
  const title = p.title ?? '';
  if (p.isUsed || isUsedListing(title)) return 'used';
  if (section === 'その他') return 'unclassified';
  if (isBulkResaleSet(title)) return 'bulk';
  if (OFFICIAL_CLAIM_RE.test(title)) return 'official_claim';
  if (FAN_MADE_RE.test(title)) return 'fan_made';
  if (!(Number(p.price) > 0)) return 'no_price';
  if (!isRakutenLink(p.affiliateUrl || p.itemUrl)) return 'not_rakuten';
  return null;
}

function tierLabel(tier: number): PersonItemLabel | null {
  if (tier === 0) return '本人名入り';
  if (tier === 1) return '期別の作品';
  if (tier === 2) return 'グループの作品';
  return null;
}

function sellerOf(p: RakutenItem): PersonPick['seller'] {
  if (/^(bk|cd|dv)-/.test(p.id)) return { kind: 'books' };
  if (p.shopName) return p.shopName === '楽天ブックス' ? { kind: 'books' } : { kind: 'shop', shopName: p.shopName };
  return null;
}

/** 同じセクションに偏らないよう、セクションごとに最大2件・全体で最大4件を順に選ぶ */
function pickDiverse<T extends { section: string }>(sorted: T[], sectionOrder: string[]): T[] {
  const out: T[] = [];
  const perSection = new Map<string, number>();
  const take = (x: T) => { out.push(x); perSection.set(x.section, (perSection.get(x.section) ?? 0) + 1); };
  // 1巡目：用途の対象セクションの順に、各セクションの先頭を1件ずつ
  for (const s of sectionOrder) {
    if (out.length >= MAX_ITEMS_PER_BLOCK) break;
    const x = sorted.find((c) => c.section === s);
    if (x) take(x);
  }
  // 2巡目：残りを並び順のまま（セクションごとの上限まで）
  for (const x of sorted) {
    if (out.length >= MAX_ITEMS_PER_BLOCK) break;
    if (out.includes(x) || (perSection.get(x.section) ?? 0) >= MAX_PER_SECTION) continue;
    take(x);
  }
  return out;
}

export function selectPersonItems(
  input: StoredProductsInput,
  ctx: PersonDisplayContext,
  use: OshiShoppingUse,
  budget: OshiShoppingBudget,
  nowMs: number = Date.now(),
): PersonPickResult {
  const { storedData, verdicts } = input;
  const hasData = NEW_PRODUCT_CATS.some((c) => (storedData[c]?.products?.length ?? 0) > 0);
  const ambiguous = ambiguousProductIds(storedData);
  const excluded = { ambiguousId: 0, priceReview: 0, unavailable: 0 };

  // 人物ページと同じ公開条件：verdict=related の新品（中古カテゴリは診断では使わない）
  const candidates: RakutenItem[] = [];
  const sourceCatOf = new Map<RakutenItem, ProductCategory>();
  for (const cat of NEW_PRODUCT_CATS) {
    for (const stored of storedData[cat]?.products ?? []) {
      if (verdicts[stored.id]?.verdict !== 'related') continue;
      if (ambiguous.has(stored.id)) { excluded.ambiguousId++; continue; }
      if (input.priceReviewIds?.has(stored.id)) { excluded.priceReview++; continue; }
      if (input.unavailableIds?.has(stored.id)) { excluded.unavailable++; continue; }
      // 表示用のコピーに価格の取得日時・古さを付ける。診断では取得日時が分からない価格・取得から日数がたった価格は
      // 表示しない（strict。「価格は楽天で確認」）。予算の判定は保存されている価格（取得時点）で行う
      const p = withPriceFreshness(stored, nowMs, 'strict');
      sourceCatOf.set(p, cat);
      candidates.push(p);
    }
  }

  const eligible: { product: RakutenItem; section: Section; tier: number; score: number }[] = [];
  for (const p of dedupeProducts(candidates)) {
    const { section } = classifyProductForDisplay(p.title, sourceCatOf.get(p) ?? p.category, p.itemUrl);
    if (personItemExcludeReason(p, section)) continue;
    eligible.push({ product: p, section: section as Section, tier: calcDisplayTier(p, ctx), score: calcDisplayScore(p, ctx) });
  }

  const rules = USE_RULES[use];
  const matchesUse = (e: (typeof eligible)[number]) =>
    rules.some((r) => r.section === e.section && (!r.titleRe || r.titleRe.test(e.product.title)));
  const max = budgetMax(budget);
  const forUse = eligible.filter(matchesUse);
  const inBudget = forUse.filter((e) => Number(e.product.price) <= max);

  inBudget.sort((a, b) => a.tier - b.tier || b.score - a.score || Number(a.product.price) - Number(b.product.price));
  const picked = pickDiverse(inBudget, rules.map((r) => r.section));

  return {
    hasData,
    eligibleCount: eligible.length,
    matchedCount: inBudget.length,
    overBudgetCount: forUse.length - inBudget.length,
    excluded,
    items: picked.map((e) => ({ product: e.product, section: e.section, label: tierLabel(e.tier), seller: sellerOf(e.product) })),
  };
}

// ── 一般商品 ──────────────────────────────────────────────────────────────────

/** 楽天市場商品検索APIから取得した一般商品（表示用。リポジトリ・DBには保存しない） */
export interface GeneralItemData {
  itemCode: string;
  /** 楽天の商品名（改変せずに表示する） */
  itemName: string;
  price: number;
  imageUrl: string;
  /** API が返したアフィリエイトURL（そのまま使う） */
  affiliateUrl: string;
  shopName: string;
  reviewCount: number;
  /** 取得日時（epoch ms） */
  fetchedAt: number;
}

export interface GeneralPick {
  entry: GeneralItemEntry;
  item: GeneralItemData;
}

export interface GeneralPickResult {
  /** 選定リストのうち取得できた（販売中の）件数 */
  availableCount: number;
  /** 取得できなかった件数（販売終了・一時的なエラー等） */
  unavailableCount: number;
  matchedCount: number;
  overBudgetCount: number;
  items: GeneralPick[];
}

export function selectGeneralItems(
  entries: readonly GeneralItemEntry[],
  fetched: ReadonlyMap<string, GeneralItemData | null>,
  use: OshiShoppingUse,
  budget: OshiShoppingBudget,
): GeneralPickResult {
  const forUse = entries.filter((e) => e.use === use);
  const available: GeneralPick[] = [];
  for (const entry of forUse) {
    const item = fetched.get(entry.itemCode);
    if (!item || !(item.price > 0) || !item.imageUrl || !isRakutenLink(item.affiliateUrl)) continue;
    available.push({ entry, item });
  }
  const max = budgetMax(budget);
  const inBudget = available.filter((g) => g.item.price <= max);
  // 並び順はレビュー件数の多い順（人気の目安。品質を保証するものではない）→ 価格の安い順
  inBudget.sort((a, b) => b.item.reviewCount - a.item.reviewCount || a.item.price - b.item.price);
  return {
    availableCount: available.length,
    unavailableCount: forUse.length - available.length,
    matchedCount: inBudget.length,
    overBudgetCount: available.length - inBudget.length,
    items: inBudget.slice(0, MAX_ITEMS_PER_BLOCK),
  };
}
