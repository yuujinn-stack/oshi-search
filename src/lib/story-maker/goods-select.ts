// ストーリーズ B（関連商品）の自動作成：公開中の人物ページ・グループページと同じ条件で商品を選ぶ（DB非依存の純粋関数）。
//
// - 人物：src/app/person/[slug]/page.tsx の「関連商品ピックアップ」と同じ。
//   verdict=related の新品だけ → dedupeProducts → classifyProductForDisplay でセクション分け →
//   「その他」（種類を判断できない商品）とまとめ買い出品を除く → 表示順（tier → 管理画面の並び順 → 表示スコア）。
// - グループ：src/app/groups/[groupSlug]/page.tsx の「関連商品」と同じ。
//   所属メンバー全員の verdict=related（自動判定はスコア70以上）の新品を ID で重複除去 → カテゴリ別に relevanceScore 順。
// - 公開ページの判定は変更しない。ページ内の処理は関数として切り出されていないため、同じ共通関数を同じ順で呼ぶ
//   （applyDisplayOrder は人物ページのローカル関数と同じ内容。ページ側を変えたらここも合わせる）。
// - 価格は使わない（価格の鮮度判定はページ描画時に行うため、ストーリーズ画像には載せない）。

import type { ProductCategory, RakutenItem } from '@/types/rakuten';
import {
  classifyProductForDisplay,
  dedupeProducts,
  isBulkResaleSet,
  isUsedListing,
  REVIEW_SECTION_LABEL,
} from '@/lib/product-curation';
import { calcDisplayScore, calcDisplayTier, type PersonDisplayContext } from '@/lib/product-display-score';

export interface GoodsVerdict {
  verdict: string;
  score?: number;
  source?: string;
}
export type StoredProducts = Partial<Record<ProductCategory, { products: RakutenItem[] }>>;

export interface GoodsSection {
  /** サイトの見出し（人物ページ「写真集・書籍」、グループページ「本・写真集」など） */
  label: string;
  products: RakutenItem[];
}

// 人物ページの表示セクション（「その他」は関連商品ピックアップに出さないため含めない）
const PERSON_SECTIONS: { label: string; sources: ProductCategory[] }[] = [
  { label: '写真集・書籍', sources: ['写真集', '本・雑誌'] },
  { label: 'CD', sources: ['CD'] },
  { label: 'Blu-ray・DVD', sources: ['Blu-ray・DVD'] },
  { label: 'グッズ', sources: ['グッズ'] },
];
const PERSON_NEW_CATS: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD'];

// グループページの表示セクション（PRODUCT_DISPLAY と同じ）
const GROUP_SECTIONS: { label: string; cats: ProductCategory[] }[] = [
  { label: '本・写真集', cats: ['写真集', '本・雑誌'] },
  { label: 'CD', cats: ['CD'] },
  { label: 'Blu-ray・DVD', cats: ['Blu-ray・DVD'] },
  { label: 'グッズ', cats: ['グッズ'] },
];
const GROUP_CATS: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];

/** 人物ページの applyDisplayOrder と同じ（tier 昇順。tier 内は管理画面の並び順 → 表示スコア降順） */
export function applyPersonDisplayOrder(products: RakutenItem[], savedOrder: string[], ctx: PersonDisplayContext): RakutenItem[] {
  const tierMap = new Map<number, RakutenItem[]>();
  for (const p of products) {
    const t = calcDisplayTier(p, ctx);
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(p);
  }
  const result: RakutenItem[] = [];
  for (const tier of [...tierMap.keys()].sort((a, b) => a - b)) {
    const group = tierMap.get(tier)!;
    if (savedOrder.length === 0) {
      group.sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...group);
    } else {
      const added = new Set<string>();
      const inOrder: RakutenItem[] = [];
      for (const id of savedOrder) {
        const p = group.find((x) => x.id === id);
        if (p && !added.has(p.id)) { inOrder.push(p); added.add(p.id); }
      }
      const rest = group.filter((p) => !added.has(p.id)).sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...inOrder, ...rest);
    }
  }
  return result;
}

/** 人物ページの「関連商品ピックアップ」に出る商品（セクション順） */
export function selectPersonGoods(
  stored: StoredProducts,
  verdicts: Record<string, GoodsVerdict>,
  displayOrders: Record<string, string[]>,
  ctx: PersonDisplayContext,
): GoodsSection[] {
  const candidates: RakutenItem[] = [];
  const sourceCatOf = new Map<RakutenItem, ProductCategory>();
  for (const cat of PERSON_NEW_CATS) {
    for (const p of stored[cat]?.products ?? []) {
      if (verdicts[p.id]?.verdict !== 'related') continue;
      if (isUsedListing(p.title)) continue; // 楽天市場カテゴリに混ざった【中古】出品は中古（ピックアップに出さない）
      sourceCatOf.set(p, cat);
      candidates.push(p);
    }
  }
  const bySection: Record<string, RakutenItem[]> = {};
  for (const p of dedupeProducts(candidates)) {
    const { section } = classifyProductForDisplay(p.title, sourceCatOf.get(p) ?? p.category, p.itemUrl);
    if (section === REVIEW_SECTION_LABEL) continue;
    (bySection[section] ??= []).push(p);
  }
  return PERSON_SECTIONS.map(({ label, sources }) => {
    const saved = sources.flatMap((c) => displayOrders[c] ?? []);
    const products = applyPersonDisplayOrder(bySection[label] ?? [], saved, ctx).filter((p) => !isBulkResaleSet(p.title));
    return { label, products };
  }).filter((s) => s.products.length > 0);
}

/** グループページの「関連商品」に出る商品（所属メンバー全員分・セクション順） */
export function selectGroupGoods(members: { stored: StoredProducts; verdicts: Record<string, GoodsVerdict> }[]): GoodsSection[] {
  const newMap = new Map<string, RakutenItem>();
  for (const { stored, verdicts } of members) {
    for (const cat of GROUP_CATS) {
      for (const p of stored[cat]?.products ?? []) {
        const v = verdicts[p.id];
        if (!v || v.verdict !== 'related') continue;
        if (v.source !== 'manual' && (v.score ?? 0) < 70) continue;
        if (p.isUsed || cat === '中古') continue;
        if (!newMap.has(p.id)) newMap.set(p.id, p);
      }
    }
  }
  return GROUP_SECTIONS.map(({ label, cats }) => ({
    label,
    products: [...newMap.values()].filter((p) => cats.includes(p.category)).sort((a, b) => b.relevanceScore - a.relevanceScore),
  })).filter((s) => s.products.length > 0);
}

/**
 * ストーリーズに載せる商品（最大 max 件）。セクションを順番に1件ずつ取り（写真集 → CD → DVD → グッズ → 2周目…）、
 * 種類が偏らないようにする。各セクション内の順番はサイトの表示順のまま。
 */
export function pickStoryGoods(sections: GoodsSection[], max = 3): { product: RakutenItem; section: string }[] {
  const picked: { product: RakutenItem; section: string }[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const s of sections) {
      const p = s.products[round];
      if (!p) continue;
      any = true;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      picked.push({ product: p, section: s.label });
      if (picked.length >= max) break;
    }
    if (!any) break;
  }
  return picked;
}

/** 商品名の表示用（先頭の【新品】などの括弧書きを外さず、前後の空白だけ整える。中古表記は選ばないので出ない） */
export function storyGoodsTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}
