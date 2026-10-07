// 動画「まず見る3作」の読み未登録CSVの往復（書き出し・ChatGPT用プロンプト・一括登録）のテスト。DBへは接続しない。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCSV } from '../csv-parse';
import {
  READING_CSV_COLUMNS,
  buildReadingChatGptPrompt,
  buildUnregisteredReadingRows,
  createStoredZip,
  readingFileTimestamp,
  readingRowId,
  readingRowsToCsv,
  validateReadingImport,
} from '../reading-csv';

const mockGetLatestWorker = vi.hoisted(() => vi.fn());
const mockListReadings = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
vi.mock('@/server/video-jobs/job-store', () => ({
  getLatestWorker: mockGetLatestWorker,
  VideoJobError: class VideoJobError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock('@/server/video-jobs/script-prep-store', () => ({
  listPronunciationReadings: mockListReadings,
  insertPronunciationReadingsIfAbsent: mockInsert,
}));
import { POST } from '@/app/api/admin/video-jobs/pronunciation-readings/import/route';

// Workerの報告（まず見る3作の台本の読み未登録）。他テンプレートの報告は対象外
const report = {
  entries: [
    { personName: '目黒蓮', templateId: 'oshi-first3-v1', unresolvedReadings: [{ kind: 'work' as const, text: 'ザ・ロイヤルファミリー号' }] },
    { personName: '目黒蓮', templateId: 'oshi-short-v1', unresolvedReadings: [{ kind: 'work' as const, text: '別テンプレの語' }] },
  ],
  scriptOnlyEntries: [
    { personName: '遠藤さくら', templateId: 'oshi-first3-v1', unresolvedReadings: [{ kind: 'person' as const, text: '遠藤さくら' }, { kind: 'work' as const, text: 'Actually...' }] },
    { personName: '鈴木絢音', templateId: 'oshi-first3-v1', unresolvedReadings: [{ kind: 'work' as const, text: 'Actually...' }] },
    { personName: '小坂菜緒', templateId: 'oshi-first3-v1', unresolvedReadings: [{ kind: 'work' as const, text: '引越し探偵サクラ' }] },
  ],
};

function filledCsv(rows: ReturnType<typeof buildUnregisteredReadingRows>, fill: (sourceText: string) => [string, string, string, string]): string {
  const table = parseCSV(readingRowsToCsv(rows));
  return [
    table[0].join(','),
    ...table.slice(1).map((cells) => {
      const [reading, confidence, reviewStatus, note] = fill(cells[1]);
      return [...cells.slice(0, 6), reading, confidence, reviewStatus, note].map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
    }),
  ].join('\n');
}

describe('読み未登録CSVの書き出し', () => {
  const rows = buildUnregisteredReadingRows(report);

  it('まず見る3作の読み未登録だけを語ごとに1行（使用人数の多い順）。idは種類＋語で固定', () => {
    expect(rows.map((r) => r.sourceText)).toEqual(['Actually...', 'ザ・ロイヤルファミリー号', '引越し探偵サクラ', '遠藤さくら']);
    expect(rows[0]).toMatchObject({ type: 'english_title', usageCount: 2, personNames: ['遠藤さくら', '鈴木絢音'] });
    expect(rows.find((r) => r.sourceText === '遠藤さくら')!.type).toBe('person_name');
    expect(rows.find((r) => r.sourceText === '引越し探偵サクラ')!.type).toBe('work_title');
    expect(rows[0].id).toBe(readingRowId('work', 'Actually...'));
    expect(readingRowId('work', 'Actually...')).toMatch(/^rd_[0-9a-f]{16}$/);
    expect(readingRowId('work', 'A')).not.toBe(readingRowId('person', 'A'));
  });

  it('CSVは指定の列・人物名は区切ってまとめ、reading等は空欄。秘密情報らしき値を含まない', () => {
    const csv = readingRowsToCsv(rows);
    expect(csv.startsWith('﻿')).toBe(true);
    const table = parseCSV(csv);
    expect(table[0]).toEqual([...READING_CSV_COLUMNS]);
    expect(table).toHaveLength(rows.length + 1);
    const actually = table.find((r) => r[1] === 'Actually...')!;
    expect(actually.slice(3, 10)).toEqual(['2', '遠藤さくら / 鈴木絢音', '「まず見る3作」ナレーションの作品名', '', '', '', '']);
    expect(csv).not.toMatch(/cookie|session|token|secret|api[_-]?key|password|postgres|neon\.tech|https?:\/\//i);
  });

  it('ChatGPT用プロンプト: 件数・ファイル名・列・種類ごとの件数をその時点のデータから入れる', () => {
    const prompt = buildReadingChatGptPrompt(rows, 'unregistered-readings-20261008-1200.csv');
    expect(prompt).toContain('対象CSV：unregistered-readings-20261008-1200.csv');
    expect(prompt).toContain('対象件数：4件');
    expect(prompt).toContain('work_title（作品名（日本語表記））：2件');
    expect(prompt).toContain('person_name（人物名）：1件');
    expect(prompt).toContain('english_title（英字の作品名）：1件');
    expect(prompt).toContain(`CSV列：${READING_CSV_COLUMNS.join(', ')}`);
    expect(prompt).toContain('推測だけで読みを決めない');
    expect(prompt).toContain('confidence="high"、reviewStatus="approved"');
    expect(prompt).toContain('変更禁止列：id, sourceText, type, usageCount, personNames, context');
    // 件数は固定値ではない
    expect(buildReadingChatGptPrompt(rows.slice(0, 1), 'x.csv')).toContain('対象件数：1件');
    expect(prompt).not.toMatch(/cookie|session|token|secret|api[_-]?key|password|https?:\/\//i);
  });

  it('ファイル名の日時は日本時間 YYYYMMDD-HHMM', () => {
    expect(readingFileTimestamp(new Date('2026-10-07T15:05:00Z'))).toBe('20261008-0005');
  });

  it('ChatGPT用セットのZIPにはCSVとプロンプトの2ファイルだけ', () => {
    const enc = new TextEncoder();
    const zip = createStoredZip([
      { name: 'unregistered-readings.csv', data: enc.encode('a,b\n') },
      { name: 'chatgpt-prompt.txt', data: enc.encode('こんにちは') },
    ]);
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('unregistered-readings.csv');
    expect(text).toContain('chatgpt-prompt.txt');
    expect(text).toContain('こんにちは');
  });
});

describe('読みCSVの取り込み検証', () => {
  const rows = buildUnregisteredReadingRows(report);
  const fill = (s: string): [string, string, string, string] =>
    s === 'Actually...' ? ['あくちゅあり', 'high', 'approved', '公式'] : s === '遠藤さくら' ? ['えんどうさくら', 'medium', 'needs_review', ''] : s === '引越し探偵サクラ' ? ['', 'low', 'needs_review', ''] : ['ざろいやるふぁみりーごう', 'high', 'approved', ''];

  it('approvedだけ登録予定。needs_reviewは登録しない。登録済みの語はskip', () => {
    const r = validateReadingImport(filledCsv(rows, fill), rows, new Set(['ザ・ロイヤルファミリー号']));
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ approved: 1, needs_review: 2, skip_duplicate: 1, error: 0 });
    expect(r.rows.find((x) => x.status === 'approved')).toMatchObject({ sourceText: 'Actually...', reading: 'あくちゅあり' });
  });

  it('idの不一致・sourceTextの不一致・不正な読み・不正なconfidence/reviewStatusはエラー', () => {
    const csv = filledCsv(rows, fill)
      .replace(rows.find((r) => r.sourceText === '遠藤さくら')!.id, 'rd_0000000000000000')
      .replace(',ザ・ロイヤルファミリー号,', ',ザ・ロイヤルファミリー,');
    const r = validateReadingImport(csv, rows, new Set());
    const byText = Object.fromEntries(r.rows.map((x) => [x.sourceText, x]));
    expect(byText['遠藤さくら'].status).toBe('error');
    expect(byText['遠藤さくら'].reason).toMatch(/id/);
    expect(byText['ザ・ロイヤルファミリー'].status).toBe('error');
    expect(byText['ザ・ロイヤルファミリー'].reason).toMatch(/sourceText/);
    const bad = validateReadingImport(
      filledCsv(rows, (s) => (s === 'Actually...' ? ['Actually', 'high', 'approved', ''] : s === '遠藤さくら' ? ['えんどう', 'sure', 'approved', ''] : s === '引越し探偵サクラ' ? ['ひっこし', 'high', 'done', ''] : ['', 'high', 'approved', ''])),
      rows,
      new Set(),
    );
    expect(bad.counts.error).toBe(4);
    expect(bad.rows.map((x) => x.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/readingが不正/), expect.stringMatching(/confidence/), expect.stringMatching(/reviewStatus/), expect.stringMatching(/readingが空/)]));
  });

  it('列が違う・引用符が閉じていない・空のCSVは全体エラー（行の判定をしない）', () => {
    expect(validateReadingImport('id,sourceText\nx,y\n', rows, new Set()).fileError).toMatch(/列が違います/);
    expect(validateReadingImport(`${READING_CSV_COLUMNS.join(',')}\n"abc,def\n`, rows, new Set()).fileError).toMatch(/引用符/);
    expect(validateReadingImport('', rows, new Set()).fileError).toMatch(/空/);
  });

  it('同じidが複数行あればエラー', () => {
    const csv = filledCsv(rows, fill);
    const lines = csv.split('\n');
    const r = validateReadingImport([...lines, lines[1]].join('\n'), rows, new Set());
    expect(r.rows[r.rows.length - 1]).toMatchObject({ status: 'error', reason: '同じidが複数行あります' });
  });
});

describe('読みCSV一括登録API', () => {
  const rows = buildUnregisteredReadingRows(report);
  const csv = filledCsv(rows, (s) => (s === 'Actually...' ? ['あくちゅあり', 'high', 'approved', ''] : s === '遠藤さくら' ? ['えんどうさくら', 'medium', 'needs_review', ''] : ['', 'low', 'needs_review', '']));
  const call = (body: object) =>
    POST(new Request('http://localhost/api/admin/video-jobs/pronunciation-readings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never);

  beforeEach(() => {
    mockGetLatestWorker.mockReset().mockResolvedValue({ capcutStore: report });
    mockListReadings.mockReset().mockResolvedValue({ version: '1:0', readings: [] });
    mockInsert.mockReset().mockImplementation(async (items: Array<{ sourceText: string }>) => items.map((i) => i.sourceText));
  });

  it('プレビュー(commit=false)ではDBへ登録しない', async () => {
    const res = await call({ csv, commit: false });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.committed).toBe(false);
    expect(json.counts).toEqual({ approved: 1, needs_review: 3, skip_duplicate: 0, error: 0 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('登録(commit=true)ではapprovedの行だけを登録し、needs_reviewは登録しない', async () => {
    const json = await (await call({ csv, commit: true })).json();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0]).toEqual([{ sourceText: 'Actually...', reading: 'あくちゅあり' }]);
    expect(json.result).toEqual({ registered: 1, skipped: 0, needsReview: 3, errors: 0 });
  });

  it('登録済みの語は上書きせずskip（検証後に他で登録された語もskipに数える）', async () => {
    mockListReadings.mockResolvedValue({ version: '1:1', readings: [{ sourceText: 'Actually...', reading: 'x', updatedAt: '' }] });
    const json = await (await call({ csv, commit: true })).json();
    expect(json.result).toMatchObject({ registered: 0, skipped: 1 });
    mockListReadings.mockResolvedValue({ version: '1:0', readings: [] });
    mockInsert.mockResolvedValue([]);
    const json2 = await (await call({ csv, commit: true })).json();
    expect(json2.result).toMatchObject({ registered: 0, skipped: 1 });
  });

  it('形式が違うCSVは400で登録しない', async () => {
    const res = await call({ csv: 'a,b\n1,2\n', commit: true });
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
