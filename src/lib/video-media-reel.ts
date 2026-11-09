// 推しサーチ総合紹介動画（10種類・入力の種類 oshi-media-reel）。DB非依存（'use client' からも import 可）。
//
// 台本・演出・実画面の撮影は oshi-video-maker（src/compositions/media/）が正本。Worker がテンプレートごとの台本
// （字幕・読み・画面の文字。グループ版は {{groupName}} のまま）を報告し、管理画面はそれを表示・コピーするだけ。
// 生成に使う台本は Worker のコードが作り直す（画面で編集した台本は受け取らない＝元のナレーション・デザインを保つ）。
// 一般版（OSHI_GENERAL_*）は person_name を「推しサーチ」にして1本、グループ版（OSHI_GROUP_*）は person_name をグループ名にして1本作る。

import { checkReadingInput } from './video-first3-script';

export const MEDIA_TEMPLATE_CATEGORY = 'oshi_media' as const;
export const MEDIA_SECTION_TITLE = '推しサーチ総合紹介動画（11種類）';
/** 一般版のジョブの person_name（登録グループ紹介と同じ「推しサーチ」） */
export const MEDIA_JOB_NAME = '推しサーチ';
export const MEDIA_GROUP_TOKEN = '{{groupName}}';
/** 動画の長さの上限（oshi-video-maker の MEDIA_MAX_SECONDS と同じ。CapCut 音声の案内に使う） */
export const MEDIA_MAX_SECONDS = 30;

export const MEDIA_TEMPLATE_IDS = [
  'OSHI_GENERAL_01',
  'OSHI_GENERAL_02',
  'OSHI_GENERAL_03',
  'OSHI_GENERAL_04',
  'OSHI_GROUP_05',
  'OSHI_GENERAL_06',
  'OSHI_GENERAL_07',
  'OSHI_GENERAL_08',
  'OSHI_GENERAL_09',
  'OSHI_GROUP_10',
  // OSHI_GENERAL_09「これまだ知らないの？」を複製したグループ版（Worker の派生テンプレート）。ナレーションは OSHI_GENERAL_09 と同じで、
  // 冒頭の表示文字・演出と、実画面を撮影するグループだけが変わる
  'OSHI_GROUP_09',
] as const;
export type MediaTemplateId = (typeof MEDIA_TEMPLATE_IDS)[number];

export function isMediaTemplateId(id: unknown): id is MediaTemplateId {
  return typeof id === 'string' && (MEDIA_TEMPLATE_IDS as readonly string[]).includes(id);
}

/** グループ版（グループ名を選ぶ）か */
export function isMediaGroupTemplateId(id: unknown): boolean {
  return isMediaTemplateId(id) && id.startsWith('OSHI_GROUP_');
}

/** 一般版は「推しサーチ」、グループ版は選んだグループ名（ジョブの person_name） */
export function mediaJobPersonName(templateId: string, groupName: string | null): string {
  return isMediaGroupTemplateId(templateId) ? (groupName ?? '').trim() : MEDIA_JOB_NAME;
}

export interface MediaScriptLine {
  id: string;
  /** 字幕（グループ版は {{groupName}} を含む） */
  text: string;
  /** CapCut に貼る読み（ひらがな。グループ版は {{groupName}} を含む） */
  kana: string;
  /** 画面の大きな文字 */
  overlay: string;
  approxSeconds: number;
}

/** Worker が報告する台本（oshi-video-maker の buildMediaScriptReport） */
export interface MediaScriptReport {
  version: 1;
  templateId: MediaTemplateId;
  name: string;
  goal: string;
  coverText: string;
  cta: string;
  targetDurationSec: number;
  selectionMode: 'none' | 'group';
  defaultGroup: string | null;
  lines: MediaScriptLine[];
  /** グループ版だけ: Worker のグループ名の読み辞書（表記 → 読み。古い Worker は送らないため空） */
  groupReadings: Record<string, string>;
}

const TEXT_MAX = 200;
const str = (v: unknown, max = TEXT_MAX): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0009\u000b-\u001f]/.test(v) ? v : null);

/** Worker の報告の形を確かめる（形が違えば null＝管理画面では台本を表示できない。生成は Worker のコードで行う） */
export function parseMediaScriptReport(raw: unknown): MediaScriptReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !isMediaTemplateId(o.templateId)) return null;
  const selectionMode = o.selectionMode === 'group' ? 'group' : o.selectionMode === 'none' ? 'none' : null;
  if (!selectionMode || (selectionMode === 'group') !== isMediaGroupTemplateId(o.templateId)) return null;
  const name = str(o.name);
  const goal = str(o.goal) ?? '';
  const coverText = str(o.coverText) ?? '';
  const cta = str(o.cta) ?? '';
  const target = typeof o.targetDurationSec === 'number' && o.targetDurationSec > 0 && o.targetDurationSec <= 60 ? o.targetDurationSec : null;
  if (!name || target === null || !Array.isArray(o.lines) || o.lines.length < 3 || o.lines.length > 10) return null;
  const lines: MediaScriptLine[] = [];
  for (const l of o.lines) {
    const x = (l ?? {}) as Record<string, unknown>;
    const id = typeof x.id === 'string' && /^\d{2}-[a-z0-9-]+$/.test(x.id) ? x.id : null;
    const text = str(x.text);
    const kana = str(x.kana);
    const overlay = str(x.overlay) ?? '';
    const sec = typeof x.approxSeconds === 'number' && x.approxSeconds > 0 && x.approxSeconds <= 15 ? x.approxSeconds : null;
    if (!id || !text || !kana || sec === null) return null;
    lines.push({ id, text, kana, overlay, approxSeconds: sec });
  }
  const defaultGroup = selectionMode === 'group' ? str(o.defaultGroup, 100) : null;
  return { version: 1, templateId: o.templateId, name, goal, coverText, cta, targetDurationSec: target, selectionMode, defaultGroup, lines, groupReadings: selectionMode === 'group' ? parseGroupReadings(o.groupReadings) : {} };
}

