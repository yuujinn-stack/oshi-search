/**
 * 作品の「表示用分類」を返すユーティリティ。
 *
 * DB の WorkRecord.type (movie / tv / variety / anime) は粗い分類のため、
 * タイトル文字列で細分類した DisplayWorkType を使って人物ページに表示する。
 *
 * 重要: DB・Redis の作品データは変更しない。あくまで表示用の分類。
 *
 * 判定優先順位:
 *   1. ライブ・コンサート (live)
 *   2. ドキュメンタリー    (documentary)
 *   3. 舞台・ミュージカル  (stage)
 *   4. アイドル番組        (idol_show)
 *   5. 音楽番組            (music)
 *   6. ドラマ              (drama)
 *   7. バラエティ          (variety)
 *   8. 映画                (movie)
 *   9. 配信番組・Web       (web)
 *  10. アニメ・声優        (anime_voice)
 *  11. その他              (other)
 */

import type { WorkRecord, DisplayWorkType } from '@/types/work';

// 後方互換のため re-export（既存の import 先に影響しない）
export type { DisplayWorkType };

export const DISPLAY_WORK_TYPE_LABEL: Record<DisplayWorkType, string> = {
  live:         'ライブ・コンサート',
  documentary:  'ドキュメンタリー',
  stage:        '舞台・ミュージカル',
  idol_show:    'アイドル番組',
  music:        '音楽番組',
  drama:        'ドラマ',
  variety:      'バラエティ',
  movie:        '映画',
  web:          '配信番組・Web',
  anime_voice:  'アニメ・声優',
  other:        'その他',
};

export const DISPLAY_WORK_TYPE_ICON: Record<DisplayWorkType, string> = {
  live:         '🎤',
  documentary:  '🎥',
  stage:        '🎭',
  idol_show:    '⭐',
  music:        '🎵',
  drama:        '📺',
  variety:      '😄',
  movie:        '🎬',
  web:          '🌐',
  anime_voice:  '🎙',
  other:        '📽',
};

// ── 順序付き DisplayWorkType リスト（タブ表示順） ────────────────────────────
export const DISPLAY_WORK_TYPE_ORDER: DisplayWorkType[] = [
  'live', 'documentary', 'stage', 'idol_show', 'music',
  'drama', 'variety', 'movie', 'web', 'anime_voice', 'other',
];

// ── 日本語ラベル → DisplayWorkType 正規化マップ ──────────────────────────────
export const DISPLAY_WORK_TYPE_NORMALIZE_MAP: Record<string, DisplayWorkType> = {
  '映画': 'movie',
  'ドラマ': 'drama',
  'バラエティ': 'variety',
  'アイドル番組': 'idol_show',
  'ライブ': 'live',
  'ライブ・コンサート': 'live',
  'コンサート': 'live',
  'ドキュメンタリー': 'documentary',
  '舞台': 'stage',
  '舞台・ミュージカル': 'stage',
  'ミュージカル': 'stage',
  '音楽番組': 'music',
  '配信番組': 'web',
  '配信番組・Web': 'web',
  'Web': 'web',
  'アニメ': 'anime_voice',
  'アニメ・声優': 'anime_voice',
  '声優': 'anime_voice',
  'その他': 'other',
};

const VALID_DISPLAY_WORK_TYPES = new Set<string>([
  'live', 'documentary', 'stage', 'idol_show', 'music',
  'drama', 'variety', 'movie', 'web', 'anime_voice', 'other',
]);

/** CSV等から取り込んだ生の文字列を DisplayWorkType に正規化する。不正値は null を返す。 */
export function normalizeDisplayWorkType(raw: string): DisplayWorkType | null {
  const t = raw.trim();
  if (!t) return null;
  if (VALID_DISPLAY_WORK_TYPES.has(t)) return t as DisplayWorkType;
  return DISPLAY_WORK_TYPE_NORMALIZE_MAP[t] ?? null;
}

// ── 内部ユーティリティ ───────────────────────────────────────────────────────

function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

