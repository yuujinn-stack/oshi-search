// 動画「フォロー獲得リール」10種類（templateCategory=follow_growth）の台本・シーン構成を作る純粋関数（'use client' からも import 可）。
//
// ・画面に出す事実（作品名・出演年・種類・役名・配信サービス）は推しサーチDBの公開作品だけ（サーバーがジョブ作成時にDBから引き直す。
//   src/server/video-jobs/follow-target.ts）。出演予定・新作・配信開始日・配信終了予定日など、DBに無い事実は
//   管理画面で公式情報のURL・確認日時と一緒に入力したものだけを使う（未確認の予定・日付を作らない）。
// ・必要な事実が足りないときは台本を作らず、足りない項目を返す（管理画面に表示し、ジョブも作らない）。
// ・読み: oshi-video-maker の固定辞書（Workerが報告）→ 推しサーチDBの登録読み（pronunciation_readings。読み仮名CSVの取り込み先）
//   → ひらがな・カタカナだけの語はそのまま。どれも無い語は「読み未登録」として返す（推測しない）。
// ・シーンの見た目は oshi-video-maker（src/compositions/follow/）が templateId とシーンの kind で決める。ここではシーンに載せる文字だけを作る。

import type { DisplayWorkType } from '@/types/work';

export const FOLLOW_TEMPLATE_CATEGORY = 'follow_growth' as const;

export const FOLLOW_TEMPLATE_IDS = [
  'follow_three_works',
  'follow_hidden_works',
  'follow_career_timeline',
  'follow_weekly_schedule',
  'follow_role_gap',
  'follow_new_release_backcatalog',
  'follow_new_streaming',
  'follow_streaming_ending',
  'follow_weekend_watch',
  'follow_genre_breakdown',
] as const;
export type FollowTemplateId = (typeof FOLLOW_TEMPLATE_IDS)[number];

export function isFollowTemplateId(id: unknown): id is FollowTemplateId {
  return typeof id === 'string' && (FOLLOW_TEMPLATE_IDS as readonly string[]).includes(id);
}

export type FollowTargetType = 'person' | 'group';
export type FollowFactKind = 'schedule' | 'release' | 'streamStart' | 'streamEnd';

/** 作品の選択条件・入力が必要な事実（管理画面の入力欄とサーバーの検証の両方に使う） */
export interface FollowTemplateSpec {
  works: {
    min: number;
    max: number;
    requireYear?: boolean;
    requireRole?: boolean;
    requireStreaming?: boolean;
    /** 配信先（見放題・無料・レンタル・購入など）が1つ以上確認できる作品だけ選べる */
    requireAvailable?: boolean;
  };
  facts?: { kind: FollowFactKind; min: number; max: number };
  /** 出演予定の対象期間（開始日から7日間）を入力する */
  period?: boolean;
  /** 最後に「迷ったらこれ」として出す作品を選ぶ */
  pick?: boolean;
  /** 1人の人物だけ（グループは選べない） */
  personOnly?: boolean;
  /** 集計に必要な登録作品の最低件数 */
  poolMin?: number;
  /** 管理画面の説明 */
  guide: string;
}

export const FOLLOW_TEMPLATE_SPECS: Record<FollowTemplateId, FollowTemplateSpec> = {
  follow_three_works: { works: { min: 3, max: 3, requireAvailable: true }, guide: '配信先が確認できる出演作品から3本を選びます（選んだ順に紹介。ポイントは出演年・種類・役名・配信状況の登録情報だけ）。' },
  follow_hidden_works: { works: { min: 1, max: 3, requireAvailable: true }, guide: '配信先が確認できる出演作品から、紹介したい作品を1〜3本選びます（「意外な出演作」「まだ観ていないかもしれない作品」として紹介。知名度は断定しません）。' },
  follow_career_timeline: { works: { min: 3, max: 3, requireYear: true }, guide: '出演年が登録された作品から3本を選びます（古い順に並べ替えて年表にします。出演年が無い作品は選べません）。' },
  follow_weekly_schedule: { works: { min: 0, max: 0 }, facts: { kind: 'schedule', min: 1, max: 3 }, period: true, guide: '対象期間と、公式情報で確認できた出演予定（最大3件）を、出典URL・確認日時と一緒に入力します。' },
  follow_role_gap: { works: { min: 2, max: 2, requireRole: true }, personOnly: true, guide: '役名が登録された作品から2本を選びます（1人の人物だけ。役名が無い作品は選べません）。' },
  follow_new_release_backcatalog: {
    works: { min: 2, max: 3 },
    facts: { kind: 'release', min: 1, max: 1 },
    guide: '公式情報で確認した新作（作品名・放送/公開/配信の日付・出典URL・確認日時）と、紹介する過去の出演作2〜3本を選びます。',
  },
  follow_new_streaming: { works: { min: 0, max: 0 }, facts: { kind: 'streamStart', min: 1, max: 2 }, guide: '公式情報で「新しく配信開始」と確認できた作品・サービス・配信開始日（30日以内）を、出典URL・確認日時と一緒に入力します。現在配信中というだけの作品は対象外です。' },
  follow_streaming_ending: { works: { min: 0, max: 0 }, facts: { kind: 'streamEnd', min: 1, max: 2 }, guide: '公式情報で確認できた配信終了予定日（今日以降）を、作品・サービス・出典URL・確認日時と一緒に入力します。終了日を確認できない場合は生成できません。' },
  follow_weekend_watch: { works: { min: 3, max: 3, requireStreaming: true }, pick: true, guide: '見放題・無料で配信中と確認済みの作品から3本と、最後に勧める1本を選びます（視聴時間の表現は使いません）。' },
  follow_genre_breakdown: { works: { min: 0, max: 0 }, poolMin: 3, guide: '推しサーチに登録された出演作品を、サイトの表示分類（ジャンル）で集計します（作品の選択は不要。同じ作品は1件として数えます）。' },
};

// ─── Worker の報告 ───────────────────────────────

/**
 * フォロー獲得リールの各テンプレートに Worker が添える情報。fixedReadings（oshi-video-maker の読みの固定辞書: 人物名・作品名・
 * 配信サービス名）は報告を小さくするため1つのテンプレートにだけ付く（管理画面は全テンプレートの分をまとめて使う）
 */
export interface FollowScriptReport {
  version: 1;
  fixedReadings: Record<string, string>;
}

