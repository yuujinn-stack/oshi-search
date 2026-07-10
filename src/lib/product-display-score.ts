/**
 * 人物ページ商品表示スコア計算
 *
 * ・表示時の並び順だけを決める純粋関数
 * ・DB / Redis への書き込みなし
 * ・既存の relevanceScore / AI 判定 / verdict には一切影響しない
 * ・既に verdict=related でフィルタ済みの商品一覧内でスコアを付ける
 *
 * 並び順の優先ティア（大→小）:
 *   Tier 1 (NEW)  : 本人名入り → 期別 → グループ → バンドル/その他
 *   Tier 2 (USED) : 中古・まとめ・ランダム・福袋（常に新品より下）
 */

import type { RakutenItem } from '@/types/rakuten';

export interface PersonDisplayContext {
  /** 人物名（例: "賀喜遥香"） */
  name: string;
  /** グループ名（例: "乃木坂46"）、なければ空文字 */
  groupName: string;
  /**
   * 別名・愛称（3文字以上のみ呼び出し側でフィルタ済みであること）。
   * 短い別名ほど誤爆リスクが高いため、呼び出し側で除外する。
   */
  aliases: string[];
  /**
   * 期別・世代キーワード（例: "4期生"）。
   * PersonMeta.generation から取得。期別商品を本人商品の次に表示する。
   */
  generation?: string;
}

// ── 内部ユーティリティ ──────────────────────────────────────────────────────────

/** スペース・全角スペースを除去して正規化 */
function norm(s: string): string {
  return s.replace(/[\s　]+/g, '');
}

/**
 * title に name（またはスペース除去した norm(name)）が含まれるか判定
 * "遠藤 さくら" と "遠藤さくら" の揺れに対応
 */
function includes(title: string, name: string): boolean {
  if (!name || !title) return false;
  if (title.includes(name)) return true;
  const n = norm(name);
  return n !== name && title.includes(n);
}

// ── 中古・バンドル判定 ──────────────────────────────────────────────────────────

/**
 * 中古商品の判定キーワード。
 * RakutenItem.isUsed フラグ OR タイトルにこれらが含まれる場合に中古扱いとする。
 */
const USED_TITLE_KEYWORDS = [
  '中古', 'USED', 'used', '古本', '中古品',
  '中古 - 良い', '中古 - 非常に良い', '中古 - 可',
  '中古DVD', '中古Blu-ray', '中古本', '中古雑誌',
  '目立った傷や汚れ', '傷や汚れあり', 'やや傷や汚れ',
];

/** まとめ・ランダム・福袋系キーワード（中古ティアと同じ扱いにする） */
const BUNDLE_KEYWORDS = [
  'まとめ売り', 'セット売り', 'まとめ', 'ランダム', '福袋',
];

/** タイトルが中古商品のシグナルを含むか */
export function isUsedByTitle(title: string): boolean {
  const t = title.toLowerCase();
  return USED_TITLE_KEYWORDS.some((kw) => t.includes(kw.toLowerCase()));
}

/** タイトルがバンドル・ランダム系か */
function isBundleByTitle(title: string): boolean {
  return BUNDLE_KEYWORDS.some((kw) => title.includes(kw));
}

// ── スコアリングルール定数 ──────────────────────────────────────────────────────

/**
 * 中古・バンドルティアのオフセット。
 * 全ての中古/バンドル商品が全ての通常新品より低いスコアになるよう
 * 十分に大きな負の値を設定する。
 * (通常新品の最高スコア ≒ 2000 なので -10000 で安全に分離)
 */
const TIER_USED   = -10000;
const TIER_BUNDLE = -8000; // バンドルは中古より少し上（新品の下）

// ── 新品ティア内のスコア ──────────────────────────────────────────────────────

// 本人名マッチング（最重要）
const S_NAME_IN_TITLE  = 500;   // タイトルに人物名
const S_NAME_STARTS    = 500;   // タイトルが人物名で始まる（単独商品シグナル）
const S_PHOTOBOOK      = 300;   // 人物名 + 写真集/フォトブック
const S_FIRST          = 200;   // 人物名 + 1st（1st写真集など）
const S_CALENDAR       = 200;   // 人物名 + カレンダー
const S_COVER_SPECIAL  = 100;   // 人物名 + 表紙/特典/生写真/ポスター