// ── ① ライブ・コンサート ────────────────────────────────────────────────────
// THEATER MILANO-Za はライブ会場のためライブ優先（STAGE の THEATER より先に判定）
const LIVE_KEYWORDS = [
  'LIVE', 'Live', 'ライブ', 'コンサート',
  'BIRTHDAY LIVE', 'MEMORIAL LIVE', 'MTV Unplugged',
  'ARENA TOUR', 'HALL TOUR', 'STADIUM TOUR', 'DOME TOUR',
  'ひな誕祭', 'ひなくり',
  'W-KEYAKI FES', 'W-KEYAKI FES.',
  '東京ドーム', '横浜スタジアム',
  '卒業コンサート', '卒業セレモニー',
  'THEATER MILANO-Za',
  'Happy Train Tour', 'Happy Magical Tour', 'MONSTER GROOVE',
  '4期生ライブ', '5期生ライブ',
  'MEMORIAL LIVE',
  // TOUR 単体は末尾に配置（アーティストページでは概ねコンサートツアー）
  ' TOUR', 'TOUR ',
] as const;

// ── ② ドキュメンタリー ──────────────────────────────────────────────────────
// 映画 Documentary of 系も含む
const DOCUMENTARY_TITLE_KEYWORDS = [
  'Documentary', 'DOCUMENTARY', 'ドキュメンタリー',
  '密着', '舞台裏', 'メイキング',
  'その涙を誰も知らない', '僕たちの嘘と真実',
  'いつのまにか、ここにいる', '悲しみの忘れ方',
  'アンダードキュメンタリー',
] as const;

const DOCUMENTARY_OVERVIEW_KEYWORDS = [
  'ドキュメンタリー', 'Documentary',
] as const;

// ── ③ 舞台・ミュージカル ────────────────────────────────────────────────────
// THEATER MILANO-Za はライブ優先のためここに含めない（① で先に判定済み）
const STAGE_KEYWORDS = [
  '舞台', 'ミュージカル', 'Musical', '朗読劇', '演劇',
  // 劇場・THEATER は THEATER MILANO-Za 以外を対象
  '劇場', 'THEATER',
  // タイトルで確実に舞台と判断できる作品
  '五等分の花嫁', 'セーラームーン', 'ザンビ THEATER',
  'けものフレンズ', 'あゆみ', '墓場、女子高生',
] as const;

// ── ④ アイドル番組 ──────────────────────────────────────────────────────────
// バラエティ・音楽番組より優先
const IDOL_SHOW_KEYWORDS = [
  // 乃木坂
  '乃木坂工事中', '乃木坂って、どこ？', '乃木坂どこへ',
  '乃木坂スター誕生', '新・乃木坂スター誕生', '乃木坂お試し中',
  'NOGIBINGO',
  // 欅・櫻坂
  '欅って、書けない？', 'そこ曲がったら、櫻坂？', 'サクラミーツ',
  'KEYABINGO',
  // 日向坂
  '日向坂で会いましょう', '日向坂になりましょう',
  '日向坂ミュージックパレード', '新・日向坂ミュージックパレード',
  'HINABINGO',
  // ＝LOVE系
  'イコノイジョイ', 'イコラブ', 'ノイミー', 'ニアジョイ',
  '＝LOVE', '≠ME', '≒JOY',
] as const;

// ── ⑤ 音楽番組 ──────────────────────────────────────────────────────────────
// 日向坂ミュージックパレード等はアイドル番組が優先（④ で先に判定済み）
const MUSIC_KEYWORDS = [
  'MUSIC STATION', 'ミュージックステーション', 'Mステ',
  'CDTV', 'MTV',
  '紅白歌合戦', 'FNS歌謡祭', 'ベストアーティスト',
  '音楽の日', 'Venue101', 'バズリズム', 'SONGS',
  'ミュージックパレード', '歌番組',
] as const;

// ── ⑥ ドラマキーワード ──────────────────────────────────────────────────────
const DRAMA_KEYWORDS = [
  'ドラマ', '連続ドラマ',
  '火曜ドラマ', '金曜ドラマ', '日曜劇場', '水曜ドラマ',
  '木曜ドラマ', '土曜ドラマ', '月9',
  'NHKドラマ', '大河ドラマ', '朝ドラ',
  'Netflixシリーズ', 'Huluオリジナルドラマ',
] as const;