export function parseFollowScriptReport(raw: unknown): FollowScriptReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const fixedReadings: Record<string, string> = {};
  if (o.fixedReadings && typeof o.fixedReadings === 'object' && !Array.isArray(o.fixedReadings)) {
    for (const [k, v] of Object.entries(o.fixedReadings as Record<string, unknown>).slice(0, 1000)) {
      if (k.length <= 100 && typeof v === 'string' && v.length <= 100) fixedReadings[k] = v;
    }
  }
  return { version: 1, fixedReadings };
}

// ─── 管理画面・サーバーが扱う作品と事実 ───────────────────────────────

export interface FollowStreaming {
  provider: string;
  /** 見放題・無料・広告付き無料 */
  typeLabel: string;
  checkedDate: string | null;
}

/** 確認済みの配信先（公開画面と同じ判定。見放題・無料に限らずレンタル・購入も含む。作品選択欄の表示・絞り込み用） */
export interface FollowAvailability {
  /** 正規化したサービス名（normalizeProviderName。Prime Video の追加チャンネルは本体と別のキー） */
  key: string;
  /** 公開画面の表示名（追加チャンネルは「Prime Video内 ○○」） */
  provider: string;
  /** 見放題・レンタル・購入・無料・広告付き無料 */
  typeLabel: string;
  /** Prime Video の追加チャンネル（別途チャンネル登録が必要） */
  channel: boolean;
}

/** 推しサーチDBの公開作品（グループのときはメンバーの作品を同じ作品ごとにまとめたもの） */
export interface FollowWork {
  id: string;
  title: string;
  year: number | null;
  genre: DisplayWorkType;
  genreLabel: string;
  roleName: string | null;
  /** この作品に出演している対象の人物（人物のときは本人、グループのときは該当メンバー） */
  persons: string[];
  /** 今すぐ見られる配信（見放題・無料・広告付き無料。確認済みの情報だけ） */
  streaming: FollowStreaming[];
  /** 確認済みの配信先すべて（作品選択欄の表示・絞り込みと requireAvailable の判定だけに使う。台本には使わない） */
  available?: FollowAvailability[];
}

export interface FollowFact {
  kind: FollowFactKind;
  /** 配信開始・配信終了: 推しサーチの作品ID */
  workId?: string;
  /** 出演予定・新作: 番組名・作品名 */
  title?: string;
  /** 配信開始・配信終了: 配信サービス名 */
  provider?: string;
  /** 出演予定: 放送局・配信先など（任意） */
  media?: string;
  /** 新作: 放送／公開／配信 */
  releaseKind?: string;
  /** YYYY-MM-DD（出演予定日・新作の日付・配信開始日・配信終了予定日） */
  date: string;
  /** 出演予定: HH:MM（任意） */
  time?: string;
  sourceUrl: string;
  /** 公式情報を確認した日時（YYYY-MM-DDTHH:MM・日本時間） */
  checkedAt: string;
}

export interface FollowSelection {
  selectedWorkIds: string[];
  facts: FollowFact[];
  /** 出演予定の対象期間の開始日（YYYY-MM-DD） */
  periodStart: string | null;
  /** 週末の視聴プラン: 最後に勧める作品 */
  pickWorkId: string | null;
}

// ─── 動画に渡すシーン（oshi-video-maker の FollowScene と同じ形） ───────────────

export type FollowSceneKind = 'hook' | 'item' | 'compare' | 'chart' | 'outro';

export interface FollowScene {
  id: string;
  kind: FollowSceneKind;
  /** 音声なし動画でのシーンの長さ（秒） */
  slotSeconds: number;
  /** 小見出し（例: 1本目・2019年・配信終了予定） */
  label?: string;
  /** 主役の文字（作品名・名前） */
  title?: string;
  /** 補足の行（最大4行） */
  lines?: string[];
  /** バッジ（例: 見放題・NEW） */
  badge?: string;
  /** 年表・比較・出演予定の並び（最大5件） */
  points?: Array<{ label: string; title: string; sub?: string }>;
  /** ジャンル集計の棒グラフ（最大5件） */
  bars?: Array<{ label: string; count: number }>;
  total?: number;
  /** 画面下の小さな注記（確認日・出典・集計の範囲） */
  note?: string;
}

export interface FollowLine {
  id: string;
  text: string;
  kana: string;
}

export interface FollowReadings {
  /** oshi-video-maker の固定辞書（Worker の報告） */
  fixed: Readonly<Record<string, string>>;
  /** 推しサーチDBの登録読み */
  registered: Readonly<Record<string, string>>;
}

export type FollowPlanResult =
  | {
      ok: true;
      scenes: FollowScene[];
      lines: FollowLine[];
      /** 読みが見つからず、表記のまま読みに入れた語（登録するか読みの欄を直すまで音声に使えない） */
      unresolved: string[];
      sourceUrls: string[];
      sourceCheckedAt: string | null;
      title: string;
    }
  | { ok: false; missing: string[] };

// ─── 日付・数字の読み ───────────────────────────────

const DIGITS = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];

/** 1〜9999 の読み（oshi-video-maker の numberToKana と同じ読み方） */
export function numberKana(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n === 0) return 'ぜろ';
  const sen = Math.floor(n / 1000);
  const hyaku = Math.floor((n % 1000) / 100);
  const ju = Math.floor((n % 100) / 10);
  const ichi = n % 10;
  let s = '';
  if (sen) s += ({ 1: 'せん', 3: 'さんぜん', 8: 'はっせん' } as Record<number, string>)[sen] ?? `${DIGITS[sen]}せん`;
  if (hyaku) s += ({ 1: 'ひゃく', 3: 'さんびゃく', 6: 'ろっぴゃく', 8: 'はっぴゃく' } as Record<number, string>)[hyaku] ?? `${DIGITS[hyaku]}ひゃく`;
  if (ju) s += ju === 1 ? 'じゅう' : `${DIGITS[ju]}じゅう`;
  if (ichi) s += DIGITS[ichi];
  return s;
}

const MONTH_KANA = ['', 'いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ', 'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ'];
const DAY_KANA: Record<number, string> = {
  1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか',
  14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか',
};
/** 日の読み（17日=じゅうしちにち・19日=じゅうくにち など、日付で使う読み方） */
const dayKana = (d: number) => DAY_KANA[d] ?? `${numberKana(d).replace(/なな$/, 'しち').replace(/きゅう$/, 'く')}にち`;
const HOUR_KANA: Record<number, string> = { 4: 'よじ', 7: 'しちじ', 9: 'くじ', 14: 'じゅうよじ', 17: 'じゅうしちじ', 19: 'じゅうくじ' };
const MINUTE_KANA: Record<number, string> = { 0: '', 30: 'さんじゅっぷん', 10: 'じゅっぷん', 15: 'じゅうごふん', 20: 'にじゅっぷん', 40: 'よんじゅっぷん', 45: 'よんじゅうごふん', 50: 'ごじゅっぷん', 5: 'ごふん' };