const GROUP_READINGS_MAX = 500;
/** Worker のグループ名の読み辞書（読みとして使える形のものだけ。形が違うものは使わない） */
function parseGroupReadings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, GROUP_READINGS_MAX)) {
    if (typeof v !== 'string' || !str(k, 100)) continue;
    const r = checkReadingInput(k, v);
    if (r.ok) out[r.sourceText] = r.reading;
  }
  return out;
}

/** グループ名の読みの出どころ（管理画面の表示用） */
export type MediaGroupReadingSource = 'registered' | 'fixed' | 'dictionary' | 'kana';

export const MEDIA_GROUP_READING_SOURCE_LABELS: Record<MediaGroupReadingSource, string> = {
  registered: '推しサーチで登録した読み',
  fixed: '動画メーカーの辞書',
  dictionary: '動画メーカーのグループ名の辞書',
  kana: 'ひらがな・カタカナの名前をそのまま',
};

/**
 * グループ名の読み。Worker（oshi-video-maker の resolveMediaGroupReading）と同じ順番:
 * 推しサーチで登録した読み → 人物名などの固定辞書 → グループ名の辞書 → ひらがな・カタカナだけの名前はそのまま。無ければ null
 */
export function resolveMediaGroupReading(
  groupName: string,
  sources: { registered?: Record<string, string> | null; fixed?: Record<string, string>; groupReadings?: Record<string, string> },
): { reading: string; source: MediaGroupReadingSource } | null {
  const g = groupName.trim();
  if (!g) return null;
  const registered = sources.registered?.[g];
  if (registered) return { reading: registered, source: 'registered' };
  const fixed = sources.fixed?.[g];
  if (fixed) return { reading: fixed, source: 'fixed' };
  const dict = sources.groupReadings?.[g];
  if (dict) return { reading: dict, source: 'dictionary' };
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s・]+$/u.test(g) ? { reading: g, source: 'kana' } : null;
}

export interface MediaScriptPreview {
  name: string;
  /** 動画タイトル（サムネイルの文字を1行にしたもの） */
  title: string;
  coverText: string;
  lines: MediaScriptLine[];
  /** 台本（字幕）を1文1行で */
  scriptText: string;
  /** CapCut に貼る読み台本（1文1行） */
  kanaText: string;
  /** グループ名の読みが分からず、読み台本にグループ名をそのまま入れた */
  groupReadingMissing: boolean;
}

/**
 * 管理画面の表示用に、グループ版の {{groupName}} を選んだグループ名に置き換える（読みは分かれば読み、無ければグループ名のまま）。
 * 実際の動画の台本・読みは Worker が生成時に作り直す（ここでの表示は確認・コピー用）
 */
/** グループ版のうち、ナレーション（読み台本）にグループ名が入るか。入らないもの（OSHI_GROUP_09）は読みの登録・グループ名の音声確認が不要 */
export function mediaScriptReadsGroupName(report: MediaScriptReport): boolean {
  return report.selectionMode === 'group' && report.lines.some((l) => l.text.includes(MEDIA_GROUP_TOKEN) || l.kana.includes(MEDIA_GROUP_TOKEN));
}

export function renderMediaScript(report: MediaScriptReport, groupName: string | null, groupReading: string | null): MediaScriptPreview {
  const g = report.selectionMode === 'group' ? (groupName ?? '').trim() : '';
  const reading = g ? (groupReading ?? '').trim() : '';
  const sub = (t: string) => (g ? t.split(MEDIA_GROUP_TOKEN).join(g) : t);
  const subKana = (t: string) => (g ? t.split(MEDIA_GROUP_TOKEN).join(reading || g) : t);
  const lines = report.lines.map((l) => ({ ...l, text: sub(l.text), kana: subKana(l.kana), overlay: sub(l.overlay) }));
  const coverText = sub(report.coverText);
  return {
    name: sub(report.name),
    title: coverText.replace(/\n/g, ' '),
    coverText,
    lines,
    scriptText: lines.map((l) => l.text).join('\n'),
    kanaText: lines.map((l) => l.kana).join('\n'),
    groupReadingMissing: !!g && !reading && report.lines.some((l) => l.kana.includes(MEDIA_GROUP_TOKEN)),
  };
}