// ── ⑦ バラエティ ────────────────────────────────────────────────────────────
const VARIETY_KEYWORDS = [
  'バラエティ', '旅番組', 'クイズ',
  'あちこちオードリー', 'しくじり先生', 'アメトーーク',
  '水曜日のダウンタウン', 'ゴッドタン', 'ロンドンハーツ',
  'くりぃむ', 'ブランチ', 'ラヴィット', '踊る！さんま御殿',
  'ネプリーグ', '突破ファイル', '世界まる見え',
  '上田と女が吠える夜', 'めちゃイケ', 'ぐるナイ',
  'しゃべくり', '有吉ぃぃeeeee',
] as const;

// ── ⑧ 映画キーワード ────────────────────────────────────────────────────────
const MOVIE_KEYWORDS = [
  '映画', '劇場版', 'Movie', 'FILM', 'film',
] as const;

// ── ⑨ 配信番組・Web ─────────────────────────────────────────────────────────
// 配信ドラマ/ライブ/アイドル番組は先の判定で catch 済み
const WEB_KEYWORDS = [
  'のぎ動画', 'ひな図書', 'ひなこい', 'SHOWROOM',
  'ABEMAオリジナル', 'Leminoオリジナル',
  'YouTubeオリジナル', 'YouTubePremium',
] as const;

// ── ⑩ アニメ・声優 ──────────────────────────────────────────────────────────
const ANIME_VOICE_KEYWORDS = [
  'アニメ', 'anime', '声優', '吹替', 'ナレーション',
] as const;

// ── メイン関数 ───────────────────────────────────────────────────────────────

/**
 * 作品の表示用分類を返す。
 * DB の workType は変更しない。タイトル文字列で判定する表示専用の値。
 */
export function getDisplayWorkType(work: WorkRecord): DisplayWorkType {
  // ① 保存済み明示カテゴリを最優先（CSVインポートで設定した値）
  if (work.workDisplayType) return work.workDisplayType;

  const title    = work.title    ?? '';
  const overview = work.overview ?? '';

  // ② ライブ・コンサート（キーワード自動判定の最優先）
  if (matchesAny(title, LIVE_KEYWORDS)) return 'live';

  // ② ドキュメンタリー（タイトル + overview も参照）
  if (
    matchesAny(title, DOCUMENTARY_TITLE_KEYWORDS) ||
    matchesAny(overview, DOCUMENTARY_OVERVIEW_KEYWORDS)
  ) return 'documentary';

  // ③ 舞台・ミュージカル
  if (matchesAny(title, STAGE_KEYWORDS)) return 'stage';

  // ④ アイドル番組（バラエティ・音楽番組より優先）
  if (matchesAny(title, IDOL_SHOW_KEYWORDS)) return 'idol_show';

  // ⑤ 音楽番組
  if (matchesAny(title, MUSIC_KEYWORDS)) return 'music';

  // ⑥ ドラマ（キーワード or DB type=tv のフォールバック）
  if (matchesAny(title, DRAMA_KEYWORDS)) return 'drama';

  // ⑦ バラエティ（キーワード or DB type=variety のフォールバック）
  if (matchesAny(title, VARIETY_KEYWORDS)) return 'variety';

  // ⑧ 映画（キーワード or DB type=movie のフォールバック）
  if (matchesAny(title, MOVIE_KEYWORDS)) return 'movie';

  // ⑨ 配信番組・Web
  if (matchesAny(title, WEB_KEYWORDS)) return 'web';

  // ⑩ アニメ・声優（キーワード or DB type=anime のフォールバック）
  if (matchesAny(title, ANIME_VOICE_KEYWORDS)) return 'anime_voice';

  // フォールバック: DB の workType から推定
  if (work.type === 'tv')      return 'drama';       // tv の残りはドラマが最多
  if (work.type === 'movie')   return 'movie';
  if (work.type === 'variety') return 'variety';
  if (work.type === 'anime')   return 'anime_voice';

  return 'other';
}