export const yearKana = (y: number) => `${numberKana(y)}ねん`;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function parseDate(s: string | undefined | null): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(s ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? { y, m: mo, d } : null;
}

/** 11/10(火) */
export function shortDateLabel(s: string): string {
  const p = parseDate(s);
  if (!p) return s;
  return `${p.m}/${p.d}(${WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]})`;
}
/** 11月10日 */
const dateText = (s: string) => {
  const p = parseDate(s);
  return p ? `${p.m}月${p.d}日` : s;
};
const dateKana = (s: string) => {
  const p = parseDate(s);
  return p ? `${MONTH_KANA[p.m]}${dayKana(p.d)}` : s;
};
const timeKana = (t: string) => {
  const m = TIME_RE.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const hour = HOUR_KANA[h] ?? `${numberKana(h)}じ`;
  const minute = Object.prototype.hasOwnProperty.call(MINUTE_KANA, mi) ? MINUTE_KANA[mi] : `${numberKana(mi)}ふん`;
  return `${h === 0 ? 'れいじ' : hour}${minute}`;
};
/** 2026/11/01 */
export function checkedLabel(checkedAt: string): string {
  return checkedAt.slice(0, 10).replace(/-/g, '/');
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayJst(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) return date;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}
/** 次の月曜日（来週の出演予定の既定の開始日） */
export function nextMondayJst(nowMs: number): string {
  const today = todayJst(nowMs);
  const p = parseDate(today)!;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return addDays(today, ((8 - dow) % 7) || 7);
}

// ─── 読み ───────────────────────────────

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s　、。！？!?「」〜～]+$/u;

/** 語の読み（固定辞書 → 登録読み → ひらがな・カタカナだけの語はそのまま）。見つからなければ null（推測しない） */
export function resolveFollowKana(term: string, readings: FollowReadings): string | null {
  if (Object.prototype.hasOwnProperty.call(readings.fixed, term)) return readings.fixed[term];
  if (Object.prototype.hasOwnProperty.call(readings.registered, term)) return readings.registered[term];
  return KANA_ONLY.test(term) ? term : null;
}

/** ジャンル（表示分類）の言い方と読み */
const GENRE_SPOKEN: Record<DisplayWorkType, { text: string; kana: string }> = {
  drama: { text: 'ドラマ', kana: 'ドラマ' },
  movie: { text: '映画', kana: 'えいが' },
  variety: { text: 'バラエティ', kana: 'バラエティ' },
  anime_voice: { text: 'アニメ', kana: 'アニメ' },
  live: { text: 'ライブ', kana: 'ライブ' },
  documentary: { text: 'ドキュメンタリー', kana: 'ドキュメンタリー' },
  stage: { text: '舞台', kana: 'ぶたい' },
  idol_show: { text: 'アイドル番組', kana: 'アイドルばんぐみ' },
  music: { text: '音楽番組', kana: 'おんがくばんぐみ' },
  web: { text: '配信番組', kana: 'はいしんばんぐみ' },
  other: { text: '出演作', kana: 'しゅつえんさく' },
};

const RELEASE_KINDS: Record<string, { text: string; kana: string }> = {
  放送: { text: '放送開始', kana: 'ほうそうかいし' },
  公開: { text: '公開', kana: 'こうかい' },
  配信: { text: '配信開始', kana: 'はいしんかいし' },
};
export const FOLLOW_RELEASE_KINDS = Object.keys(RELEASE_KINDS);

/** 1文を「表記」と「読み」の組で組み立てる（固有名詞は読みを引き、無ければ表記のまま入れて未登録として記録する） */
class LineBuilder {
  text = '';
  kana = '';
  /** 読みが見つからなかった語（この文に入った分だけ。台本に採用した文の分を最後にまとめる） */
  readonly unresolved = new Set<string>();
  constructor(private readonly readings: FollowReadings) {}
  /** 表記と読みが同じ（ひらがな・カタカナ・記号）か、読みを明示した固定文 */
  say(text: string, kana: string = text): this {
    this.text += text;
    this.kana += kana;
    return this;
  }
  /** 別に組み立てた文（補足）を後ろにつなぐ */
  append(b: LineBuilder): this {
    this.text += b.text;
    this.kana += b.kana;
    for (const u of b.unresolved) this.unresolved.add(u);
    return this;
  }
  /** 固有名詞（人物名・作品名・役名・サービス名・番組名） */
  term(term: string, wrap: 'title' | 'plain' = 'plain'): this {
    const kana = resolveFollowKana(term, this.readings);
    if (kana === null) this.unresolved.add(term);
    this.text += wrap === 'title' ? `『${term}』` : term;
    this.kana += wrap === 'title' ? `「${kana ?? term}」` : kana ?? term;
    return this;
  }
}

/** 読みの音の数（oshi-video-maker の countMora と同じ数え方。読み未登録で漢字・数字が残っていれば1文字=2音、英字は1文字=1音で見積もる） */
export function countFollowMora(kana: string): number {
  let n = 0;
  for (const ch of kana) {
    if (/[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/u.test(ch)) continue;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(ch)) n++;
    else if (/[\p{Script=Han}0-9０-９]/u.test(ch)) n += 2;
    else if (/[A-Za-zＡ-Ｚａ-ｚ]/u.test(ch)) n += 1;
  }
  return n;
}

/** 読み上げの速さの目安（1秒あたりの音の数。推し活で損してるかも？と同じ） */
export const FOLLOW_MORA_PER_SECOND = 8;
/** 冒頭（0〜2秒にフック）の最短の長さ */
const HOOK_MIN_SECONDS = 2.0;
const SCENE_MIN_SECONDS = 2.0;
const OUTRO_MIN_SECONDS = 2.4;
/** 音声なし動画の目安の長さ（15〜18秒）。補足（出演年・役名など）はこの長さに収まる範囲でだけ台本に足す */
export const FOLLOW_TARGET_SECONDS = 17;
/** これより長い見積もりは管理画面で注意を出す（目安の 15〜18秒を超える） */
export const FOLLOW_SOFT_MAX_SECONDS = 18;
/** 動画の長さの上限（CapCut 音声に合わせた動画と同じ21秒）。超える台本はジョブを作らない */
export const FOLLOW_MAX_SECONDS = 21;
/** シーンごとの余白（読み上げの見積もりに足す） */
const SCENE_PADDING_SECONDS = 0.3;
/** 1シーンの長さの上限（oshi-video-maker の入力の検証と同じ） */
const SCENE_MAX_SECONDS = 12;

