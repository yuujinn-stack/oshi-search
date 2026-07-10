import { buildCardBadges } from '@/lib/person-display-tags';

// 人物カードに渡す任意のメタフィールド
export interface PersonCardMeta {
  primaryGenre?: string;
  genres?: string | string[];
  activityStatus?: string;
  generation?: string;
}

// 人物カード用バッジ生成（正規化・重複除去・最大 maxBadges 件）
// 優先順: primaryGenre → genres（分割後） → genre → 卒業/脱退 → generation
export function getPersonCardBadges(
  genre: string,
  meta?: PersonCardMeta,
  maxBadges = 4,
): string[] {
  return buildCardBadges(genre, meta, maxBadges);
}

export const DEFAULT_GENRE_ORDER = [
  // アイドル・芸能
  '坂道', 'アイドル', '元アイドル', 'タレント', 'バラエティ', '芸人', 'テレビ',
  // 俳優・女優・モデル
  '女優', '俳優', '声優', 'モデル', 'グラビア',
  // 音楽
  '歌手', 'アーティスト', 'バンド', 'シンガーソングライター',
  '作詞家', '作曲家', '編曲家', '音楽プロデューサー', 'DJ',
  // 文化・クリエイター
  '作家', '小説家', '漫画家', '脚本家', '映画監督', '監督', 'プロデューサー', 'クリエイター',
  // スポーツ
  'スポーツ選手', 'アスリート', 'ダンサー', 'コーチ',
  // 報道・メディア
  'アナウンサー', 'キャスター', 'コメンテーター',
  // その他
  'YouTuber', 'インフルエンサー', '実業家', '政治家', '研究者', '文化人', '芸能界引退',
] as const;

// カンマ区切り文字列または配列をジャンルの配列に変換
export function splitGenres(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : value.split(',');
  return arr.map((s) => s.trim()).filter(Boolean);
}

// ジャンルリストを DEFAULT_GENRE_ORDER 順でソート + 残りは50音順
export function sortGenreList(genres: Iterable<string>): string[] {
  const set = new Set(genres);
  const defaultSet = new Set<string>(DEFAULT_GENRE_ORDER);
  const ordered = DEFAULT_GENRE_ORDER.filter((g) => set.has(g));
  const extras = [...set]
    .filter((g) => !defaultSet.has(g))
    .sort((a, b) => a.localeCompare(b, 'ja'));
  return [...ordered, ...extras];
}
