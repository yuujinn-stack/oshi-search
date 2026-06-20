import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, saveWork } from '@/lib/work-store';
import { normalizeWorkTitle } from '@/lib/work-processor';
import type { WorkRecord, WorkType } from '@/types/work';

// POST /api/admin/work-csv-import
// body: {
//   csvContent: string,
//   commit?: boolean,
//   personName?: string,   // CSVにpersonId/personName列がない場合のUI選択フォールバック
// }
//
// CSVフォーマット（列順自由・余分な列可）:
//   必須: workTitle, workType
//   任意: personId（またはpersonName）, releaseYear, roleName
//
// 動作:
//   - personName + normalizedTitle が一致する既存作品はスキップ（重複）
//   - 新規作品のみ追加（source=manual_csv, status=auto_published）
//   - workId は自動採番（csv-{type}-{normalizedTitle.slice(0,32)}）
//   - VOD情報はこの機能では登録しない

// ─────────────────────────────────────────
// 型
// ─────────────────────────────────────────

export interface WorkImportPreviewRow {
  rowNum: number;
  personName: string;
  workTitle: string;
  workType: string;
  releaseYear: string;
  roleName: string;
  action: 'add' | 'skip' | 'error';
  reason: string;
}

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────

// workType の正規化マップ
const TYPE_MAP: Record<string, WorkType> = {
  movie: 'movie', 映画: 'movie', film: 'movie',
  tv: 'tv', ドラマ: 'tv', テレビ: 'tv', series: 'tv', 番組: 'tv',
  バラエティ: 'tv', 特番: 'tv', 舞台映像: 'tv', 舞台: 'tv',
  アニメ: 'tv', 配信: 'tv', 配信番組: 'tv',
};

const REQUIRED_COLS = ['worktitle', 'worktype'] as const;

const EXAMPLE_CSV = `personName,workTitle,workType,releaseYear,roleName
賀喜遥香,ドラマタイトル,tv,2023,主人公
賀喜遥香,映画タイトル,movie,2022,`;

// ─────────────────────────────────────────
// CSV パーサー（RFC 4180・BOM対応）
// ─────────────────────────────────────────

function parseCSV(content: string): string[][] {
  const normalized = content
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = false;
          } else current += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') { fields.push(current); current = ''; }
          else current += ch;
        }
      }
      fields.push(current);
      return fields;
    })
    .filter((row) => row.some((f) => f.trim() !== ''));
}

// ─────────────────────────────────────────
// workId 生成
// ─────────────────────────────────────────