export const estimateFollowSeconds = (kana: string) => Math.round((countFollowMora(kana) / FOLLOW_MORA_PER_SECOND) * 100) / 100;

/** 各シーンの長さ: 読み上げの見積もり + 余白（最短あり）を、合計が目安の長さになるよう伸ばす */
export function allocateFollowSlots(lines: Array<Pick<FollowLine, 'kana'>>, kinds: FollowSceneKind[]): number[] {
  const base = lines.map((l, i) => {
    const min = kinds[i] === 'hook' ? HOOK_MIN_SECONDS : kinds[i] === 'outro' ? OUTRO_MIN_SECONDS : SCENE_MIN_SECONDS;
    return Math.min(SCENE_MAX_SECONDS, Math.max(min, estimateFollowSeconds(l.kana) + SCENE_PADDING_SECONDS));
  });
  const sum = base.reduce((a, b) => a + b, 0);
  if (sum >= FOLLOW_TARGET_SECONDS) return base.map((s) => Math.round(s * 10) / 10);
  // 冒頭はフックなので伸ばさない。それ以外を同じ比で伸ばす
  const stretchable = base.reduce((a, b, i) => a + (kinds[i] === 'hook' ? 0 : b), 0);
  const ratio = (FOLLOW_TARGET_SECONDS - (sum - stretchable)) / stretchable;
  // 伸ばしても1シーンは12秒まで（シーンが少なく12秒に達する場合は、合計が目安より短くなる）
  const out = base.map((s, i) => Math.min(SCENE_MAX_SECONDS, Math.round((kinds[i] === 'hook' ? s : s * ratio) * 10) / 10));
  // 丸めの誤差は最後のシーンで調整する
  const diff = Math.round((FOLLOW_TARGET_SECONDS - out.reduce((a, b) => a + b, 0)) * 10) / 10;
  out[out.length - 1] = Math.min(SCENE_MAX_SECONDS, Math.round((out[out.length - 1] + diff) * 10) / 10);
  return out;
}

export interface FollowLineCheck {
  id: string;
  estimateSeconds: number;
  slotSeconds: number;
  overlong: boolean;
}

/** 各文がシーンの時間に収まるか（見積もり） */
export function checkFollowLines(scenes: FollowScene[], lines: FollowLine[]): FollowLineCheck[] {
  return lines.map((l) => {
    const slot = scenes.find((s) => s.id === l.id)?.slotSeconds ?? 0;
    const estimate = estimateFollowSeconds(l.kana);
    return { id: l.id, estimateSeconds: estimate, slotSeconds: slot, overlong: estimate > slot };
  });
}

// ─── 事実の検証 ───────────────────────────────

const FACT_MAX_AGE_DAYS = 14;
const STREAM_START_MAX_AGE_DAYS = 30;

