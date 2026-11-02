// 動画「登録グループ紹介」の配色（黄色基調のかわいいデザイン。推しサーチのアイコンの黄色）。管理画面のプレビュー（RegisteredGroupsPicker の RegisteredPreview）が使う。
// 完成動画は oshi-video-maker の src/compositions/registered/OshiRegisteredGroups.tsx が描く。どちらかの色を変えるときは両方を同じ値にする
// （以前はプレビューだけ濃紺の背景を直書きしていて、完成動画と見た目が違っていた）。
// 背景は淡い黄色・クリーム色。黒・濃いネイビーの背景は使わない。

export const REGISTERED_VIDEO_COLORS = {
  /** 背景（上 → 中 → 下）: クリーム色 → 淡い黄色 */
  bgTop: '#FFFDF4',
  bgMid: '#FFF7D6',
  bgBottom: '#FFEFB8',
  /** メインの明るい黄色（冒頭の件数のラベル・締めの見出しのパネル・件数のマーカー）と、その縁の濃いめの黄色 */
  yellow: '#FEE34F',
  yellowDeep: '#F5C400',
  /** 締めの補足のラベルの枠（淡いピンク） */
  pink: '#FFB5C8',
  /** グループ名のカード: 白 + 淡い黄色の枠 */
  surface: '#FFFFFF',
  line: '#F6DC7C',
  /** 文字: 見出し（濃いブラウン）・本文（ダークグレー）・補足 */
  head: '#4A2E1A',
  ink: '#3B342F',
  muted: '#6B5544',
} as const;

/** ラベルの色: soft=背景、ink=文字（soft の上で 4.5:1 以上） */
export type RegisteredAccent = { main: string; soft: string; ink: string };
const YELLOW: RegisteredAccent = { main: '#F5C400', soft: '#FFF0A8', ink: '#7A4A00' };
const BLUE: RegisteredAccent = { main: '#3B82F6', soft: '#DBEAFE', ink: '#1D4ED8' };
const PINK: RegisteredAccent = { main: '#EC4899', soft: '#FCE7F3', ink: '#BE185D' };
const MINT: RegisteredAccent = { main: '#10B981', soft: '#D1FAE5', ink: '#047857' };
const GRAY: RegisteredAccent = { main: '#64748B', soft: '#E2E8F0', ink: '#334155' };

/** 一覧の見出し（ジャンル）ごとの淡い色。知らない見出し（「登録グループの一部」など）は黄色 */
const HEADING_ACCENT: Record<string, RegisteredAccent> = {
  男性アイドル: BLUE,
  女性アイドル: PINK,
  'バンド・アーティスト・お笑いなど': MINT,
  分類なし: GRAY,
};

export function registeredHeadingAccent(heading: string): RegisteredAccent {
  return HEADING_ACCENT[heading] ?? YELLOW;
}
