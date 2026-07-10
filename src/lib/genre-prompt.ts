/**
 * ChatGPT プロンプト向けジャンル定義ユーティリティ
 *
 * このファイルの定義は、表示用正規化（person-display-tags.ts）および
 * DEFAULT_GENRE_ORDER（genre-utils.ts）と一致させてください。
 * プロンプト生成側で独自ジャンル一覧を持たないことで、DB保存値と表示タグが一致します。
 */

import { DEFAULT_GENRE_ORDER } from './genre-utils';

// ── 表記ゆれ禁止ルール ────────────────────────────────────────────────────────
// [誤表記, 正規表記] のペア。GENRE_NORMALIZE_MAP と対応する。
const TYPO_RULES: [wrong: string, correct: string][] = [
  ['Youtuber / youtuber',  'YouTuber'],
  ['ユーチューバー',         'YouTuber'],
  ['SNS',                  'インフルエンサー'],
  ['ミュージシャン',         'アーティスト'],
  ['シンガー',               '歌手 または アーティスト'],
  ['役者',                  '俳優'],
  ['乃木坂（略称）',         '乃木坂46（正式名称）'],
  ['日向坂（略称）',         '日向坂46（正式名称）'],
  ['櫻坂（略称）',           '櫻坂46（正式名称）'],
  ['欅坂（略称）',           '欅坂46（正式名称）'],
  ['=LOVE（半角）',         '＝LOVE（全角）'],
  ['イコラブ',               '＝LOVE'],
  ['ノイミー',               '≠ME'],
  ['ニアジョイ',             '≒JOY'],
  ['文筆家（genresに）',     '作家 または titles に文筆家'],
  ['芸能界引退（genresに）', 'careerStatus=retired か genres の補助扱い'],
  ['声優アイドル（genresに）','声優 / アイドル のどちらかを genres に入れ、titles に声優アイドル'],
  ['司会者（genresに）',     'publicRoles に 司会者 として記載する'],
];

/** 全 canonical ジャンル一覧をスラッシュ区切り文字列で返す */
export function getCanonicalGenreListStr(): string {
  return Array.from(DEFAULT_GENRE_ORDER).join(' / ');
}

/**
 * プロンプト向けジャンルルールブロックを返す。
 * genre / primaryGenre / genres / titles / publicRoles の使い分けと表記ゆれ禁止ルールを含む。
 */
export function buildGenreRulesBlock(): string {
  return [
    '━━━━━━━━━━━━━━━━━━',
    'ジャンル使い分けルール（必読）',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '【genre（基本ジャンル）】',
    '以下の canonical 値のいずれかを使用してください（表記ゆれ厳禁）:',
    getCanonicalGenreListStr(),
    '',
    'グループアイドルの場合:',
    '  → groupName: 乃木坂46 / 日向坂46 / 櫻坂46 / ＝LOVE / ≠ME / ≒JOY 等（正式名称）',
    '  → genre: 坂道 または アイドル を使用する（グループ名をgenreに入れない）',
    '',
    '【primaryGenre（主ジャンル・単一）】',
    '2026年現在の主な活動ジャンルを1つだけ記載してください。',
    '例: 女優 / 俳優 / アイドル / タレント / 芸人 / 歌手 / アーティスト / YouTuber',
    '不明な場合は空欄（推測しない）。',
    '',
    '【genres（複数ジャンル・カンマ区切り）】',
    '現在を先頭に、過去ジャンルは後に並べてください。canonical 表記のみ使用。',
    '例: 女優,タレント,元アイドル',
    '例: 歌手,タレント,アーティスト',
    '例: 芸人,タレント',
    '例: YouTuber,インフルエンサー',
    '',
    '【titles（世間的な肩書き・称号）】',
    'genres に収まらない肩書き・称号を記載。カンマ区切り。',
    '例: モデル,ラジオパーソナリティ,声優アイドル',
    '',
    '【publicRoles（役職・番組上の立場）】',
    '職種・役職を記載。カンマ区切り。',
    '例: 司会者,キャスター,コメンテーター,振付師',
    '※ 司会者は genres ではなく必ず publicRoles に記載してください。',
    '',
    '━━ 表記ゆれ禁止ルール ━━',
    '',
    ...TYPO_RULES.map(([wrong, correct]) => `  ✗ ${wrong}  →  ○ ${correct}`),
  ].join('\n');
}

/** プロンプト向け分類例ブロックを返す */
export function buildGenreExamplesBlock(): string {
  return [
    '━━ 分類例 ━━',
    '',
    '賀喜遥香（乃木坂46 現役）:',
    '  groupName=乃木坂46 / genre=坂道 / primaryGenre=アイドル',
    '  genres=アイドル,坂道 / titles= / publicRoles=',
    '',
    '加藤史帆（元日向坂46・現在は女優）:',
    '  groupName= / genre=女優 / primaryGenre=女優',
    '  genres=女優,タレント,元アイドル / titles= / publicRoles=',
    '',
    '春日俊彰（オードリー）:',
    '  groupName=オードリー / genre=芸人 / primaryGenre=芸人',
    '  genres=芸人,タレント / titles= / publicRoles=司会者',
    '',
    'あの:',
    '  groupName= / genre=アーティスト / primaryGenre=歌手',
    '  genres=歌手,タレント,アーティスト / titles= / publicRoles=',
    '',
    'YouTuber系:',
    '  groupName= / genre=YouTuber / primaryGenre=YouTuber',
    '  genres=YouTuber,インフルエンサー / titles= / publicRoles=',
    '',
    '元アイドルで女優中心:',
    '  groupName= / genre=女優 / primaryGenre=女優',
    '  genres=女優,タレント,元アイドル / titles= / publicRoles=',
  ].join('\n');
}