function isHttpUrl(s: string | undefined): boolean {
  if (!s || s.length > 500) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** 確認日時（YYYY-MM-DDTHH:MM・日本時間）の検証。未来・14日より前は不可 */
function checkCheckedAt(checkedAt: string | undefined, today: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(checkedAt ?? '');
  if (!m || !parseDate(m[1])) return '確認日時を入力してください';
  if (m[1] > today) return '確認日時が未来になっています';
  if (m[1] < addDays(today, -FACT_MAX_AGE_DAYS)) return `確認日時が${FACT_MAX_AGE_DAYS}日以上前です（公式情報を確認し直してください）`;
  return null;
}

const FACT_LABEL: Record<FollowFactKind, string> = { schedule: '出演予定', release: '新作', streamStart: '配信開始', streamEnd: '配信終了予定' };

/** 入力した事実の不足・不正（管理画面の表示とサーバーの検証に使う。空配列なら問題なし） */
export function validateFollowFacts(
  templateId: FollowTemplateId,
  selection: FollowSelection,
  works: FollowWork[],
  nowMs: number,
): string[] {
  const spec = FOLLOW_TEMPLATE_SPECS[templateId];
  const errors: string[] = [];
  const today = todayJst(nowMs);
  if (!spec.facts) {
    if (selection.facts.length > 0) errors.push('このテンプレートでは出演予定・配信情報の入力を使いません');
    return errors;
  }
  const facts = selection.facts.filter((f) => f.kind === spec.facts!.kind);
  if (facts.length !== selection.facts.length) errors.push('このテンプレートで使わない種類の情報が含まれています');
  if (facts.length < spec.facts.min) errors.push(`${FACT_LABEL[spec.facts.kind]}の確認済み情報を${spec.facts.min}件以上入力してください（公式情報のURL・確認日時が必要です）`);
  if (facts.length > spec.facts.max) errors.push(`${FACT_LABEL[spec.facts.kind]}は${spec.facts.max}件までです`);
  let periodEnd: string | null = null;
  if (spec.period) {
    if (!parseDate(selection.periodStart)) errors.push('対象期間の開始日を入力してください');
    else periodEnd = addDays(selection.periodStart!, 6);
  }
  facts.forEach((f, i) => {
    const at = `${FACT_LABEL[f.kind]}${facts.length > 1 ? ` ${i + 1}件目` : ''}`;
    if (!isHttpUrl(f.sourceUrl)) errors.push(`${at}: 公式情報のURLを入力してください`);
    const checked = checkCheckedAt(f.checkedAt, today);
    if (checked) errors.push(`${at}: ${checked}`);
    if (!parseDate(f.date)) {
      errors.push(`${at}: 日付を入力してください`);
      return;
    }
    if (f.kind === 'schedule') {
      if (!f.title?.trim() || f.title.length > 40) errors.push(`${at}: 番組名・作品名を1〜40文字で入力してください`);
      if (f.time && !TIME_RE.test(f.time)) errors.push(`${at}: 時刻は HH:MM で入力してください`);
      if (f.media && f.media.length > 20) errors.push(`${at}: 放送局・配信先は20文字までです`);
      if (f.date < today) errors.push(`${at}: 過去の日付です`);
      if (selection.periodStart && periodEnd && (f.date < selection.periodStart || f.date > periodEnd)) errors.push(`${at}: 対象期間（${shortDateLabel(selection.periodStart)}〜${shortDateLabel(periodEnd)}）の外です`);
    }
    if (f.kind === 'release') {
      if (!f.title?.trim() || f.title.length > 40) errors.push(`${at}: 新作の作品名を1〜40文字で入力してください`);
      if (!f.releaseKind || !RELEASE_KINDS[f.releaseKind]) errors.push(`${at}: 放送・公開・配信のどれかを選んでください`);
    }
    if (f.kind === 'streamStart' || f.kind === 'streamEnd') {
      if (!f.workId || !works.some((w) => w.id === f.workId)) errors.push(`${at}: 推しサーチに登録された出演作品を選んでください`);
      if (!f.provider?.trim() || f.provider.length > 30) errors.push(`${at}: 配信サービス名を入力してください`);
      if (f.kind === 'streamStart') {
        if (f.date > today) errors.push(`${at}: 配信開始日が未来です（配信が始まってから作れます）`);
        else if (f.date < addDays(today, -STREAM_START_MAX_AGE_DAYS)) errors.push(`${at}: 配信開始日が${STREAM_START_MAX_AGE_DAYS}日以上前です（「新しく配信開始」には使えません）`);
      } else if (f.date < today) {
        errors.push(`${at}: 配信終了予定日が過ぎています`);
      }
    }
  });
  return errors;
}

/** 作品の選択の不足・不正 */
export function validateFollowWorks(templateId: FollowTemplateId, targetType: FollowTargetType, selection: FollowSelection, works: FollowWork[]): string[] {
  const spec = FOLLOW_TEMPLATE_SPECS[templateId];
  const errors: string[] = [];
  if (spec.personOnly && targetType !== 'person') errors.push('このテンプレートは1人の人物だけ選べます（グループは選べません）');
  if (spec.poolMin && works.length < spec.poolMin) errors.push(`集計できる登録作品が${spec.poolMin}件未満です（${works.length}件）`);
  const ids = selection.selectedWorkIds;
  if (new Set(ids).size !== ids.length) errors.push('同じ作品が重複して選ばれています');
  const picked = ids.map((id) => works.find((w) => w.id === id));
  if (picked.some((w) => !w)) errors.push('推しサーチの公開作品にない作品が選ばれています');
  if (spec.works.max === 0) {
    if (ids.length > 0) errors.push('このテンプレートでは作品を選びません');
  } else if (ids.length < spec.works.min || ids.length > spec.works.max) {
    errors.push(spec.works.min === spec.works.max ? `作品を${spec.works.min}本選んでください（${ids.length}本選択中）` : `作品を${spec.works.min}〜${spec.works.max}本選んでください（${ids.length}本選択中）`);
  }
  for (const w of picked) {
    if (!w) continue;
    if (spec.works.requireYear && w.year === null) errors.push(`『${w.title}』は出演年が登録されていません`);
    if (spec.works.requireRole && !w.roleName) errors.push(`『${w.title}』は役名が登録されていません`);
    if (spec.works.requireStreaming && w.streaming.length === 0) errors.push(`『${w.title}』は見放題・無料の配信が確認されていません`);
    if (spec.works.requireAvailable && !w.available?.length) errors.push(`『${w.title}』は配信先が確認されていません`);
  }
  if (spec.works.requireYear && templateId === 'follow_career_timeline') {
    const years = picked.filter((w): w is FollowWork => !!w && w.year !== null).map((w) => w.year!);
    if (years.length === 3 && new Set(years).size < 2) errors.push('年表にするため、出演年の違う作品を選んでください');
  }
  if (spec.pick && selection.selectedWorkIds.length > 0 && (!selection.pickWorkId || !ids.includes(selection.pickWorkId))) errors.push('最後に勧める作品を、選んだ3本から1本選んでください');
  if (!spec.pick && selection.pickWorkId) errors.push('このテンプレートでは最後に勧める作品を選びません');
  return errors;
}

/**
 * 役名として扱わない登録値（出演の形を表す語・本人の名前・「〇〇メンバー」「〇〇レギュラー」）。
 * 役柄の紹介に使えるのは、これ以外の登録値だけ（語の意味から推測はせず、この明示した一覧と形だけで判定する）
 */
const NOT_ROLE_NAMES = new Set(['出演', '本人', 'ゲスト', 'MC', '司会', '進行', 'ナレーション', 'ナレーター', 'レギュラー', 'パーソナリティ', '声の出演', '出演者', 'メンバー', 'Self', 'Himself', 'Herself']);
export function isActingRoleName(role: string | null | undefined, personName: string): boolean {
  const r = (role ?? '').trim();
  if (!r || NOT_ROLE_NAMES.has(r) || r === personName) return false;
  // 日本語の表記が無い役名（TMDb のローマ字表記など）は、画面・台本で不自然なため使わない
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(r)) return false;
  return !/(メンバー|レギュラー|MC|ゲスト)$/u.test(r);
}

/** 作品の条件に合う候補か（管理画面の一覧で選べるかどうか） */
export function isEligibleFollowWork(templateId: FollowTemplateId, w: FollowWork): boolean {
  const s = FOLLOW_TEMPLATE_SPECS[templateId].works;
  return !(s.requireYear && w.year === null) && !(s.requireRole && !w.roleName) && !(s.requireStreaming && w.streaming.length === 0) && !(s.requireAvailable && !w.available?.length);
}

// ─── ジャンル集計 ───────────────────────────────