function generateWorkCsvId(type: WorkType, normalizedTitle: string): string {
  return `csv-${type}-${normalizedTitle.slice(0, 32)}`;
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    csvContent,
    commit = false,
    personName: bodyPersonName = '',
  } = body as {
    csvContent?: string;
    commit?: boolean;
    personName?: string;
  };

  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  // ── CSV パース ──
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
  }

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  // 必須列チェック
  const missingCols = REQUIRED_COLS.filter((col) => !header.includes(col));
  if (missingCols.length > 0) {
    const foundDisplay = rawHeader.map((h) => h.trim()).join(', ') || '（列が見つかりません）';
    const missingDisplay = missingCols
      .map((c) => (c === 'worktitle' ? 'workTitle' : 'workType'))
      .join(', ');
    return NextResponse.json(
      {
        error: '必須列が不足しています',
        details: {
          foundColumns: foundDisplay,
          missingColumns: missingDisplay,
          fix: `CSVに ${missingDisplay} 列を追加してください。列順・余分な列は自由です。`,
          example: EXAMPLE_CSV,
        },
      },
      { status: 400 },
    );
  }

  // 列インデックス（personid / personname 両方認識）
  const COL = {
    personId:    Math.max(header.indexOf('personid'), header.indexOf('personname')),
    workTitle:   header.indexOf('worktitle'),
    workType:    header.indexOf('worktype'),
    releaseYear: header.indexOf('releaseyear'),
    roleName:    header.indexOf('rolename'),
  };

  // ── 人物名セット・既存作品をロード ──
  const allPersons = await getAllPersonsMerged();
  const personNameSet = new Set(allPersons.map((p) => p.name));

  // personName → normalizedTitle set のキャッシュ
  const existingTitleMap = new Map<string, Set<string>>();

  async function getExistingTitles(personName: string): Promise<Set<string>> {
    if (!existingTitleMap.has(personName)) {
      const works = await getAllWorks(personName);
      existingTitleMap.set(personName, new Set(works.map((w) => normalizeWorkTitle(w.title))));
    }
    return existingTitleMap.get(personName)!;
  }

  // ── データ行をパース・バリデーション ──
  const previewRows: WorkImportPreviewRow[] = [];
  // CSV内重複チェック用: personName + normalizedTitle
  const seenInCsv = new Set<string>();

  const dataRows = rows.slice(1);
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const get = (col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');

    const csvPersonId  = get(COL.personId);
    const workTitle    = get(COL.workTitle);
    const workTypeRaw  = get(COL.workType);
    const releaseYear  = get(COL.releaseYear);
    const roleName     = get(COL.roleName);

    const effectivePersonName = csvPersonId || bodyPersonName;

    // ── バリデーション ──

    if (!effectivePersonName) {
      previewRows.push({
        rowNum: i + 2, personName: '', workTitle, workType: workTypeRaw, releaseYear, roleName,
        action: 'error',
        reason: 'personId列がなく対象人物も未選択です。インポート対象の人物をセレクターで選択してください。',
      });
      continue;
    }

    if (!personNameSet.has(effectivePersonName)) {
      previewRows.push({
        rowNum: i + 2, personName: effectivePersonName, workTitle, workType: workTypeRaw, releaseYear, roleName,
        action: 'error',
        reason: `"${effectivePersonName}" は登録されていない人物です`,
      });
      continue;
    }

    if (!workTitle) {
      previewRows.push({
        rowNum: i + 2, personName: effectivePersonName, workTitle: '', workType: workTypeRaw, releaseYear, roleName,
        action: 'error', reason: 'workTitle が空です',
      });
      continue;
    }

    const workType = TYPE_MAP[workTypeRaw.toLowerCase()] ?? TYPE_MAP[workTypeRaw];
    if (!workType) {
      previewRows.push({
        rowNum: i + 2, personName: effectivePersonName, workTitle, workType: workTypeRaw, releaseYear, roleName,
        action: 'error',
        reason: `workType "${workTypeRaw}" は無効です（movie / tv / 映画 / ドラマ 等を指定してください）`,
      });
      continue;
    }

    const normalizedTitle = normalizeWorkTitle(workTitle);

    // CSV内重複チェック
    const csvDedupKey = `${effectivePersonName}:${normalizedTitle}`;
    if (seenInCsv.has(csvDedupKey)) {
      previewRows.push({
        rowNum: i + 2, personName: effectivePersonName, workTitle, workType: workTypeRaw, releaseYear, roleName,
        action: 'skip', reason: 'このCSV内で同じ人物の同タイトルが既出のためスキップ',
      });
      continue;
    }
    seenInCsv.add(csvDedupKey);

    // 既存作品との重複チェック（normalizedTitle 一致）
    const existingTitles = await getExistingTitles(effectivePersonName);
    if (existingTitles.has(normalizedTitle)) {
      previewRows.push({
        rowNum: i + 2, personName: effectivePersonName, workTitle, workType: workTypeRaw, releaseYear, roleName,
        action: 'skip', reason: '同タイトルの作品が既に登録されています',
      });
      continue;
    }

    previewRows.push({
      rowNum: i + 2, personName: effectivePersonName, workTitle, workType: workTypeRaw, releaseYear, roleName,
      action: 'add', reason: '新規追加',
    });
  }

  const addCount   = previewRows.filter((r) => r.action === 'add').length;
  const skipCount  = previewRows.filter((r) => r.action === 'skip').length;
  const errorCount = previewRows.filter((r) => r.action === 'error').length;

  if (!commit) {
    return NextResponse.json({ addCount, skipCount, errorCount, previewRows });
  }

  // ── コミット ──
  const addRows = previewRows.filter((r) => r.action === 'add');
  const now = Date.now();
  let savedCount = 0;
  const errors: string[] = [];

  for (const row of addRows) {
    const workType = (TYPE_MAP[row.workType.toLowerCase()] ?? TYPE_MAP[row.workType]) as WorkType;
    const normalizedTitle = normalizeWorkTitle(row.workTitle);
    const workId = generateWorkCsvId(workType, normalizedTitle);

    const yearNum = parseInt(row.releaseYear, 10);
    const work: WorkRecord = {
      id: workId,
      personName: row.personName,
      title: row.workTitle,
      normalizedTitle,
      type: workType,
      source: 'manual_csv',
      releaseYear: isNaN(yearNum) ? undefined : yearNum,
      roleName: row.roleName || undefined,
      confidenceScore: 100,
      status: 'auto_published',
      vodProviders: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveWork(work);
      // 次行の重複チェック用にキャッシュを更新
      existingTitleMap.get(row.personName)?.add(normalizedTitle);
      savedCount++;
    } catch (err) {
      errors.push(`${row.personName}「${row.workTitle}」: ${String(err)}`);
    }
  }

  const failedCount = addRows.length - savedCount;
  return NextResponse.json({ savedCount, skipCount, failedCount, errors });
}
