/**
 * 作品の「表示用分類」を返すユーティリティ。
 *
 * DB の WorkRecord.type (movie / tv / variety / anime) は粗い分類のため、
 * タイトル文字列で細分類した DisplayWorkType を使って人物ページに表示する。
 *
 * 重要: DB・Redis の作品データは変更しない。あくまで表示用の分類。
 *
 * 判定優先順位（実体は DISPLAY_TYPE_RULES 配列。この一覧はその説明用コピー）:
 *   1. ライブ・コンサート (live)
 *   2. ドキュメンタリー    (documentary)
 *   3. 舞台・ミュージカル  (stage)
 *   4. アイドル番組        (idol_show)
 *   5. 音楽番組            (music)
 *   6. ドラマ              (drama)
 *   6.5 劇場公開マーカー   (movie_marker: workType='movie'かつ「劇場版」「THE MOVIE」を含む場合のみ)
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

// STAGE_KEYWORDS の「劇場」は劇場“会場”（帝国劇場・梅田芸術劇場等）を指す想定だが、
// 「劇場版」は映画の公開形態を示す一般的な用語（例:「○○ 劇場版」）で舞台とは無関係。
// 「劇場」は「劇場版」の部分文字列としても一致してしまうため、stage 判定の際だけ
// 「劇場版」という並びを取り除いてから STAGE_KEYWORDS と照合する
// （TYPE_MAPPING_BUG: 修正前は「劇場版」を含むタイトルが誤って stage と判定されていた）。
function matchesStageKeywords(title: string): boolean {
  return matchesAny(title.replaceAll('劇場版', ''), STAGE_KEYWORDS);
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
  // 監査で確認済み: DB保存済みoverviewに「ドキュメントバラエティ番組」と明記
  '乃木坂、逃避行。',
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
  // 監査で確認済み: DB保存済みoverviewにジャンルが明記されているもの
  //（沸騰ワード10=「バラエティ番組」、有吉の壁=お笑い企画番組、
  // 　オードぜひ=「深夜バラエティ番組」、ヒロミのおせっ買い=「ロケバラエティ番組」、
  // 　春日ロケーション=「旅番組」、テレビギャング=バラエティ番組MC陣による企画番組）
  '沸騰ワード10', '有吉の壁', '会ってほしい人がいるんです',
  'ヒロミのおせっ買い', '春日ロケーション', 'テレビギャング',
] as const;

// ── ⑧ 映画キーワード ────────────────────────────────────────────────────────
const MOVIE_KEYWORDS = [
  '映画', '劇場版', 'Movie', 'FILM', 'film',
] as const;

// ── ⑨ 配信番組・Web ─────────────────────────────────────────────────────────
// 配信ドラマ/ライブ/アイドル番組は先の判定で catch 済み
const WEB_KEYWORDS = [
  'のぎ動画', 'ひな図書', 'ひなこい', 'SHOWROOM',
  // 監査で確認済み: DB保存済みoverviewに「のぎ動画」発の解説コンテンツと明記
  '久保チャンネル',
  'ABEMAオリジナル', 'Leminoオリジナル',
  'YouTubeオリジナル', 'YouTubePremium',
] as const;

// ── ⑩ アニメ・声優 ──────────────────────────────────────────────────────────
const ANIME_VOICE_KEYWORDS = [
  'アニメ', 'anime', '声優', '吹替', 'ナレーション',
] as const;

// ── メイン関数 ───────────────────────────────────────────────────────────────
//
// 判定優先順位（ファイル冒頭のコメントと同一の唯一の定義。優先順位を変更する
// 場合はこの配列だけを編集すればよく、コメントとロジックが別々に乖離すること
// を防ぐ）。getDisplayWorkType() と getDisplayWorkTypeTrace() は同じ配列を
// 参照するため、判定ロジックが複数箇所へ重複することはない。
interface DisplayTypeRule {
  /** 監査・デバッグ用のルール名（getDisplayWorkTypeTrace の戻り値にのみ使用） */
  name: string;
  match: (type: WorkRecord['type'], title: string, overview: string) => boolean;
  result: DisplayWorkType;
}

// 「劇場版」「THE MOVIE」は、TV番組発のスピンオフ映画等に頻出する明確な劇場公開
// マーカー。workType が既に 'movie'（TMDb等で映画と確認済み）の場合に限り、
// 他カテゴリのキーワード（例: VARIETYの番組名キーワード）より優先してmovieと
// 判定する。type==='movie'を条件にすることで、tv番組のタイトルに同じ文字列が
// たまたま含まれていても誤反応しない（監査で確認したCONFIRMED_WRONG事例:
// 「ゴッドタン キス我慢選手権 THE MOVIE」がVARIETYの「ゴッドタン」に先に一致していた）。
const MOVIE_MARKER_PATTERNS = ['劇場版', 'THE MOVIE'] as const;
function hasMovieMarker(title: string): boolean {
  return MOVIE_MARKER_PATTERNS.some((p) => title.includes(p));
}

