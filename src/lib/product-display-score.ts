/**
 * 人物ページ商品表示スコア計算
 *
 * ・表示時の並び順だけを決める純粋関数
 * ・DB / Redis への書き込みなし
 * ・既存の relevanceScore / AI 判定 / verdict には一切影響しない
 * ・既に verdict=related でフィルタ済みの商品一覧内でスコアを付ける
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

// 中古タイトル判定（page.tsx と同一パターン）
const USED_PATTERNS = [
  '中古', 'used', '古本', '中古品',
  '目立った傷や汚れ', '傷や汚れあり', 'やや傷や汚れ',
];
function isUsedTitle(title: string): boolean {
  const t = title.toLowerCase();
  return USED_PATTERNS.some((p) => t.includes(p.toLowerCase()));
}

// ── スコアリングルール定数 ──────────────────────────────────────────────────────

// 人物名タイトル一致 ─ 基本点
const S_NAME_IN_TITLE   = 500;
// 人物名がタイトル冒頭に（単独商品の強いシグナル）
const S_NAME_STARTS     = 500;
// 写真集 + 人物名
const S_PHOTOBOOK       = 300;
// 1st写真集 など「1st」付き
const S_FIRST           = 200;
// カレンダー + 人物名
const S_CALENDAR        = 200;
// 表紙・特典・生写真・ポスター + 人物名
const S_COVER_SPECIAL   = 100;
// 説明文に人物名（タイトルにない場合のみ）
const S_NAME_IN_DESC    = 300;
// 別名がタイトルに一致
const S_ALIAS           = 250;
// グループ名がタイトルに含まれる
const S_GROUP           = 200;
// グループ名しかなく人物名なし（相殺 + 追加減点）
const P_GROUP_ONLY      = -(S_GROUP + 300); // +200 - 500 = -300 net
// 写真集 / フォトブック / カレンダー カテゴリボーナス
const S_CAT_PHOTO       = 150;
// 雑誌 / 表紙 / 特典系カテゴリボーナス
const S_CAT_MAGAZINE    = 100;
// Blu-ray / DVD / CD / ライブカテゴリボーナス
const S_CAT_MEDIA       = 80;
// まとめ売り・セット・ランダム・福袋
const P_BUNDLE          = -150;
// 中古かつ人物名なし
const P_USED_NO_NAME    = -50;

// ── メイン関数 ─────────────────────────────────────────────────────────────────

/**
 * 商品の表示スコアを計算する。
 * スコアが高いほど人物との関連性が強い本人商品と判断する。
 *
 * @param product  - 評価対象の商品
 * @param ctx      - 人物コンテキスト（名前・グループ・別名）
 * @returns        - 表示優先度スコア（高いほど上位表示）
 */
export function calcDisplayScore(
  product: RakutenItem,
  ctx: PersonDisplayContext,
): number {
  const title       = product.title ?? '';
  const description = product.description ?? product.catchcopy ?? '';
  const { name, groupName, aliases } = ctx;

  let score = 0;

  // ──── 人物名のタイトルマッチング ────────────────────────────────────────────
  // 2文字以下の短い名前（"あの"、"なお" 等）は誤爆防止のため
  // 冒頭一致または単語境界（スペース前後）のみを有効なマッチとする
  const nameNormalized = norm(name);
  const isShortName = name.length <= 2;
  const hasName = isShortName
    ? (
        title === name ||
        title === nameNormalized ||
        title.startsWith(name + ' ') ||
        title.startsWith(name + '　') ||
        title.startsWith(nameNormalized + ' ') ||
        title.startsWith(nameNormalized + '　') ||
        // スペースで囲まれた完全一致（タイトル中間にある場合）
        (' ' + title).includes(' ' + name + ' ') ||
        (' ' + title).includes(' ' + nameNormalized + ' ')
      )
    : includes(title, name);

  const hasGroup = !!groupName && title.includes(groupName);

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

  // ──── 説明文に人物名（タイトルにない場合のみ加点） ──────────────────────────
  if (!hasName && description && includes(description, name)) {
    score += S_NAME_IN_DESC;
  }

  // ──── 別名マッチング（3文字以上のみ・最初の1件だけ加点） ──────────────────
  for (const alias of aliases) {
    if (title.includes(alias)) {
      score += S_ALIAS;
      break;
    }
  }

  // ──── グループ名 ─────────────────────────────────────────────────────────────
  if (hasGroup) {
    score += S_GROUP;
    if (!hasName) {
      // グループ名のみ・人物名なし → 大幅減点
      score += P_GROUP_ONLY; // P_GROUP_ONLY は負の値（S_GROUP を打ち消す + 追加減点）
    }
  }

  // ──── カテゴリキーワードボーナス ─────────────────────────────────────────────
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

  // ──── 減点 ────────────────────────────────────────────────────────────────────
  // まとめ売り・ランダム封入・福袋
  if (
    title.includes('まとめ') ||
    title.includes('セット') ||
    title.includes('ランダム') ||
    title.includes('福袋')
  ) {
    score += P_BUNDLE;
  }

  // 中古かつ人物名なし
  if (!hasName && (product.isUsed || isUsedTitle(title))) {
    score += P_USED_NO_NAME;
  }

  return score;
}

/**
 * 商品リストを本人商品優先でソート。
 * タイスコアの場合は従来ロジック（中古→画像有無→レビュー数）で安定ソートを保つ。
 */
export function sortProductsByPerson(
  products: RakutenItem[],
  ctx: PersonDisplayContext,
): RakutenItem[] {
  // isUsedByTitle は page.tsx 側と同一ロジック
  return [...products].sort((a, b) => {
    const sa = calcDisplayScore(a, ctx);
    const sb = calcDisplayScore(b, ctx);
    if (sb !== sa) return sb - sa; // スコア降順

    // 同点の場合: 既存ロジックで安定化
    const aUsed = (a.isUsed || isUsedTitle(a.title)) ? 1 : 0;
    const bUsed = (b.isUsed || isUsedTitle(b.title)) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;

    const aImg = a.imageUrl ? 0 : 1;
    const bImg = b.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;

    return (b.reviewCount * (b.reviewAverage || 0)) -
           (a.reviewCount * (a.reviewAverage || 0));
  });
}
