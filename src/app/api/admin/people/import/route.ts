import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import {
  getAllImportedPersons,
  saveImportedPersonsBatch,
  type ImportedPerson,
} from '@/lib/imported-persons';
import type { Genre } from '@/types/person';

export const dynamic = 'force-dynamic';

// ─── CSV パーサー（RFC 4180 準拠、BOM・CRLF 対応）────────────────────────────
function parseCSV(content: string): string[][] {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

// ─── alias 分割（, 、 | / に対応）────────────────────────────────────────────
function splitAliases(str: string): string[] {
  if (!str.trim()) return [];
  return str.split(/[,、|/]/).map((s) => s.trim()).filter(Boolean);
}

// ─── ジャンル推論 ─────────────────────────────────────────────────────────────
const ALL_GENRES: Genre[] = ['坂道', '芸人', 'テレビ', 'アーティスト', '俳優'];

function inferGenre(groupName: string, genreInput: string): Genre {
  if ((ALL_GENRES as string[]).includes(genreInput)) return genreInput as Genre;
  if (!groupName) return 'テレビ';
  if (groupName.includes('坂46') || groupName.includes('坂道')) return '坂道';
  return 'テレビ';
}

// ─── 型定義 ─────────────────────────────────────────────────────────────────
export interface PersonPreviewRow {
  rowNum: number;
  name: string;
  group: string;
  genre: Genre;
  aliases: string[];
  tmdbPersonId: number | null;
  description: string;
  action: 'add' | 'skip' | 'error';
  reason: string;
}

// ─── GET: インポート済み人物一覧 ──────────────────────────────────────────────
export async function GET() {
  try {
    const persons = await getAllImportedPersons();
    return NextResponse.json({ persons, total: persons.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── POST: プレビュー（commit=false）または保存（commit=true）────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { csvContent?: string; commit?: boolean };
    const { csvContent, commit = false } = body;

    if (!csvContent?.trim()) {
      return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
    }

    const rows = parseCSV(csvContent);
    if (rows.length < 2) {
      return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
    }

    // ヘッダー正規化
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]/g, ''));
    const col = {
      name:        header.indexOf('name'),
      groupName:   Math.max(header.indexOf('groupname'), header.indexOf('group')),
      aliases:     header.indexOf('aliases'),
      tmdbId:      Math.max(header.indexOf('tmdbid'), header.indexOf('tmdbpersonid')),
      description: header.indexOf('description'),
      genre:       header.indexOf('genre'),
    };

    if (col.name === -1) {
      return NextResponse.json(
        { error: '必須列 "name" が見つかりません', foundColumns: rows[0].join(', ') },
        { status: 400 },
      );
    }

    // 既存人物セット（persons_master.json + persons:published + imported:persons）
    const [mergedPersons, importedPersons] = await Promise.all([
      getAllPersonsMerged(),
      getAllImportedPersons(),
    ]);
    const existingNames = new Set<string>([
      ...mergedPersons.map((p) => p.name),
      ...importedPersons.map((p) => p.name),
    ]);

    const get = (row: string[], c: number) => (c >= 0 ? (row[c] ?? '').trim() : '');

    const previewRows: PersonPreviewRow[] = [];
    const seenInCsv = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const name = get(row, col.name);

      if (!name) {
        previewRows.push({
          rowNum, name: '', group: '', genre: 'テレビ', aliases: [],
          tmdbPersonId: null, description: '',
          action: 'error', reason: 'name が空です',
        });
        continue;
      }

      const group       = get(row, col.groupName);
      const aliasesRaw  = get(row, col.aliases);
      const tmdbRaw     = get(row, col.tmdbId);
      const description = get(row, col.description);
      const genreRaw    = get(row, col.genre);

      const aliases     = splitAliases(aliasesRaw);
      const tmdbPersonId = tmdbRaw && !isNaN(Number(tmdbRaw)) ? Number(tmdbRaw) : null;
      const genre       = inferGenre(group, genreRaw);

      if (seenInCsv.has(name)) {
        previewRows.push({
          rowNum, name, group, genre, aliases, tmdbPersonId, description,
          action: 'skip', reason: 'このCSV内で既出の名前のためスキップ',
        });
        continue;
      }
      seenInCsv.add(name);

      if (existingNames.has(name)) {
        previewRows.push({
          rowNum, name, group, genre, aliases, tmdbPersonId, description,
          action: 'skip', reason: '既に登録済みのためスキップ',
        });
        continue;
      }

      previewRows.push({
        rowNum, name, group, genre, aliases, tmdbPersonId, description,
        action: 'add', reason: '新規追加',
      });
    }

    const addCount   = previewRows.filter((r) => r.action === 'add').length;
    const skipCount  = previewRows.filter((r) => r.action === 'skip').length;
    const errorCount = previewRows.filter((r) => r.action === 'error').length;

    if (!commit) {
      return NextResponse.json({ rows: previewRows, addCount, skipCount, errorCount });
    }

    // ── 保存 ─────────────────────────────────────────────────────────────────
    const toAdd: ImportedPerson[] = previewRows
      .filter((r) => r.action === 'add')
      .map((r) => ({
        name:             r.name,
        group:            r.group,
        genre:            r.genre,
        aliases:          r.aliases,
        tmdbPersonId:     r.tmdbPersonId ?? undefined,
        description:      r.description || undefined,
        status:           'imported' as const,
        importedAt:       Date.now(),
        dataFetchStatus:  'not_started' as const,
      }));

    const errors: string[] = [];
    try {
      await saveImportedPersonsBatch(toAdd);
    } catch (err) {
      errors.push(String(err));
    }

    return NextResponse.json({
      added:   toAdd.map((p) => p.name),
      skipped: previewRows.filter((r) => r.action === 'skip').map((r) => r.name),
      errors,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
