// ストーリーズ作成（/admin/story-maker）のテンプレート「楽天BF・推し別セール紹介」の純粋関数（DB非依存・'use client' からも import 可）。
//
// 方針（推測で数字を作らない）:
// - 掲載できるのは、管理者が楽天の商品ページで「楽天ブラックフライデーの対象であること」と価格2つ（通常価格の表記・セール価格）を
//   確認し、承認欄に入力・チェックした商品だけ。既存の商品データ（products・rakuten_event_products）には通常価格・セール価格・
//   BF対象の情報が無い（2026-11-20 時点で本番の rakuten_events にブラックフライデーの登録なし）ため、自動では判定しない。
// - 値下げ額・割引率は入力された2つの価格からだけ計算する（割引率は小数点以下切り捨て＝実際より大きく見せない）。
// - 最大割引率は、投稿に採用した（承認済みの）商品の割引率の最大値。承認していない商品・候補は含めない。
// - 承認はセールの開催中に行ったものだけ有効。承認から24時間を過ぎたもの・セール終了後は使えない（価格が変わる可能性があるため）。
// - セールの日時は、トップの特設コーナー（Task 199）と同じ SALE_CORNERS を参照する（ここに日時を書かない）。
// - 値引きの種類を承認欄で選ばせ、商品ページの表示価格そのものの値下げ（条件なし・条件付き）だけを掲載する。
//   ポイント倍率・買いまわりの対象なだけの商品、クーポン利用時だけ安くなる商品は値引き商品として扱わない（承認できない）。
// - 根拠URL（sourceUrl＝確認した楽天の商品ページ）・確認日時（checkedAt）・適用条件（conditions）を承認内容として保持する。

import { SALE_CORNERS, type SaleCornerConfig } from '@/lib/sale-corner/config';
import { salePeriodLabel, salePhaseAt, toSaleCorner, type SaleCorner, type SalePhase } from '@/lib/sale-corner/core';
import { isRakutenProductPageUrl } from '@/lib/rakuten-event/core';

export const BF_SALE_ID = 'rakuten-blackfriday-2026';
/** 1ページに載せる商品数 */
export const BF_ITEMS_PER_PAGE = 3;
/** 商品ページの最大数（表紙1＋商品1〜2＋最終1＝3〜4枚） */
export const BF_MAX_PRODUCT_PAGES = 2;
/** このテンプレートで採用できる商品の上限 */
export const BF_MAX_ITEMS = BF_ITEMS_PER_PAGE * BF_MAX_PRODUCT_PAGES;
/** フィード投稿（4:5）の高さ。幅は 1080 */
export const BF_FRAME_H = 1350;
/** 承認の有効期間（楽天イベント管理の再確認の目安 RECHECK_AFTER_MS と同じ24時間） */
export const BF_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
export const BF_PRICE_MAX = 10_000_000;

/** 商品ページでの価格の表記（そのまま画像に出す。メーカー希望小売価格を「通常価格」と書き換えない） */
export const BF_PRICE_LABELS = ['通常価格', '当店通常価格', 'メーカー希望小売価格', '定価'] as const;
export type BfPriceLabel = (typeof BF_PRICE_LABELS)[number];

/**
 * 値引きの種類（承認欄で選ぶ）。掲載できるのは price-cut / price-cut-conditional だけ。
 * points-only・coupon-only は「値引きが確認できない」ものとして承認しない。
 */
export type BfDiscountKind = 'price-cut' | 'price-cut-conditional' | 'points-only' | 'coupon-only';
export const BF_DISCOUNT_KINDS: { value: BfDiscountKind; label: string; allowed: boolean }[] = [
  { value: 'price-cut', label: '表示価格そのものの値下げ（条件なし）', allowed: true },
  { value: 'price-cut-conditional', label: '表示価格そのものの値下げ（数量限定・時間限定などの条件あり）', allowed: true },
  { value: 'points-only', label: 'ポイント倍率・買いまわりの対象のみ（価格の値下げなし）', allowed: false },
  { value: 'coupon-only', label: 'クーポンを使ったときだけ安くなる', allowed: false },
];
export const BF_ALLOWED_DISCOUNT_KINDS: BfDiscountKind[] = BF_DISCOUNT_KINDS.filter((k) => k.allowed).map((k) => k.value);
/** 条件なしの値下げで、適用条件の欄が空のときに記録する文言 */
export const BF_NO_CONDITION = '条件なし（商品ページの表示価格）';
export const BF_CONDITIONS_MAX = 80;

