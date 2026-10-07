// 動画「まず見る3作 ショートV1」の読み未登録をCSVで往復する（書き出し → ChatGPTで調査 → 一括登録）ための純粋関数。
// 管理画面（書き出し・プロンプト生成・ZIP作成）とサーバー（取り込みの検証）の両方が同じ実装を使う。
//
// ・行のidは「種類＋語」から決まる固定値（同じ語なら毎回同じid）。取り込み時はidと語(sourceText)の両方を現在の一覧と照合する
// ・CSV・プロンプトに入れるのは語・種類・使用人数・使用人物名・用途だけ（Cookie・トークン・URL等の内部情報は入れない）
// ・承認済み(approved)の行だけを登録対象にし、要確認(needs_review)は登録しない。登録済みの語は上書きしない(skip)

import { parseCSV } from './csv-parse';
import { checkReadingInput, groupUnresolvedReadings, type ReadingKind } from './video-first3-script';

export const READING_CSV_COLUMNS = [
  'id',
  'sourceText',
  'type',
  'usageCount',
  'personNames',
  'context',
  'reading',
  'confidence',
  'reviewStatus',
  'note',
] as const;
export const READING_CSV_LOCKED_COLUMNS = ['id', 'sourceText', 'type', 'usageCount', 'personNames', 'context'] as const;
export const READING_CSV_EDITABLE_COLUMNS = ['reading', 'confidence', 'reviewStatus', 'note'] as const;
export const READING_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const READING_REVIEW_STATUSES = ['approved', 'needs_review'] as const;
/** 人物名の区切り（人物名に含まれない記号） */
export const PERSON_NAMES_SEPARATOR = ' / ';
/** 取り込むCSVの上限（未登録の語は数百件の想定） */
export const MAX_READING_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_READING_CSV_ROWS = 5000;

export type ReadingType = 'work_title' | 'person_name' | 'english_title' | 'other';
export interface UnregisteredReadingRow {
  id: string;
  sourceText: string;
  type: ReadingType;
  usageCount: number;
  personNames: string[];
  context: string;
}

const FIRST3_TEMPLATE_ID = 'oshi-first3-v1';

/** 32bit FNV-1a（ブラウザ・サーバーで同じ値になる軽量なハッシュ。暗号用途ではない） */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 種類＋語から決まる行id（同じ語なら毎回同じ） */
export function readingRowId(kind: ReadingKind, text: string): string {
  const key = `${kind}\u0000${text}`;
  return `rd_${fnv1a(key, 0x811c9dc5).toString(16).padStart(8, '0')}${fnv1a(key, 0x9747b28c).toString(16).padStart(8, '0')}`;
}

/** 語の種類（安全に判定できる範囲だけ。作品名で英字・数字・記号だけのものは英字タイトル） */
export function toReadingType(kind: ReadingKind, text: string): ReadingType {
  if (kind === 'person') return 'person_name';
  if (kind === 'work') return /^[\x20-\x7E]+$/.test(text) ? 'english_title' : 'work_title';
  return 'other';
}

const KIND_CONTEXT: Record<ReadingKind, string> = {
  person: '「まず見る3作」ナレーションの人物名',
  work: '「まず見る3作」ナレーションの作品名',
  service: '「まず見る3作」ナレーションの配信サービス名',
  other: '「まず見る3作」ナレーションの語句',
};

interface ReportEntryLike {
  personName: string;
  templateId: string;
  unresolvedReadings?: Array<{ kind: ReadingKind; text: string }>;
}