/** 登録作品をサイトの表示分類で数える（同じ作品は1件。多い順・同数は表示分類の名前順で固定） */
export function countFollowGenres(works: FollowWork[]): Array<{ genre: DisplayWorkType; label: string; count: number }> {
  const map = new Map<DisplayWorkType, { label: string; count: number }>();
  for (const w of works) {
    const e = map.get(w.genre) ?? { label: w.genreLabel, count: 0 };
    e.count++;
    map.set(w.genre, e);
  }
  return [...map.entries()].map(([genre, v]) => ({ genre, ...v })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
}

// ─── 台本・シーン ───────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const COUNT_LABEL = ['', '1本目', '2本目', '3本目'];
const COUNT_KANA = ['', 'いっぽんめ', 'にほんめ', 'さんぼんめ'];

/** 作品カードの補足（登録情報だけ: 出演年・種類・役名・配信） */
function workFacts(w: FollowWork, opts: { role?: boolean; streaming?: boolean; persons?: boolean } = {}): string[] {
  const out: string[] = [];
  out.push([w.year ? `${w.year}年` : null, w.genreLabel].filter(Boolean).join('・'));
  if (opts.role !== false && w.roleName) out.push(`${w.roleName}役`);
  if (opts.persons && w.persons.length > 0) out.push(`出演: ${w.persons.slice(0, 3).join('・')}${w.persons.length > 3 ? ` ほか${w.persons.length - 3}人` : ''}`);
  if (opts.streaming && w.streaming.length > 0) out.push(`${w.streaming.slice(0, 2).map((s) => s.provider).join('・')}で${w.streaming[0].typeLabel}`);
  return out.slice(0, 4);
}

const streamingNote = (ws: FollowWork[]) => {
  const dates = ws.flatMap((w) => w.streaming.map((s) => s.checkedDate)).filter((d): d is string => !!d).sort();
  return dates.length > 0 ? `配信情報: 推しサーチ登録情報（確認日 ${checkedLabel(dates[0])}〜${checkedLabel(dates[dates.length - 1])}）` : '配信情報: 推しサーチ登録情報';
};

/** 動画タイトル（投稿のタイトル・管理画面の表示） */
export function buildFollowTitle(templateId: FollowTemplateId, name: string, targetType: FollowTargetType = 'person'): string {
  // 出演作についてのタイトルは、グループのとき「〇〇メンバー」
  const who = targetType === 'group' ? `${name}メンバー` : name;
  switch (templateId) {
    case 'follow_three_works':
      return `${name}をもっと知りたい人へ 観てほしい出演作3選`;
    case 'follow_hidden_works':
      return `${who}、こんな作品にも出演していた？`;
    case 'follow_career_timeline':
      return `${who}の出演作品を年代順に並べてみた`;
    case 'follow_weekly_schedule':
      return `来週チェックしたい${name}の出演情報`;
    case 'follow_role_gap':
      return `${name}、この2作品の役柄を比べてみた`;
    case 'follow_new_release_backcatalog':
      return `新作で気になった人へ ${who}の過去の出演作`;
    case 'follow_new_streaming':
      return `${who}の出演作、配信が始まっていました`;
    case 'follow_streaming_ending':
      return `${who}の出演作品、まもなく配信終了予定`;
    case 'follow_weekend_watch':
      return `今週末、${name}を観るならこの3本`;
    case 'follow_genre_breakdown':
      return `${who}の出演作品、どのジャンルが多い？`;
  }
}

/**
 * テンプレート・対象・選択から、シーン（画面の文字）と台本（字幕・読み）を作る。
 * 必要な事実が足りなければ ok=false と足りない項目を返す（台本を作らない）。
 * 台本の各文は「必須の部分（作品名・日付など）」を短く作り、補足（出演年・種類・役名・配信）は動画の目安の長さに収まる範囲でだけ足す
 * （作品名が長いときは補足を読まない。補足は画面のカードには出す）。
 */
export function buildFollowPlan(opts: {
  templateId: FollowTemplateId;
  targetType: FollowTargetType;
  name: string;
  /** 対象の公開作品（グループのときはメンバーの作品を同じ作品ごとにまとめたもの） */
  works: FollowWork[];
  selection: FollowSelection;
  readings: FollowReadings;
  nowMs: number;
}): FollowPlanResult {
  const { templateId, targetType, name, works, selection, readings, nowMs } = opts;
  const missing = [...validateFollowWorks(templateId, targetType, selection, works), ...validateFollowFacts(templateId, selection, works, nowMs)];
  if (missing.length > 0) return { ok: false, missing };

  const L = () => new LineBuilder(readings);
  const picked = selection.selectedWorkIds.map((id) => works.find((w) => w.id === id)!);
  const workOf = (id: string | undefined) => works.find((w) => w.id === id)!;
  type Draft = { kind: FollowSceneKind; scene: Omit<FollowScene, 'id' | 'kind' | 'slotSeconds'>; line: LineBuilder; detail?: LineBuilder };
  const draft: Draft[] = [];
  const add = (kind: FollowSceneKind, scene: Draft['scene'], line: LineBuilder, detail?: LineBuilder) => draft.push({ kind, scene, line, detail });
  const genre = (w: FollowWork) => GENRE_SPOKEN[w.genre];
  /** 補足: 役名 → 出演年と種類 → 種類（登録情報だけ） */
  const workDetail = (w: FollowWork, opts2: { role?: boolean } = {}) => {
    const b = L();
    if (opts2.role !== false && w.roleName) return b.say('、').term(spokenRole(w.roleName)).say('役', 'やく');
    if (w.year) return b.say(`、${w.year}年の`, `、${yearKana(w.year)}の`).say(genre(w).text, genre(w).kana);
    return b.say('、').say(genre(w).text, genre(w).kana);
  };
  const facts = selection.facts;
  const sourceUrls = [...new Set(facts.map((f) => f.sourceUrl))];
  const checkedAts = facts.map((f) => f.checkedAt).sort();
  const sourceCheckedAt = checkedAts.length > 0 ? checkedAts[0] : null;
  const factNote = (f: FollowFact) => `確認日 ${checkedLabel(f.checkedAt)}・出典 ${hostOf(f.sourceUrl)}`;
  // 出演作についての文の主語: グループのときは「〇〇メンバー」（作品はメンバーの出演作のため）
  const subject = (b: LineBuilder) => (targetType === 'group' ? b.term(name).say('メンバー') : b.term(name));
  const subjectText = targetType === 'group' ? `${name}メンバー` : name;
  const ORDER = [
    { text: 'まずは', kana: 'まずは' },
    { text: '続いて', kana: 'つづいて' },
    { text: '最後は', kana: 'さいごは' },
  ];

  switch (templateId) {
    case 'follow_three_works': {
      add('hook', { label: 'もっと知りたい人へ', title: name, lines: ['観てほしい出演作3選'] }, L().term(name).say('をもっと知りたい人へ。観てほしい3作', 'をもっとしりたいひとへ。みてほしいさんさく'));
      picked.forEach((w, i) => {
        add('item', { label: COUNT_LABEL[i + 1], title: w.title, lines: workFacts(w, { streaming: true, persons: targetType === 'group' }), badge: 'POINT' }, L().say(ORDER[i].text, ORDER[i].kana).term(w.title, 'title'), workDetail(w));
      });
      add('outro', { title: 'これからも推しの出演作を紹介' }, L().say('これからも推しの出演作を紹介します', 'これからもおしのしゅつえんさくをしょうかいします'));
      break;
    }
    case 'follow_hidden_works': {
      add('hook', { label: '意外な出演作', title: name, lines: ['こんな作品にも出演していた？'] }, subject(L()).say('、こんな作品にも出演していた？', '、こんなさくひんにもしゅつえんしていた？'));
      picked.forEach((w, i) => {
        const head =
          picked.length === 1
            ? { text: '意外な出演作は', kana: 'いがいなしゅつえんさくは' }
            : picked.length === 2
              ? [ORDER[0], { text: 'もう1本は', kana: 'もういっぽんは' }][i]
              : ORDER[i];
        add('item', { label: picked.length > 1 ? `意外な出演作 ${i + 1}` : '意外な出演作', title: w.title, lines: workFacts(w, { persons: targetType === 'group' }) }, L().say(head.text, head.kana).term(w.title, 'title'), workDetail(w));
      });
      add('outro', { title: 'ほかの出演作も紹介していきます' }, L().say('ほかの出演作も紹介していきます', 'ほかのしゅつえんさくもしょうかいしていきます'));
      break;
    }
    case 'follow_career_timeline': {
      const sorted = [...picked].sort((a, b) => a.year! - b.year!);
      add('hook', { label: '出演作品の年表', title: name, lines: ['出演作を年代順に並べてみた'] }, subject(L()).say('の出演作を年代順に並べてみた', 'のしゅつえんさくをねんだいじゅんにならべてみた'));
      const tags = ['過去の出演作', '中間の時期', '比較的新しい出演作'];
      sorted.forEach((w, i) => {
        add(
          'item',
          { label: `${w.year}年`, title: w.title, lines: [tags[i], ...workFacts(w, { persons: targetType === 'group' })].slice(0, 4), points: sorted.map((x) => ({ label: `${x.year}年`, title: x.title })) },
          L().say(`${w.year}年、`, `${yearKana(w.year!)}、`).term(w.title, 'title'),
          L().say('。').say(genre(w).text, genre(w).kana).say('です'),
        );
      });
      const y1 = sorted[0].year!;
      const y3 = sorted[2].year!;
      add('compare', { label: 'まとめ', title: `${y1}年 → ${y3}年`, points: sorted.map((x) => ({ label: `${x.year}年`, title: x.title, sub: x.genreLabel })) }, L().say(`${y1}年から${y3}年までを振り返りました`, `${yearKana(y1)}から${yearKana(y3)}までをふりかえりました`));
      // 締めのシーンは置かず、まとめのシーンに推しサーチへの誘導を出す（動画を15〜18秒に収める）
      break;
    }
    case 'follow_weekly_schedule': {
      const start = selection.periodStart!;
      const end = addDays(start, 6);
      const items = [...facts].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
      add('hook', { label: '出演情報', title: name, lines: ['来週チェックしたい出演情報'] }, L().say('来週チェックしたい', 'らいしゅうチェックしたい').term(name).say('の出演情報', 'のしゅつえんじょうほう'));
      add(
        'compare',
        { label: '対象期間', title: `${shortDateLabel(start)}〜${shortDateLabel(end)}`, points: items.map((f) => ({ label: `${shortDateLabel(f.date)}${f.time ? ` ${f.time}` : ''}`, title: f.title!, sub: f.media || undefined })) },
        L().say('今回の期間はこちら', 'こんかいのきかんはこちら'),
      );
      for (const f of items) {
        const b = L().say(dateText(f.date), dateKana(f.date));
        if (f.time) b.say(` ${f.time}`, timeKana(f.time));
        b.say('、').term(f.title!, 'title');
        add('item', { label: `${shortDateLabel(f.date)}${f.time ? ` ${f.time}` : ''}`, title: f.title!, lines: f.media ? [f.media] : [], note: factNote(f) }, b);
      }
      add('outro', { title: '次回も出演情報を紹介します', lines: ['放送・配信の時間は公式情報で確認を'] }, L().say('次回も出演情報を紹介します', 'じかいもしゅつえんじょうほうをしょうかいします'));
      break;
    }
    case 'follow_role_gap': {
      add('hook', { label: '役柄くらべ', title: name, lines: ['2作品の役柄を比べてみた'] }, L().term(name).say('、2作品の役柄を比べてみた', '、にさくひんのやくがらをくらべてみた'));
      picked.forEach((w, i) => {
        add('item', { label: i === 0 ? '作品A' : '作品B', title: w.title, lines: [`${w.roleName}役`, ...workFacts(w, { role: false })] }, L().term(w.title, 'title').say('では').term(spokenRole(w.roleName!)).say('役', 'やく'));
      });
      add(
        'compare',
        { label: '見比べ', title: '同じ人が演じた2つの役', points: picked.map((w, i) => ({ label: i === 0 ? 'A' : 'B', title: w.title, sub: `${w.roleName}役` })) },
        L().say('同じ人が演じた、2つの役', 'おなじひとがえんじた、ふたつのやく'),
      );
      add('outro', { title: 'ほかの出演作もチェックしてみて' }, L().say('ほかの出演作もチェックしてみて', 'ほかのしゅつえんさくもチェックしてみて'));
      break;
    }
    case 'follow_new_release_backcatalog': {
      const f = facts[0];
      const rk = RELEASE_KINDS[f.releaseKind!];
      add('hook', { label: 'NEW', title: f.title!, lines: [`${subjectText} 出演・${dateText(f.date)} ${rk.text}`] }, L().say('新作', 'しんさく').term(f.title!, 'title').say('で気になった人へ', 'できになったひとへ'));
      add('item', { label: '出演', title: name, lines: [`${dateText(f.date)} ${rk.text}`], note: factNote(f) }, L().say('出演は', 'しゅつえんは').term(name));
      picked.forEach((w, i) => {
        add(
          'item',
          { label: `過去の出演作 ${i + 1}`, title: w.title, lines: workFacts(w, { persons: targetType === 'group' }) },
          i === 0 ? L().say('過去の出演作は', 'かこのしゅつえんさくは').term(w.title, 'title') : L().term(w.title, 'title').say('も'),
          workDetail(w),
        );
      });
      // 締めは作品名を読み直さない（画面のカードで出す）
      add('outro', { label: '次に観るなら', title: picked[0].title, lines: workFacts(picked[0], { role: false }).slice(0, 1) }, L().say('次に観るなら、まずはこの1本から', 'つぎにみるなら、まずはこのいっぽんから'));
      break;
    }
    case 'follow_new_streaming': {
      add('hook', { label: '配信開始', title: name, lines: ['この出演作、配信が始まっていました'] }, subject(L()).say('のこの出演作、配信が始まっていました', 'のこのしゅつえんさく、はいしんがはじまっていました'));
      for (const f of facts) {
        const w = workOf(f.workId);
        add(
          'item',
          { label: '新しく配信開始', title: w.title, badge: f.provider!, lines: [`${dateText(f.date)}から配信開始`, ...workFacts(w, { role: false })].slice(0, 3), note: factNote(f) },
          L().term(w.title, 'title').say('が').term(f.provider!).say('で配信開始', 'ではいしんかいし'),
          L().say(`。${dateText(f.date)}からです`, `。${dateKana(f.date)}からです`),
        );
      }
      add('outro', { title: 'これからも配信情報をチェック' }, L().say('これからも配信情報をチェックしていきます', 'これからもはいしんじょうほうをチェックしていきます'));
      break;
    }
    case 'follow_streaming_ending': {
      add('hook', { label: '見逃し注意', title: name, lines: ['まもなく配信終了予定'] }, subject(L()).say('の出演作、まもなく配信終了予定', 'のしゅつえんさく、まもなくはいしんしゅうりょうよてい'));
      for (const f of facts) {
        const w = workOf(f.workId);
        add(
          'item',
          { label: '配信終了予定', title: w.title, badge: f.provider!, lines: [`${dateText(f.date)} 配信終了予定`], note: factNote(f) },
          // 冒頭で「配信終了予定」と言っているため、ここは日付まで（「予定」を重ねない）
          L().term(w.title, 'title').say('、').term(f.provider!).say('での配信は', 'でのはいしんは').say(`${dateText(f.date)}まで`, `${dateKana(f.date)}まで`),
        );
      }
      add('outro', { title: '観る前に配信サービスで確認を', lines: ['配信状況は変わることがあります'] }, L().say('観る前に、配信サービスで確認してください', 'みるまえに、はいしんサービスでかくにんしてください'));
      break;
    }
    case 'follow_weekend_watch': {
      add('hook', { label: '週末の視聴プラン', title: name, lines: ['観るならこの3本'] }, L().say('今週末、', 'こんしゅうまつ、').term(name).say('を観るならこの3本', 'をみるならこのさんぼん'));
      picked.forEach((w, i) => {
        const s0 = w.streaming[0];
        add(
          'item',
          { label: COUNT_LABEL[i + 1], title: w.title, lines: workFacts(w, { streaming: true, persons: targetType === 'group' }), note: streamingNote([w]) },
          L().say(ORDER[i].text, ORDER[i].kana).term(w.title, 'title'),
          L().say('、').term(s0.provider).say(`で${s0.typeLabel}`, `で${s0.typeLabel === '見放題' ? 'みほうだい' : s0.typeLabel === '無料' ? 'むりょう' : 'こうこくつきむりょう'}`),
        );
      });
      const pick = workOf(selection.pickWorkId!);
      // 締めは作品名を読み直さない（画面のカードで出す）
      add('outro', { label: '迷ったらこれ', title: pick.title, lines: workFacts(pick, { role: false }).slice(0, 1) }, L().say('迷ったら、まずはこの1本', 'まよったら、まずはこのいっぽん'));
      break;
    }
    case 'follow_genre_breakdown': {
      const genres = countFollowGenres(works);
      const top = genres[0];
      const second = genres[1];
      const note = `推しサーチに登録された出演作品${works.length}件の集計（全出演作品ではありません）`;
      add('hook', { label: 'ジャンル分析', title: name, lines: ['出演作品、どのジャンルが多い？'] }, subject(L()).say('の出演作品、どのジャンルが多い？', 'のしゅつえんさくひん、どのジャンルがおおい？'));
      add(
        'chart',
        { label: '登録作品のジャンル', bars: genres.slice(0, 5).map((g) => ({ label: g.label, count: g.count })), total: works.length, note },
        L().say(`推しサーチに登録された${works.length}作品を集計すると`, `おしサーチにとうろくされた${numberKana(works.length)}さくひんをしゅうけいすると`),
      );
      const g = GENRE_SPOKEN[top.genre];
      add(
        'item',
        { label: 'いちばん多いジャンル', title: top.label, lines: [`${top.count}件 / ${works.length}件`, ...(second ? [`2位 ${second.label} ${second.count}件`] : [])], note },
        L().say('いちばん多いのは', 'いちばんおおいのは').say(g.text, g.kana).say(`で${top.count}作品`, `で${numberKana(top.count)}さくひん`),
      );
      add('outro', { title: 'ジャンル別に出演作をチェック' }, L().say('ジャンル別に出演作をチェックしてみてください', 'ジャンルべつにしゅつえんさくをチェックしてみてください'));
      break;
    }
  }

  // 補足は、目安の長さに収まる範囲で前のシーンから順に足す
  const kinds = draft.map((d) => d.kind);
  const estimate = () => draft.reduce((a, d, i) => a + Math.max(kinds[i] === 'hook' ? HOOK_MIN_SECONDS : kinds[i] === 'outro' ? OUTRO_MIN_SECONDS : SCENE_MIN_SECONDS, estimateFollowSeconds(d.line.kana) + SCENE_PADDING_SECONDS), 0);
  for (const d of draft) {
    if (!d.detail) continue;
    const before = estimate();
    if (before + estimateFollowSeconds(d.detail.kana) <= FOLLOW_TARGET_SECONDS) d.line.append(d.detail);
  }

  const lines: FollowLine[] = draft.map((d, i) => ({ id: `${pad2(i + 1)}-${d.kind}`, text: d.line.text, kana: d.line.kana }));
  const slots = allocateFollowSlots(lines, kinds);
  const scenes: FollowScene[] = draft.map((d, i) => ({ id: lines[i].id, kind: d.kind, slotSeconds: slots[i], ...d.scene }));
  const unresolved = [...new Set(draft.flatMap((d) => [...d.line.unresolved]))];
  return { ok: true, scenes, lines, unresolved, sourceUrls, sourceCheckedAt, title: buildFollowTitle(templateId, name, targetType) };
}

/** 読み上げる役名（「（日本版声優）」などの括弧の注記は読まない。画面のカードには注記つきで出す） */
function spokenRole(role: string): string {
  return role.replace(/\s*[（(][^）)]*[）)]\s*$/u, '').trim() || role;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
