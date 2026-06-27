// グループ名またはジャンルからHeroセクションのグラデーション背景を返す
// グループ名が優先。該当なければジャンル別、それもなければデフォルト。

const GROUP_GRADIENT: Record<string, readonly [string, string]> = {
  '乃木坂46': ['#7C3AED', '#A855F7'],  // 紫系
  '櫻坂46':   ['#F472B6', '#FB7185'],  // 桜ピンク系
  '日向坂46': ['#38BDF8', '#60A5FA'],  // 空色・水色系
};

const GENRE_GRADIENT: Record<string, readonly [string, string]> = {
  '坂道':         ['#DB2777', '#E11D48'],  // ピンク・ローズ
  '芸人':         ['#F59E0B', '#EA580C'],  // アンバー・オレンジ
  'テレビ':       ['#0284C7', '#1D4ED8'],  // スカイ・ブルー
  'アーティスト': ['#7C3AED', '#6B21A8'],  // バイオレット
  '俳優':         ['#059669', '#065F46'],  // エメラルド
};

const DEFAULT_GRADIENT: readonly [string, string] = ['#3730A3', '#4F46E5'];

/**
 * グループ名・ジャンルからHero用 CSS background 文字列を返す
 * 使用例: style={{ background: getGroupHeroGradient(person.group, person.genre) }}
 */
export function getGroupHeroGradient(groupName?: string | null, genre?: string | null): string {
  const [from, to] =
    (groupName && GROUP_GRADIENT[groupName]) ||
    (genre && GENRE_GRADIENT[genre]) ||
    DEFAULT_GRADIENT;
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