/** Workerの報告（entries＋scriptOnlyEntries）から、まず見る3作の読み未登録を語ごとに1行にする（使用人数の多い順） */
export function buildUnregisteredReadingRows(
  report: { entries?: ReportEntryLike[]; scriptOnlyEntries?: ReportEntryLike[] } | null | undefined,
): UnregisteredReadingRow[] {
  const entries = [...(report?.entries ?? []), ...(report?.scriptOnlyEntries ?? [])].filter((e) => e.templateId === FIRST3_TEMPLATE_ID);
  return groupUnresolvedReadings(entries).map((g) => ({
    id: readingRowId(g.kind, g.text),
    sourceText: g.text,
    type: toReadingType(g.kind, g.text),
    usageCount: g.persons.length,
    personNames: g.persons,
    context: KIND_CONTEXT[g.kind],
  }));
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV（UTF-8・先頭にBOM。reading・confidence・reviewStatus・noteは空欄） */
export function readingRowsToCsv(rows: UnregisteredReadingRow[]): string {
  const lines = [READING_CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.id, r.sourceText, r.type, String(r.usageCount), r.personNames.join(PERSON_NAMES_SEPARATOR), r.context, '', '', '', '']
        .map(csvField)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** ファイル名用の日時（日本時間 YYYYMMDD-HHMM） */
export function readingFileTimestamp(date: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

const TYPE_LABEL: Record<ReadingType, string> = {
  work_title: '作品名（日本語表記）',
  person_name: '人物名',
  english_title: '英字の作品名',
  other: 'その他',
};

/** ChatGPTに添付CSVと一緒に貼るプロンプト（件数・ファイル名・列・種類ごとの件数はその時点のデータから入れる） */
export function buildReadingChatGptPrompt(rows: UnregisteredReadingRow[], csvFileName: string): string {
  const counts = new Map<ReadingType, number>();
  for (const r of rows) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  const countLines = (['work_title', 'person_name', 'english_title', 'other'] as ReadingType[])
    .filter((t) => (counts.get(t) ?? 0) > 0)
    .map((t) => `- ${t}（${TYPE_LABEL[t]}）：${counts.get(t)}件`);
  return [
    '添付したCSVには、推しサーチの動画ナレーションで使用する未登録の読みがあります。',
    '各行について正しい読みを確認し、reading列を「ひらがな」で入力してください。',
    '',
    '【対象】',
    `- 対象CSV：${csvFileName}`,
    `- 対象件数：${rows.length}件`,
    ...countLines,
    `- CSV列：${READING_CSV_COLUMNS.join(', ')}`,
    `- personNames は、その語を台本で使っている人物名を「${PERSON_NAMES_SEPARATOR.trim()}」区切りで並べたものです（調査の手がかり）。`,
    '',
    '【重要ルール】',
    '・推測だけで読みを決めない',
    '・作品名、人物名、英字タイトル、固有名詞は必要に応じて確認する',
    '・公式サイト、作品公式、所属事務所、番組公式等を優先する',
    '・同名作品や表記揺れに注意する',
    '・判断できない場合は無理に埋めない',
    '・判断できない場合：reading=""、confidence="low"、reviewStatus="needs_review"',
    '・かなり確実：confidence="high"、reviewStatus="approved"',
    '・概ね確実だが確認余地あり：confidence="medium"、reviewStatus="needs_review"',
    '',
    `変更禁止列：${READING_CSV_LOCKED_COLUMNS.join(', ')}`,
    `変更可能列：${READING_CSV_EDITABLE_COLUMNS.join(', ')}`,
    '',
    '・readingは原則ひらがな（漢字・英字・数字は使わない。必要な場合のみ長音「ー」や中黒「・」、空白は可）',
    '・英字タイトルも、ナレーションとして自然に読める日本語の読みをひらがなで入力する',
    '・作品名は公式読みを優先する',
    '・人物名は所属事務所・公式プロフィール等を優先する',
    '・確認に使った根拠や注意点があれば note に簡潔に記入する',
    '',
    '元CSVの、行数・行順・id・sourceText を変えないでください。',
    '最終出力は、元CSVと同じ列構成・同じ行順のCSVにしてください。',
    'CSV以外の余計な説明文は不要です。',
  ].join('\n');
}

// ── 取り込み（ChatGPTから返ってきたCSV） ──

export type ReadingImportStatus = 'approved' | 'needs_review' | 'skip_duplicate' | 'error';
export interface ReadingImportRow {
  line: number;
  id: string;
  sourceText: string;
  reading: string;
  confidence: string;
  reviewStatus: string;
  note: string;
  status: ReadingImportStatus;
  reason?: string;
}
export interface ReadingImportResult {
  ok: boolean;
  /** CSV全体の形式エラー（列が違う等）。あれば行の判定はしない */
  fileError?: string;
  rows: ReadingImportRow[];
  counts: Record<ReadingImportStatus, number>;
}

const emptyCounts = (): Record<ReadingImportStatus, number> => ({ approved: 0, needs_review: 0, skip_duplicate: 0, error: 0 });

/**
 * 取り込むCSVを検証する（DBへは書き込まない）。
 * current: 現在の読み未登録の一覧（Workerの報告から作る）。registered: 既に登録済みの語（上書きしない）
 */
export function validateReadingImport(csvText: string, current: UnregisteredReadingRow[], registered: ReadonlySet<string>): ReadingImportResult {
  const fail = (fileError: string): ReadingImportResult => ({ ok: false, fileError, rows: [], counts: emptyCounts() });
  if (csvText.length > MAX_READING_CSV_BYTES) return fail('CSVが大きすぎます（2MBまで）。');
  const quoteCount = (csvText.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) return fail('CSVの形式が正しくありません（引用符 " が閉じていません）。');
  const table = parseCSV(csvText);
  if (table.length === 0) return fail('CSVが空です。');
  const header = table[0].map((h) => h.trim());
  if (header.length !== READING_CSV_COLUMNS.length || header.some((h, i) => h !== READING_CSV_COLUMNS[i])) {
    return fail(`CSVの列が違います。必要な列（この順番）：${READING_CSV_COLUMNS.join(',')}`);
  }
  if (table.length - 1 > MAX_READING_CSV_ROWS) return fail(`行数が多すぎます（${MAX_READING_CSV_ROWS}行まで）。`);
  const byId = new Map(current.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const rows: ReadingImportRow[] = [];
  const counts = emptyCounts();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: (typeof READING_CSV_COLUMNS)[number]) => (cells[READING_CSV_COLUMNS.indexOf(col)] ?? '').trim();
    const row: ReadingImportRow = {
      line,
      id: get('id'),
      sourceText: get('sourceText'),
      reading: get('reading').replace(/\s+/g, ' '),
      confidence: get('confidence'),
      reviewStatus: get('reviewStatus'),
      note: get('note'),
      status: 'error',
    };
    const error = (reason: string) => {
      row.status = 'error';
      row.reason = reason;
    };
    const base = byId.get(row.id);
    if (cells.length !== READING_CSV_COLUMNS.length) error(`列の数が違います（${cells.length}列）`);
    else if (!row.id) error('idがありません');
    else if (seen.has(row.id)) error('同じidが複数行あります');
    else if (!base) error('idが現在の読み未登録の一覧にありません（書き出し後に登録済み・一覧が変わった可能性）');
    else if (base.sourceText !== row.sourceText) error(`sourceTextが元データと一致しません（元: ${base.sourceText}）`);
    else if (!(READING_CONFIDENCES as readonly string[]).includes(row.confidence)) error('confidenceは high / medium / low のいずれか');
    else if (!(READING_REVIEW_STATUSES as readonly string[]).includes(row.reviewStatus)) error('reviewStatusは approved / needs_review のいずれか');
    else if (row.reviewStatus === 'approved') {
      const check = checkReadingInput(row.sourceText, row.reading);
      if (!check.ok) error(row.reading ? `readingが不正です: ${check.error}` : 'approvedなのにreadingが空です');
      else if (registered.has(row.sourceText)) {
        row.status = 'skip_duplicate';
        row.reason = '既に登録済みの語（上書きしません）';
      } else {
        row.reading = check.reading;
        row.status = 'approved';
      }
    } else if (row.reading && !checkReadingInput(row.sourceText, row.reading).ok) {
      error('readingが不正です（ひらがな・カタカナで入力）');
    } else {
      row.status = 'needs_review';
    }
    if (row.id) seen.add(row.id);
    counts[row.status]++;
    rows.push(row);
  });
  return { ok: true, rows, counts };
}

// ── ChatGPT用セット（CSV＋プロンプト）をまとめる無圧縮ZIP ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 無圧縮(STORE)のZIP。ファイル名はASCIIのみ想定 */
export function createStoredZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8
    local.setUint16(8, 0, true); // STORE
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