// 説明文・別名
const S_NAME_IN_DESC   = 300;   // 説明文に人物名（タイトルにない場合のみ）
const S_ALIAS          = 250;   // 別名（3文字以上）がタイトルに一致

// グループ・期別
const S_GENERATION     = 200;   // 期別キーワードがタイトルに含まれる
const S_GROUP          = 200;   // グループ名がタイトルに含まれる

// カテゴリキーワードボーナス
const S_CAT_PHOTO      = 150;   // 写真集/フォトブック/カレンダー
const S_CAT_MAGAZINE   = 100;   // 雑誌/表紙/特典/生写真
const S_CAT_MEDIA      = 80;    // Blu-ray/DVD/CD/ライブ

// ── メイン関数 ─────────────────────────────────────────────────────────────────

/**
 * 商品の表示ティアを返す（小さい値ほど上位表示）。
 *
 * | Tier | 分類                            |
 * |------|---------------------------------|
 * |   0  | 本人名あり・新品                 |
 * |   1  | 期別あり・本人名なし・新品       |
 * |   2  | グループあり・期別/本人名なし・新品 |
 * |   3  | 本人名あり・中古                 |
 * |   4  | 期別あり・本人名なし・中古       |
 * |   5  | グループあり・期別/本人名なし・中古 |
 * |   6  | その他中古 / まとめ・ランダム・福袋 |
 * |   7  | その他（グループ名もない新品）   |
 *
 * sortの最優先キーとして使い、同 tier 内のみ calcDisplayScore で細かく順位付けする。
 */
export function calcDisplayTier(
  product: RakutenItem,
  ctx: PersonDisplayContext,
): number {
  const title = product.title ?? '';
  const isUsed   = product.isUsed || isUsedByTitle(title);
  const isBundle = isBundleByTitle(title);

  const { name, groupName, generation } = ctx;
  const nameNormalized = norm(name);
  const isShortName    = name.length <= 2;

  const hasName: boolean = isShortName
    ? (
        title === name ||
        title === nameNormalized ||
        title.startsWith(name + ' ') ||
        title.startsWith(name + '　') ||
        title.startsWith(nameNormalized + ' ') ||
        title.startsWith(nameNormalized + '　') ||
        (' ' + title).includes(' ' + name + ' ') ||
        (' ' + title).includes(' ' + nameNormalized + ' ')
      )
    : includes(title, name);

  const hasGeneration = !!generation && title.includes(generation);
  const hasGroup      = !!groupName && title.includes(groupName);

  // バンドル（まとめ/ランダム/福袋）は新品でも最下位付近に固定
  if (isBundle) return 6;

  if (isUsed) {
    if (hasName)       return 3;
    if (hasGeneration) return 4;
    if (hasGroup)      return 5;
    return 6;
  }

  // 通常新品
  if (hasName)       return 0;
  if (hasGeneration) return 1;
  if (hasGroup)      return 2;
  return 7;
}

/**
 * 商品の表示スコアを計算する。
 *
 * スコアが高いほど同一 tier 内での優先度が高い。
 * tier 間の比較には calcDisplayTier を使うこと（このスコアだけで全体ソートしない）。
 *
 * @param product  - 評価対象の商品
 * @param ctx      - 人物コンテキスト（名前・グループ・別名・期別）
 * @returns        - 表示優先度スコア（高いほど上位表示）
 */
