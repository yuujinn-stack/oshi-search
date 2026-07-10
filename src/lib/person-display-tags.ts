/**
 * 人物ページ・検索結果・グループページ向け 表示用タグ整理ユーティリティ
 *
 * 元データ（DB / Redis）は変更しない。表示時だけ正規化・重複除去を行う。
 *
 * 適用対象:
 *   - 人物ページ ヒーローバッジ
 *   - 人物情報セクション ジャンル行
 *   - 人物カード（PersonCard / getPersonCardBadges）
 *   - 検索結果カード
 */

// ── 表記ゆれ正規化マップ ──────────────────────────────────────────────────────
// キー: DB に入っている可能性がある表記 / 値: 統一後の表示文字列
export const GENRE_NORMALIZE_MAP: Record<string, string> = {
  // 俳優・女優系
  '役者':             '俳優',

  // 音楽系
  'ミュージシャン':   'アーティスト',

  // YouTube / SNS系
  'Youtuber':        'YouTuber',
  'youtuber':        'YouTuber',
  'ユーチューバー':   'YouTuber',
  'SNS':             'インフルエンサー',

  // グループ名ゆれ（略称 → 正式名）
  '乃木坂':          '乃木坂46',
  '日向坂':          '日向坂46',
  '櫻坂':            '櫻坂46',
  '欅坂':            '欅坂46',
  '=LOVE':           '＝LOVE',
  'イコラブ':        '＝LOVE',
  'ノイミー':        '≠ME',
  'ニアジョイ':      '≒JOY',
};

// ── 無効値セット ──────────────────────────────────────────────────────────────
// これらの値はタグとして表示しない
const INVALID_TAG_VALUES = new Set([
  '', 'undefined', 'null', '不明', 'unknown', 'none', 'n/a', '-', '—',
]);

/**
 * 1つのタグ文字列を正規化する。
 * - trim → 無効値チェック → 表記ゆれ正規化
 * @returns 正規化後の文字列、または null（無効値の場合）
 */
export function normalizeTag(tag: string | null | undefined): string | null {
  if (tag == null) return null;
  const t = tag.trim();
  if (!t || INVALID_TAG_VALUES.has(t) || INVALID_TAG_VALUES.has(t.toLowerCase())) return null;
  return GENRE_NORMALIZE_MAP[t] ?? t;
}

/**
 * タグ配列またはカンマ区切り文字列を正規化済み配列に変換する。
 * 重複は呼び出し側の seen Set で管理するため、ここでは除去しない。
 */
export function normalizeTags(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : value.split(',');
  return arr.map(normalizeTag).filter((v): v is string => v !== null);
}

// ── ヒーローバッジ用タグ生成 ──────────────────────────────────────────────────

export interface PersonTagInput {
  /** 基本ジャンル（person.genre） */
  genre?: string;
  /** メイン肩書き（hero 副題として別表示されるため badges では除外） */
  primaryGenre?: string;
  /** ジャンル配列（personMeta.genres） */
  genres?: string[] | null;
  /** 肩書き（personMeta.titles） */
  titles?: string[] | null;
}

/**
 * 人物ページ ヒーロー部分のバッジ表示用タグを生成する。
 *
 * - primaryGenre はヒーロー副題として別途表示されるため badges からは除外
 * - genre は呼び出し側が GENRE_BADGE スタイルつきで別途表示するため除外
 * - titles の重複・無効値を除去して返す
 *
 * @returns 重複なし・正規化済みの titles タグ配列
 */
export function buildHeroBadgeTitles(
  input: PersonTagInput,
): string[] {
  const { primaryGenre, genre, titles } = input;
  const excludeNorm = new Set<string>();
  const normPrimary = normalizeTag(primaryGenre);
  const normGenre   = normalizeTag(genre);
  if (normPrimary) excludeNorm.add(normPrimary);
  if (normGenre)   excludeNorm.add(normGenre);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const t of normalizeTags(titles ?? [])) {
    if (!excludeNorm.has(t) && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}

/**
 * 人物情報セクション「ジャンル」行に表示するジャンルリストを生成する。
 *
 * 優先順: primaryGenre → genres → genre
 * 重複・無効値を除去して返す。
 */
export function buildInfoGenreList(
  input: Pick<PersonTagInput, 'genre' | 'primaryGenre' | 'genres'>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function push(v: string | null | undefined): void {
    const norm = normalizeTag(v);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }

  push(input.primaryGenre);
  for (const g of normalizeTags(input.genres ?? [])) push(g);
  push(input.genre);

  return result;
}

/**
 * 人物カード（PersonCard / SearchResultCard）向け badges を生成する。
 *
 * 優先順: primaryGenre → genres → genre → 卒業/脱退 → generation
 * 重複・無効値を除去して maxBadges 件に制限する。
 */
export function buildCardBadges(
  genre: string | undefined,
  meta?: {
    primaryGenre?: string;
    genres?: string | string[] | null;
    activityStatus?: string;
    generation?: string;
  },
  maxBadges = 4,
): string[] {
  const seen = new Set<string>();
  const badges: string[] = [];

  function push(v: string | null | undefined): void {
    const norm = normalizeTag(v);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      badges.push(norm);
    }
  }

  push(meta?.primaryGenre);
  for (const g of normalizeTags(meta?.genres ?? [])) push(g);
  push(genre);
  if (meta?.activityStatus === 'graduated')  push('卒業');
  else if (meta?.activityStatus === 'withdrawn') push('脱退');
  push(meta?.generation);

  return badges.slice(0, maxBadges);
}
