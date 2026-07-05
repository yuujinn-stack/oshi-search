// 人物カードに渡す任意のメタフィールド
export interface PersonCardMeta {
  primaryGenre?: string;
  genres?: string | string[];
  activityStatus?: string;
  generation?: string;
}

// 人物カード用バッジ生成（重複除去・最大 maxBadges 件）
// 優先順: primaryGenre → genres（分割後） → genre → 卒業/脱退 → generation
export function getPersonCardBadges(
  genre: string,
  meta?: PersonCardMeta,
  maxBadges = 4,
): string[] {
  const seen = new Set<string>();
  const badges: string[] = [];

  function push(v: string | null | undefined) {
    const s = v?.trim();
    if (s && !seen.has(s)) { seen.add(s); badges.push(s); }
  }

  push(meta?.primaryGenre);
  for (const g of splitGenres(meta?.genres)) push(g);
  push(genre);
  if (meta?.activityStatus === 'graduated') push('卒業');
  else if (meta?.activityStatus === 'withdrawn') push('脱退');
  push(meta?.generation);

  return badges.slice(0, maxBadges);
}

export const DEFAULT_GENRE_ORDER = [
  '坂道', 'アイドル', '元アイドル', '女優', '俳優', 'タレント', 'モデル',
  '歌手', 'アーティスト', '声優', '芸人', 'テレビ', 'バラエティ',
  'アナウンサー', '作家', '小説家', '漫画家', '脚本家', '映画監督',
  '監督', 'プロデューサー', 'クリエイター', 'YouTuber', 'インフルエンサー',
  'ダンサー', 'スポーツ選手', 'アスリート',
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