export function bfSaleCorner(configs: SaleCornerConfig[] = SALE_CORNERS): SaleCorner | null {
  const c = configs.find((x) => x.id === BF_SALE_ID);
  return c ? toSaleCorner(c) : null;
}

/** セールの状態（開催前・開催中・終了＝null） */
export function bfSalePhase(nowMs: number, sale: SaleCorner | null = bfSaleCorner()): SalePhase | null {
  return sale ? salePhaseAt(sale, nowMs) : null;
}

export function bfSalePeriodLabel(sale: SaleCorner | null = bfSaleCorner()): string {
  return sale ? salePeriodLabel(sale) : '';
}

/** 候補（サイトに公開中の関連商品。まだBF対象か分からない） */
export interface BfSaleCandidate {
  productId: string;
  title: string;
  /** サイトの見出し（写真集・書籍 / CD / Blu-ray・DVD / グッズ など） */
  section: string;
  /** 商品データの商品ページ（楽天の商品ページと分かるときだけ。アフィリエイトの計測リンクは開かない） */
  pageUrl: string | null;
  /** 管理画面の一覧に出す画像（https の画像URL。投稿画像には使わず、採用後にサーバーで data: URL を取り直す） */
  thumbUrl: string | null;
  /** 商品データに保存されている価格（参考。いつの価格か分からないため投稿画像には使わない） */
  storedPrice: number | null;
}

/** 承認欄の入力 */
export interface BfVerificationInput {
  priceLabel: BfPriceLabel;
  regularPrice: string;
  salePrice: string;
  /** 根拠URL（BFの対象表示と価格を確認した楽天の商品ページ） */
  sourceUrl: string;
  discountKind: BfDiscountKind | '';
  /** 適用条件（数量限定・時間限定など。条件なしの値下げは空でよい） */
  conditions: string;
  /** 「商品ページで楽天ブラックフライデーの対象であることと、2つの価格を確認した」 */
  confirmed: boolean;
  checkedBy: string;
}

/** 承認済みの商品（投稿画像・投稿データの記録に使う） */
export interface BfApprovedItem {
  productId: string;
  title: string;
  section: string;
  priceLabel: BfPriceLabel;
  regularPrice: number;
  salePrice: number;
  /** 値下げ額（通常価格 − セール価格） */
  offAmount: number;
  /** 割引率（%・小数点以下切り捨て） */
  offRate: number;
  /** 根拠URL（確認した楽天の商品ページ） */
  sourceUrl: string;
  /** 値引きの種類（price-cut / price-cut-conditional だけ） */
  discountKind: BfDiscountKind;
  /** 適用条件（条件なしは BF_NO_CONDITION） */
  conditions: string;
  checkedBy: string;
  /** 承認した日時（ISO） */
  checkedAt: string;
  saleId: string;
}

export const EMPTY_VERIFICATION: BfVerificationInput = {
  priceLabel: '通常価格', regularPrice: '', salePrice: '', sourceUrl: '', discountKind: '', conditions: '', confirmed: false, checkedBy: '',
};