export function calcDisplayScore(
  product: RakutenItem,
  ctx: PersonDisplayContext,
): number {
  const title       = product.title ?? '';
  const description = product.description ?? product.catchcopy ?? '';
  const { name, groupName, aliases, generation } = ctx;

  // ──── 中古・バンドルティア判定（先に行う）──────────────────────────────────
  const isUsed   = product.isUsed || isUsedByTitle(title);
  const isBundle = !isUsed && isBundleByTitle(title); // 中古でないバンドル

  // ──── 人物名のタイトルマッチング ────────────────────────────────────────────
  // 2文字以下の短い名前（"あの"、"なお" 等）は誤爆防止のため
  // 冒頭一致または単語境界（スペース前後）のみを有効なマッチとする
  const nameNormalized = norm(name);
  const isShortName    = name.length <= 2;
  const hasName = isShortName
    ? (
        title === name ||
        title === nameNormalized ||
        title.startsWith(name + ' ') ||
        title.startsWith(name + '　') ||
        title.startsWith(nameNormalized + ' ') ||
        title.startsWith(nameNormalized + '　') ||
        (' ' + title).includes(' ' + name + ' ') ||
        (' ' + title).includes(' ' + nameNormalized + ' ')
      )
    : includes(title, name);

  const hasGroup      = !!groupName && title.includes(groupName);
  const hasGeneration = !!generation && title.includes(generation);

  // ──── コンテンツスコア計算 ───────────────────────────────────────────────────
  let score = 0;

  if (hasName) {
    score += S_NAME_IN_TITLE;

    // タイトルが人物名（またはスペース除去した名前）で始まる
    if (title.startsWith(name) || title.startsWith(nameNormalized)) {
      score += S_NAME_STARTS;
    }

    // 写真集 / フォトブック
    const isPhotobook =
      title.includes('写真集') ||
      title.includes('フォトブック') ||
      /photobook/i.test(title) ||
      title.includes('PHOTO BOOK') ||
      title.includes('Photo Book');
    if (isPhotobook) {
      score += S_PHOTOBOOK;
      if (/1st|ファースト|first/i.test(title)) score += S_FIRST;
    }

    // カレンダー
    if (title.includes('カレンダー')) score += S_CALENDAR;

    // 表紙・特典・ポスター・生写真・ブロマイド・トレカ
    if (
      title.includes('表紙') ||
      title.includes('特典') ||
      title.includes('ポスター') ||
      title.includes('生写真') ||
      title.includes('ブロマイド') ||
      title.includes('トレカ')
    ) {
      score += S_COVER_SPECIAL;
    }
  }

  // 説明文に人物名（タイトルにない場合のみ加点）
  if (!hasName && description && includes(description, name)) {
    score += S_NAME_IN_DESC;
  }

  // 別名マッチング（3文字以上のみ・最初の1件だけ加点）
  for (const alias of aliases) {
    if (title.includes(alias)) {
      score += S_ALIAS;
      break;
    }
  }

  // 期別キーワード（タイトルに人物名がない場合のみ加点。人物名ありなら人物点で十分）
  if (hasGeneration && !hasName) {
    score += S_GENERATION;
  }

  // グループ名（人物名があってもなくても加点。人物名なしでもグループ商品と判断できる）
  if (hasGroup) {
    score += S_GROUP;
  }

  // カテゴリキーワードボーナス（タイトルのみ）
  if (
    title.includes('写真集') ||
    title.includes('フォトブック') ||
    title.includes('カレンダー') ||
    /photobook/i.test(title)
  ) {
    score += S_CAT_PHOTO;
  }

  if (
    title.includes('雑誌') ||
    title.includes('表紙') ||
    title.includes('特典') ||
    title.includes('ポスター') ||
    title.includes('生写真') ||
    title.includes('ブロマイド')
  ) {
    score += S_CAT_MAGAZINE;
  }

  if (
    title.includes('Blu-ray') ||
    title.includes('ブルーレイ') ||
    title.includes('DVD') ||
    title.includes('CD') ||
    title.includes('ライブ') ||
    title.includes('コンサート') ||
    title.includes('番組')
  ) {
    score += S_CAT_MEDIA;
  }

  // ──── ティアオフセット適用 ─────────────────────────────────────────────────
  // 中古・バンドルは通常新品の最高スコア（~2000）を大きく下回るオフセットを加える。
  // これにより「本人名入り中古」が「グループのみ新品」より上に来るのを防ぐ。
  if (isUsed) {
    score += TIER_USED;
  } else if (isBundle) {
    score += TIER_BUNDLE;
  }

  return score;
}

/**
 * 商品リストを本人商品優先でソート。
 *
 * 並び順:
 *   1. 本人名入り新品（スコア高い順）
 *   2. 期別新品
 *   3. グループ新品
 *   4. 中古・バンドル（スコア高い順）
 *
 * タイスコアの場合は従来ロジック（画像有無→レビュー数）で安定ソートを保つ。
 */
export function sortProductsByPerson(
  products: RakutenItem[],
  ctx: PersonDisplayContext,
): RakutenItem[] {
  return [...products].sort((a, b) => {
    const sa = calcDisplayScore(a, ctx);
    const sb = calcDisplayScore(b, ctx);
    if (sb !== sa) return sb - sa; // スコア降順

    // 同点の場合: 既存ロジックで安定化
    const aImg = a.imageUrl ? 0 : 1;
    const bImg = b.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;

    return (b.reviewCount * (b.reviewAverage || 0)) -
           (a.reviewCount * (a.reviewAverage || 0));
  });
}
