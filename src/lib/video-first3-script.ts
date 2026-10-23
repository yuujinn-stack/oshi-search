// 動画「まず見る3作 ショートV1」の台本準備（管理画面）で使う純粋関数。
// ・読み未登録の語を、人物ごとではなく語ごとに1件にまとめる
// ・台本の準備状態の人数を数える（CapCut音声の状態とは別）
// ・登録する読みの形式チェック（読み台本に漢字・英字・数字を残さない）

export type ReadingKind = 'person' | 'work' | 'service' | 'other';
export type First3ScriptStatusKey = 'ready_script' | 'needs_reading' | 'insufficient_works' | 'pending' | 'error';

interface EntryLike {
  personName: string;
  scriptStatus?: First3ScriptStatusKey;
  unresolvedReadings?: Array<{ kind: ReadingKind; text: string }>;
}

/** 読み未登録の語ごとに、使用している人物をまとめる（使用人数の多い順） */
export function groupUnresolvedReadings(entries: EntryLike[]): Array<{ text: string; kind: ReadingKind; persons: string[] }> {
  const map = new Map<string, { text: string; kind: ReadingKind; persons: string[] }>();
  for (const e of entries) {
    for (const u of e.unresolvedReadings ?? []) {
      const g = map.get(u.text) ?? { text: u.text, kind: u.kind, persons: [] };
      if (!g.persons.includes(e.personName)) g.persons.push(e.personName);
      map.set(u.text, g);
    }
  }
  return [...map.values()].sort((a, b) => b.persons.length - a.persons.length || a.text.localeCompare(b.text, 'ja'));
}

/** 台本の準備状態ごとの人数（scriptStatusの無い報告=他テンプレートは数えない） */
export function countScriptStatuses(entries: EntryLike[]): Record<'all' | First3ScriptStatusKey, number> {
  const c = { all: 0, ready_script: 0, needs_reading: 0, insufficient_works: 0, pending: 0, error: 0 };
  for (const e of entries) {
    if (!e.scriptStatus) continue;
    c.all++;
    c[e.scriptStatus]++;
  }
  return c;
}

/** 読みとして受け付ける文字（ひらがな・カタカナ・長音・中黒・空白・句読点） */
const READING_PATTERN = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s　、。！？!?「」]+$/u;

/** 登録する語と読みの形式チェック。問題があればエラー文、無ければ整えた値 */
export function checkReadingInput(sourceText: string, reading: string): { ok: true; sourceText: string; reading: string } | { ok: false; error: string } {
  const s = sourceText.trim();
  const r = reading.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 200) return { ok: false, error: '読みを登録する語が空、または長すぎます。' };
  if (!r || r.length > 300) return { ok: false, error: '読みが空、または長すぎます。' };
  if (!READING_PATTERN.test(r)) return { ok: false, error: '読みは、ひらがな・カタカナで入力してください（漢字・英字・数字は使えません）。' };
  return { ok: true, sourceText: s, reading: r };
}

/** 別名の一覧から、ひらがな・カタカナだけのもの（読みの候補。重複除去・出現順） */
export function kanaOnlyAliases(lists: unknown[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (typeof a !== 'string') continue;
      const v = a.trim();
      if (v && READING_PATTERN.test(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/**
 * 同じ作品かどうかを判定するための作品名（全角・半角・大文字小文字・空白・記号・先頭の「劇場版」の違いを除く）。
 * 正本は oshi-video-maker の normalizeFirst3Title（first3Selection.ts）。管理画面の手動選択で、選ばれている他の
 * 2作品と同じ作品を選べなくするために同じ処理を使う（最終判定は Worker が行う）。
 */
export function normalizeFirst3Title(title: string): string {
  const t = title.normalize('NFKC').toLowerCase().trim().replace(/^劇場版[\s　:：・\-－]*/u, '');
  const key = t.replace(/[^\p{L}\p{N}]/gu, '');
  return key || t.replace(/\s+/g, '');
}

/** 本人出演・ゲスト等の役（正本は oshi-video-maker の first3Selection.ts の SELF_ROLE と同じ） */
const FIRST3_SELF_ROLE = /^(self\b|himself|herself|本人)|\(self|（本人|本人（|本人\(|ゲスト|司会|mc\b|パーソナリティ|ナレーター/i;

/**
 * まず見る3作の候補にならない理由（候補になるならnull）。正本は oshi-video-maker の orderFirst3Candidates
 * （ドラマ・映画で「配信中」、本人出演・ゲスト等でない。ドラマは役の表示があるもの）。手動選択の一覧で
 * 選べない作品に理由を表示するために同じ条件を使う（最終判定は Worker が行う）。
 */
export function first3CandidateExclusion(card: { kind: string; streaming: boolean; role: string | null }): string | null {
  if (card.kind !== 'ドラマ' && card.kind !== '映画') return 'ドラマ・映画ではない';
  if (!card.streaming) return '配信中ではない';
  const role = card.role?.trim() ?? '';
  if (!role) return card.kind === '映画' ? null : '役の表示がないドラマ（音楽・トーク番組等）';
  return FIRST3_SELF_ROLE.test(role) ? '本人出演・ゲスト等' : null;
}
