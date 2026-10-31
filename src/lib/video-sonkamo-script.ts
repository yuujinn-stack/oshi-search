// 動画「推し活で損してるかも？ V1」（oshi-sonkamo-v1）のナレーション原稿を管理画面で作る・確かめるための純粋関数（'use client' からも import 可）。
// 台本の雛形は oshi-video-maker（src/compositions/sonkamo/sonkamoScript.ts）が正本で、Worker が生存報告で送ってくる
// （SonkamoScriptTemplate）。ここには雛形の文を持たず、受け取った雛形に名前・読み・敬称を差し込むだけ。
// 名前の読み: oshi-video-maker の固定辞書（雛形の fixedReadings）→ 推しサーチDBの登録読み → ひらがな・カタカナだけの名前はそのまま。
// どれも無ければ「読み未登録」（推測しない）。

export interface SonkamoScriptTemplate {
  version: 1;
  nameToken: string;
  nameKanaToken: string;
  /** 読み上げの速さの目安（1秒あたりの音の数） */
  moraPerSecond: number;
  honorifics: string[];
  lines: Array<{ id: string; slotSeconds: number; person: { text: string; kana: string }; group: { text: string; kana: string } }>;
  /** oshi-video-maker の読みの固定辞書の人物名（推しサーチDBの登録読みより優先される） */
  fixedReadings: Record<string, string>;
}

export type SonkamoTarget = 'person' | 'group';
export interface SonkamoLine {
  id: string;
  text: string;
  kana: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** Worker の報告を検証する（形が違えば null＝管理画面では原稿を作れない） */
export function parseSonkamoScriptTemplate(raw: unknown): SonkamoScriptTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const nameToken = str(o.nameToken, 20);
  const nameKanaToken = str(o.nameKanaToken, 20);
  const rate = typeof o.moraPerSecond === 'number' && o.moraPerSecond > 0 && o.moraPerSecond < 30 ? o.moraPerSecond : null;
  if (o.version !== 1 || !nameToken || !nameKanaToken || rate === null || !Array.isArray(o.lines) || o.lines.length === 0 || o.lines.length > 10) return null;
  const pair = (v: unknown) => {
    const p = v as Record<string, unknown> | null;
    const text = p && str(p.text, 120);
    const kana = p && str(p.kana, 160);
    return text && kana ? { text, kana } : null;
  };
  const lines: SonkamoScriptTemplate['lines'] = [];
  for (const l of o.lines as unknown[]) {
    const x = l as Record<string, unknown> | null;
    const id = x && str(x.id, 40);
    const slot = x && typeof x.slotSeconds === 'number' && x.slotSeconds > 0 && x.slotSeconds < 30 ? x.slotSeconds : null;
    const person = x && pair(x.person);
    const group = x && pair(x.group);
    if (!id || slot === null || !person || !group) return null;
    lines.push({ id, slotSeconds: slot, person, group });
  }
  const honorifics = (Array.isArray(o.honorifics) ? o.honorifics : []).filter((h): h is string => typeof h === 'string' && h.length <= 4).slice(0, 10);
  const fixedReadings: Record<string, string> = {};
  if (o.fixedReadings && typeof o.fixedReadings === 'object' && !Array.isArray(o.fixedReadings)) {
    for (const [k, v] of Object.entries(o.fixedReadings as Record<string, unknown>).slice(0, 500)) {
      if (k.length <= 100 && typeof v === 'string' && v.length <= 100) fixedReadings[k] = v;
    }
  }
  return { version: 1, nameToken, nameKanaToken, moraPerSecond: rate, honorifics: honorifics.length > 0 ? honorifics : [''], lines, fixedReadings };
}

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s　、。！？!?「」]+$/u;

/** 名前の読み（見つからなければ null。推測しない） */
export function resolveSonkamoNameKana(
  name: string,
  template: Pick<SonkamoScriptTemplate, 'fixedReadings'>,
  registered: Readonly<Record<string, string>>,
): { kana: string; source: 'fixed' | 'registered' | 'kana' } | null {
  if (Object.prototype.hasOwnProperty.call(template.fixedReadings, name)) return { kana: template.fixedReadings[name], source: 'fixed' };
  if (Object.prototype.hasOwnProperty.call(registered, name)) return { kana: registered[name], source: 'registered' };
  return KANA_ONLY.test(name) ? { kana: name, source: 'kana' } : null;
}

/** 雛形に名前・読み・敬称を差し込んだ原稿（読み未登録なら読みにも表示名を入れる。そのままでは音声に使えない） */
export function buildSonkamoLines(template: SonkamoScriptTemplate, target: SonkamoTarget, name: string, nameKana: string | null, honorific: string): SonkamoLine[] {
  const display = `${name}${honorific}`;
  const kanaName = `${nameKana ?? name}${honorific}`;
  return template.lines.map((l) => ({
    id: l.id,
    text: l[target].text.split(template.nameToken).join(display),
    kana: l[target].kana.split(template.nameKanaToken).join(kanaName),
  }));
}

/** 読みの音の数（oshi-video-maker の countMora と同じ数え方。漢字・英字が残っていれば1文字=2音で見積もる） */
export function countSonkamoMora(kana: string): number {
  let n = 0;
  for (const ch of kana) {
    if (/[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/u.test(ch)) continue;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(ch)) n++;
    else if (/[\p{Script=Han}A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/u.test(ch)) n += 2;
  }
  return n;
}

/** 読みに漢字・英字・数字が残っている部分（読み未登録の語など） */
export function nonReadableParts(kana: string): string[] {
  return [...new Set(kana.match(/[\p{Script=Han}A-Za-z0-9Ａ-Ｚａ-ｚ０-９]+/gu) ?? [])];
}

export interface SonkamoLineCheck {
  id: string;
  estimateSeconds: number;
  slotSeconds: number;
  overlong: boolean;
  nonReadable: string[];
}

/** 各文がシーンの時間に収まるか（見積もり）と、読みに漢字・英字が残っていないか */
export function checkSonkamoLines(template: SonkamoScriptTemplate, lines: SonkamoLine[]): SonkamoLineCheck[] {
  return lines.map((l) => {
    const slot = template.lines.find((t) => t.id === l.id)?.slotSeconds ?? 0;
    const estimate = Math.round((countSonkamoMora(l.kana) / template.moraPerSecond) * 100) / 100;
    return { id: l.id, estimateSeconds: estimate, slotSeconds: slot, overlong: estimate > slot, nonReadable: nonReadableParts(l.kana) };
  });
}

/** 動画タイトル（oshi-video-maker の buildSonkamoTitle と同じ形） */
export function buildSonkamoTitle(name: string): string {
  return `${name}推し、これ知らないと損かも？`;
}
