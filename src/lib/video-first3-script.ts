// 動画「まず見る3作 ショートV1」の台本準備（管理画面）で使う純粋関数。
// ・読み未登録の語を、人物ごとではなく語ごとに1件にまとめる
// ・台本の準備状態の人数を数える（CapCut音声の状態とは別）
// ・登録する読みの形式チェック（読み台本に漢字・英字・数字を残さない）

export type ReadingKind = 'person' | 'work' | 'service' | 'other';
export type First3ScriptStatusKey = 'ready_script' | 'needs_reading' | 'insufficient_works' | 'pending' | 'error';

interface EntryLike {
  personName: string;
  scriptStatus?: First3ScriptStatusKey;
  /** 作品不足のとき、動画に使える異なる作品の数（0〜2） */
  eligibleCount?: number | null;
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

/**
 * 動画に使える作品の数ごとの人数（3作品以上=台本完成・読み確認待ち / 2・1・0作品=作品不足の内訳）。
 * 未選定・エラー・作品数が不明（古いWorkerの報告）は unknown。
 */
export function countWorkBuckets(entries: EntryLike[]): { three: number; two: number; one: number; zero: number; unknown: number } {
  const c = { three: 0, two: 0, one: 0, zero: 0, unknown: 0 };
  for (const e of entries) {
    if (!e.scriptStatus) continue;
    if (e.scriptStatus === 'ready_script' || e.scriptStatus === 'needs_reading') c.three++;
    else if (e.scriptStatus === 'insufficient_works' && e.eligibleCount === 2) c.two++;
    else if (e.scriptStatus === 'insufficient_works' && e.eligibleCount === 1) c.one++;
    else if (e.scriptStatus === 'insufficient_works' && e.eligibleCount === 0) c.zero++;
    else c.unknown++;
  }
  return c;
}

/** 作品ページの「確認: 2026年7月1日」から経過日数（読めなければnull）。配信を保証する値ではなく、確認の目安 */
export function daysSinceFirst3Check(checkedAt: string | null | undefined, now: Date = new Date()): number | null {
  const m = checkedAt?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const jstToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (now.getUTCHours() >= 15 ? 1 : 0));
  return Math.max(0, Math.round((jstToday - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86_400_000));
}
/** これ以上たっていたら、管理画面で配信の再確認を促す（自動では除外しない） */
export const FIRST3_CHECK_STALE_DAYS = 90;

/** 選定中の3作品のうち、配信の確認から FIRST3_CHECK_STALE_DAYS 日以上たっている作品（枠番号つき） */
export function staleFirst3Works(
  works: Array<{ title: string; checkedAt?: string | null }> | null | undefined,
  now: Date = new Date(),
): Array<{ slot: number; title: string; days: number }> {
  return (works ?? [])
    .map((w, i) => ({ slot: i + 1, title: w.title, days: daysSinceFirst3Check(w.checkedAt, now) }))
    .filter((w): w is { slot: number; title: string; days: number } => w.days !== null && w.days >= FIRST3_CHECK_STALE_DAYS);
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

/** 追加の候補の種別・使わない役（正本は oshi-video-maker の first3Selection.ts の FIRST3_EXTRA_KINDS・GUEST_ROLE と同じ） */
const FIRST3_EXTRA_KINDS = new Set(['バラエティ', 'ドキュメンタリー', 'ライブ・コンサート', '配信番組・Web', 'アイドル番組', '音楽番組']);
const FIRST3_GUEST_ROLE = /ゲスト|guest|cameo|カメオ|特別出演|友情出演/i;

/**
 * まず見る3作の候補にならない理由（候補になるならnull）。正本は oshi-video-maker の orderFirst3Candidates
 * （ドラマ・映画で「配信中」、本人出演・ゲスト等でない。ドラマは役の表示があるもの）と orderFirst3ExtraCandidates
 * （番組・ライブ等で「配信中」、ゲスト・カメオ等でない。本人出演は可）。手動選択の一覧で選べない作品に理由を表示する
 * ために同じ条件を使う（最終判定は Worker が行う）。
 */
export function first3CandidateExclusion(card: { kind: string; streaming: boolean; role: string | null }): string | null {
  if (FIRST3_EXTRA_KINDS.has(card.kind)) {
    if (!card.streaming) return '配信中ではない';
    return FIRST3_GUEST_ROLE.test(card.role ?? '') ? 'ゲスト出演等' : null;
  }
  if (card.kind !== 'ドラマ' && card.kind !== '映画') return 'まず見る3作の対象外の種別';
  if (!card.streaming) return '配信中ではない';
  const role = card.role?.trim() ?? '';
  if (!role) return card.kind === '映画' ? null : '役の表示がないドラマ（音楽・トーク番組等）';
  return FIRST3_SELF_ROLE.test(role) ? '本人出演・ゲスト等' : null;
}