/** 「1,980」「¥1,980」「1980円」を整数に。整数でなければ null */
export function parseYen(v: string): number | null {
  const s = v.replace(/[,，\s円¥￥]/g, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= BF_PRICE_MAX ? n : null;
}

export function calcDiscount(regularPrice: number, salePrice: number): { offAmount: number; offRate: number } {
  const offAmount = regularPrice - salePrice;
  return { offAmount, offRate: Math.floor((offAmount / regularPrice) * 100) };
}

function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a), y = new URL(b);
    const norm = (u: URL) => `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
    return norm(x) === norm(y);
  } catch {
    return false;
  }
}

/** 承認欄の入力を検証する。問題が無ければ承認済みの商品を返す（承認日時は now） */
export function verifyBfItem(
  candidate: BfSaleCandidate,
  input: BfVerificationInput,
  nowMs: number,
  sale: SaleCorner | null = bfSaleCorner(),
): { ok: true; item: BfApprovedItem } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!sale) errors.push('セールの設定（SALE_CORNERS）が見つかりません。');
  else if (bfSalePhase(nowMs, sale) !== 'active') errors.push('楽天ブラックフライデーの開催中だけ承認できます（開催前・終了後は対象・価格を確認できないため）。');
  if (!BF_PRICE_LABELS.includes(input.priceLabel)) errors.push('価格の表記を選んでください。');
  const regular = parseYen(input.regularPrice);
  const salePrice = parseYen(input.salePrice);
  if (regular === null) errors.push(`${input.priceLabel || '通常価格'}を1〜${BF_PRICE_MAX.toLocaleString('ja-JP')}円の整数で入力してください。`);
  if (salePrice === null) errors.push('セール価格を1円以上の整数で入力してください。');
  if (regular !== null && salePrice !== null) {
    if (salePrice >= regular) errors.push('セール価格が通常価格以上です。値下げが確認できない商品は掲載できません。');
    else if (calcDiscount(regular, salePrice).offRate < 1) errors.push('割引率が1%未満のため掲載できません。');
  }
  const kind = BF_DISCOUNT_KINDS.find((k) => k.value === input.discountKind);
  const conditionsRaw = input.conditions.trim().replace(/\s+/g, ' ');
  if (!kind) errors.push('値引きの種類を選んでください。');
  else if (!kind.allowed) {
    errors.push(kind.value === 'points-only'
      ? 'ポイント倍率・買いまわりの対象なだけの商品は、値引き商品として掲載できません。'
      : 'クーポンを使ったときだけ安くなる商品は、購入者によって価格が変わるため掲載できません。');
  } else if (kind.value === 'price-cut-conditional' && !conditionsRaw) errors.push('適用条件（例：先着500個限定・11/21 23:59まで）を入力してください。');
  if (conditionsRaw.length > BF_CONDITIONS_MAX) errors.push(`適用条件は${BF_CONDITIONS_MAX}文字以内で入力してください。`);
  const src = input.sourceUrl.trim();
  if (!isRakutenProductPageUrl(src)) errors.push('確認元には楽天の商品ページのURL（item.rakuten.co.jp/… または books.rakuten.co.jp/rb/…）を入力してください（アフィリエイトのリンク・イベントページは不可）。');
  else if (candidate.pageUrl && !samePage(src, candidate.pageUrl)) errors.push('確認元のURLがこの商品の商品ページと一致しません。');
  if (!input.confirmed) errors.push('商品ページで楽天ブラックフライデーの対象であること・価格・適用条件を確認したら、確認のチェックを入れてください。');
  const checkedBy = input.checkedBy.trim().slice(0, 50);
  if (!checkedBy) errors.push('確認者の名前を入力してください。');
  if (errors.length > 0 || regular === null || salePrice === null || !kind) return { ok: false, errors };
  return {
    ok: true,
    item: {
      productId: candidate.productId,
      title: candidate.title,
      section: candidate.section,
      priceLabel: input.priceLabel,
      regularPrice: regular,
      salePrice,
      ...calcDiscount(regular, salePrice),
      sourceUrl: src,
      discountKind: kind.value,
      conditions: conditionsRaw || (kind.value === 'price-cut' ? BF_NO_CONDITION : ''),
      checkedBy,
      checkedAt: new Date(nowMs).toISOString(),
      saleId: BF_SALE_ID,
    },
  };
}

/** 承認がまだ使えるか（開催中・24時間以内・同じセール） */
export function isApprovalUsable(item: Pick<BfApprovedItem, 'checkedAt' | 'saleId'>, nowMs: number, sale: SaleCorner | null = bfSaleCorner()): boolean {
  if (item.saleId !== BF_SALE_ID || bfSalePhase(nowMs, sale) !== 'active') return false;
  const at = Date.parse(item.checkedAt);
  if (!Number.isFinite(at) || at > nowMs + 60_000) return false;
  if (sale && at < sale.startsAt) return false;
  return nowMs - at < BF_APPROVAL_TTL_MS;
}

/** 最大割引率（採用した承認済みの商品だけ）。商品が無ければ null */
export function maxOffRate(items: Pick<BfApprovedItem, 'offRate'>[]): number | null {
  return items.length === 0 ? null : Math.max(...items.map((i) => i.offRate));
}

export function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

/** 画像の注記に入れる確認日時（日本時間 "11/20 14:05"。複数あれば最も古いもの） */
export function checkedAtLabel(items: Pick<BfApprovedItem, 'checkedAt'>[]): string {
  if (items.length === 0) return '';
  const oldest = Math.min(...items.map((i) => Date.parse(i.checkedAt)));
  const d = new Date(oldest + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 画像に描く商品（承認済み＋サーバーで取得した商品画像） */
export interface BfSlideItem extends BfApprovedItem {
  imageSrc: string | null;
}

/** 商品ページの枚数（0〜2。商品が無いときも商品ページは1枚出す） */
export function bfProductPageCount(itemCount: number): number {
  return Math.min(BF_MAX_PRODUCT_PAGES, Math.max(1, Math.ceil(itemCount / BF_ITEMS_PER_PAGE)));
}

/** 投稿の枚数（表紙＋商品ページ＋最終ページ＝3〜4） */
export function bfSlideCount(itemCount: number): number {
  return bfProductPageCount(itemCount) + 2;
}

/** 商品ページ（0始まり）に載せる商品 */
export function bfPageItems<T>(items: T[], page: number): T[] {
  return items.slice(page * BF_ITEMS_PER_PAGE, (page + 1) * BF_ITEMS_PER_PAGE);
}

/** 画像に出す適用条件（条件なしの値下げは出さない） */
export function bfConditionText(item: Pick<BfApprovedItem, 'discountKind' | 'conditions'>): string {
  return item.discountKind === 'price-cut-conditional' ? item.conditions : '';
}

/**
 * 表紙に出す「何の商品の紹介か」（採用した商品の種類だけを、決まった順で並べる。架空の種類を書かない）。
 * 商品が無いとき（保存できない状態のプレビュー）は代表的な種類を出す。
 */
const BF_CATEGORY_ORDER: { label: string; match: (section: string) => boolean }[] = [
  { label: '写真集', match: (s) => s.includes('写真集') || s.includes('本') },
  { label: 'DVD・Blu-ray', match: (s) => s.includes('DVD') || s.includes('Blu-ray') },
  { label: 'CD', match: (s) => s === 'CD' },
  { label: 'グッズ', match: (s) => s.includes('グッズ') },
];
export function bfCategoryLine(sections: string[]): string {
  const found = BF_CATEGORY_ORDER.filter((c) => sections.some((s) => c.match(s))).map((c) => c.label);
  return (found.length > 0 ? found : ['写真集', 'DVD・Blu-ray', 'グッズ']).join(' / ');
}

/** スライドに渡すセールのデータ */
export interface BfSlideData {
  items: BfSlideItem[];
  maxRate: number | null;
  periodLabel: string;
  checkedLabel: string;
}

/** 投稿データ（効果測定の記録）に保存する形を検証する。不正なものは捨てずにエラーにする */
export function parseBfRecordItems(raw: unknown): BfApprovedItem[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > BF_MAX_ITEMS) throw new Error('セール商品の記録の形式が正しくありません。');
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const regular = Number(o.regularPrice), salePrice = Number(o.salePrice);
    const priceLabel = s(o.priceLabel, 20) as BfPriceLabel;
    if (!Number.isInteger(regular) || !Number.isInteger(salePrice) || salePrice < 1 || salePrice >= regular || regular > BF_PRICE_MAX) {
      throw new Error('セール商品の価格の記録が正しくありません。');
    }
    if (!BF_PRICE_LABELS.includes(priceLabel)) throw new Error('セール商品の価格の表記が正しくありません。');
    const sourceUrl = s(o.sourceUrl, 1000);
    if (!isRakutenProductPageUrl(sourceUrl)) throw new Error('セール商品の確認元URLが正しくありません。');
    const discountKind = s(o.discountKind, 40) as BfDiscountKind;
    if (!BF_ALLOWED_DISCOUNT_KINDS.includes(discountKind)) throw new Error('セール商品の値引きの種類が正しくありません（ポイント・クーポンだけの商品は記録できません）。');
    const conditions = s(o.conditions, BF_CONDITIONS_MAX);
    if (discountKind === 'price-cut-conditional' && !conditions) throw new Error('セール商品の適用条件が記録されていません。');
    const checkedAt = s(o.checkedAt, 40);
    if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('セール商品の確認日時が正しくありません。');
    return {
      productId: s(o.productId, 100),
      title: s(o.title, 300),
      section: s(o.section, 40),
      priceLabel,
      regularPrice: regular,
      salePrice,
      ...calcDiscount(regular, salePrice),
      sourceUrl,
      discountKind,
      conditions: conditions || (discountKind === 'price-cut' ? BF_NO_CONDITION : ''),
      checkedBy: s(o.checkedBy, 50),
      checkedAt,
      saleId: s(o.saleId, 60),
    };
  });
}