// movie_marker は、より具体的な舞台・アイドル番組・音楽番組・ドラマの
// キーワードに一致する場合はそちらを優先させたいため、drama(⑥)の直後・
// variety(⑦)の直前に配置する（VARIETYの「ゴッドタン」等の番組名キーワードに
// 先に一致してしまう問題だけを狙って修正し、より具体的な他カテゴリの判定は
// 変更しない）。
const DISPLAY_TYPE_RULES: readonly DisplayTypeRule[] = [
  { name: 'live',         match: (_t, title) => matchesAny(title, LIVE_KEYWORDS), result: 'live' },
  { name: 'documentary',  match: (_t, title, overview) => matchesAny(title, DOCUMENTARY_TITLE_KEYWORDS) || matchesAny(overview, DOCUMENTARY_OVERVIEW_KEYWORDS), result: 'documentary' },
  { name: 'stage',        match: (_t, title) => matchesStageKeywords(title), result: 'stage' },
  { name: 'idol_show',    match: (_t, title) => matchesAny(title, IDOL_SHOW_KEYWORDS), result: 'idol_show' },
  { name: 'music',        match: (_t, title) => matchesAny(title, MUSIC_KEYWORDS), result: 'music' },
  { name: 'drama',        match: (_t, title) => matchesAny(title, DRAMA_KEYWORDS), result: 'drama' },
  { name: 'movie_marker', match: (type, title) => type === 'movie' && hasMovieMarker(title), result: 'movie' },
  { name: 'variety',      match: (_t, title) => matchesAny(title, VARIETY_KEYWORDS), result: 'variety' },
  { name: 'movie',        match: (_t, title) => matchesAny(title, MOVIE_KEYWORDS), result: 'movie' },
  { name: 'web',          match: (_t, title) => matchesAny(title, WEB_KEYWORDS), result: 'web' },
  { name: 'anime_voice',  match: (_t, title) => matchesAny(title, ANIME_VOICE_KEYWORDS), result: 'anime_voice' },
];

// 上記のどのキーワードにも一致しなかった場合の、DB の workType からの推定値。
// 未知の workType（DB不整合等）は意図的にここへ含めず、危険なカテゴリへ
// 自動変換しない安全な 'other' へ落ちる（getDisplayWorkTypeTrace 参照）。
const TYPE_FALLBACK: Partial<Record<WorkRecord['type'], DisplayWorkType>> = {
  tv:      'drama',   // tv の残りはドラマが最多
  movie:   'movie',
  variety: 'variety',
  anime:   'anime_voice',
};

export interface DisplayWorkTypeTrace {
  result: DisplayWorkType;
  /** 'manual_override' | キーワードルール名 | 'type_fallback:<workType>' | 'other_fallback' */
  rule: string;
}

/**
 * 作品の表示用分類を、判定根拠（rule）付きで返す。
 * DB の workType は変更しない。タイトル文字列で判定する表示専用の値。
 * 監査・デバッグ用途で「キーワード一致による確定的な分類」と「workType からの
 * 推測フォールバック」を区別したい場合はこちらを使う。
 */
export function getDisplayWorkTypeTrace(work: WorkRecord): DisplayWorkTypeTrace {
  // ① 保存済み明示カテゴリを最優先（CSVインポートで設定した値）
  if (work.workDisplayType) return { result: work.workDisplayType, rule: 'manual_override' };

  const title    = work.title    ?? '';
  const overview = work.overview ?? '';

  for (const rule of DISPLAY_TYPE_RULES) {
    if (rule.match(work.type, title, overview)) return { result: rule.result, rule: rule.name };
  }

  // フォールバック: DB の workType から推定（未知の workType は 'other' へ）
  const fallback = TYPE_FALLBACK[work.type];
  if (fallback) return { result: fallback, rule: `type_fallback:${work.type}` };

  return { result: 'other', rule: 'other_fallback' };
}

/**
 * 作品の表示用分類を返す。
 * DB の workType は変更しない。タイトル文字列で判定する表示専用の値。
 */
export function getDisplayWorkType(work: WorkRecord): DisplayWorkType {
  return getDisplayWorkTypeTrace(work).result;
}
