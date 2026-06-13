import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks, updateWorkVod } from '@/lib/work-store';
import type { VodProvider, VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// POST /api/admin/csv-import
// body: { csvContent: string, commit?: boolean }
// commit=false (default): プレビューのみ（保存しない）
// commit=true: 実際に保存する
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）

// よく使われる配信サービス名 → TMDb providerId マッピング
const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video': { id: 9 },
  'Prime Video': { id: 9 },
  'Hulu': { id: 15 },
  'Disney+': { id: 337 },
  'Disney Plus': { id: 337 },
  'Apple TV+': { id: 350 },
  'AppleTV+': { id: 350 },
  'U-NEXT': { id: 97 },
  'dTV': { id: 408 },
  'Paravi': { id: 258 },
  'TELASA': { id: 395 },
  'FOD': { id: 398 },
  'Lemino': { id: 570 },
  'ABEMA': { id: 223 },
  'NHKプラス': { id: -101 },
  'NHK+': { id: -101 },
  'NHKオンデマンド': { id: -107 },
  'TVer': { id: -102 },
  'YouTube': { id: 192 },
  '楽天TV': { id: 35 },
  'RakutenTV': { id: 35 },
  'Rakuten TV': { id: 35 },
  'DMM TV': { id: -104 },
  'WOWOW': { id: -105 },
  'dアニメストア': { id: -106 },
  'バンダイチャンネル': { id: -108 },
};

const TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate',
  subscription: 'flatrate',
  見放題: 'flatrate',
  rent: 'rent',
  rental: 'rent',
  レンタル: 'rent',
  buy: 'buy',
  purchase: 'buy',
  購入: 'buy',
  free: 'free',
  無料: 'free',
  ads: 'ads',
  'ad-supported': 'ads',
  広告付き: 'ads',
  unknown: 'unknown',
};

// 文字列を安定したサービスIDに変換（未知のサービス向け）
function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return -(h % 90000) - 10200; // -100200 〜 -10200 の範囲の負値
}

// RFC 4180 準拠の簡易 CSV パーサー
function parseCSV(content: string): string[][] {
  // BOM を除去
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  return lines
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
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === ',') { fields.push(current); current = ''; }
          else { current += ch; }
        }
      }
      fields.push(current);
      return fields;
    })
    .filter((row) => row.some((f) => f.trim() !== ''));
}

export interface ImportPreviewRow {
  rowNum: number;
  workId: string;
  title: string;
  personName: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
  action: 'add' | 'update' | 'ignore' | 'error';
  reason: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { csvContent, commit = false } = body as { csvContent?: string; commit?: boolean };

  if (!csvContent) {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダーのみです' }, { status: 400 });
  }

  // ヘッダー行（小文字・スペース除去で照合）
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  const COL = {
    workId: header.findIndex((h) => h === 'workid'),
    title: header.findIndex((h) => h === 'title'),
    vodService: header.findIndex((h) => h === 'vodservice'),
    availabilityType: header.findIndex((h) => h === 'availabilitytype'),
    confidence: header.findIndex((h) => h === 'confidence'),
    sourceUrl: header.findIndex((h) => h === 'sourceurl'),
    checkedDate: header.findIndex((h) => h === 'checkeddate'),
    note: header.findIndex((h) => h === 'note'),
  };

  if (COL.workId === -1 || COL.vodService === -1) {
    return NextResponse.json(
      { error: '必須列が不足しています: workId と vodService が必要です' },
      { status: 400 },
    );
  }

  // 全人物の全作品を workId → WorkRecord にインデックス化
  const persons = getAllPersonsWithConfig();
  const workMap = new Map<string, WorkRecord>();
  for (const person of persons) {
    const works = await getAllWorks(person.name);
    for (const w of works) workMap.set(w.id, w);
  }

  // 行をパース・バリデーション
  const previewRows: ImportPreviewRow[] = [];
  const seenWorkService = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const get = (col: number) => (col >= 0 ? row[col]?.trim() ?? '' : '');

    const workId = get(COL.workId);
    const title = get(COL.title);
    const vodService = get(COL.vodService);
    const availabilityType = get(COL.availabilityType) || 'flatrate';
    const confidence = get(COL.confidence) || 'medium';
    const sourceUrl = get(COL.sourceUrl);
    const checkedDate = get(COL.checkedDate);
    const note = get(COL.note);

    if (!workId || !vodService) {
      previewRows.push({
        rowNum: i + 2, workId, title, personName: '', vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'error', reason: 'workId または vodService が空です',
      });
      continue;
    }

    const work = workMap.get(workId);
    if (!work) {
      previewRows.push({
        rowNum: i + 2, workId, title, personName: '', vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'error', reason: `workId "${workId}" が見つかりません`,
      });
      continue;
    }

    // 同CSV内の重複行は無視
    const dedupeKey = `${workId}:${vodService}`;
    if (seenWorkService.has(dedupeKey)) {
      previewRows.push({
        rowNum: i + 2, workId, title: work.title, personName: work.personName, vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'ignore', reason: '重複行（同じ workId+vodService が既出）',
      });
      continue;
    }
    seenWorkService.add(dedupeKey);

    const hasExistingImport = (work.vodProviders ?? []).some((p) => p.source === 'manual_import');

    previewRows.push({
      rowNum: i + 2, workId, title: work.title, personName: work.personName, vodService,
      availabilityType, confidence, sourceUrl, checkedDate, note,
      action: hasExistingImport ? 'update' : 'add',
      reason: hasExistingImport ? '既存のCSVインポートデータを置き換えます' : '新規追加',
    });
  }

  const addCount = previewRows.filter((r) => r.action === 'add').length;
  const updateCount = previewRows.filter((r) => r.action === 'update').length;
  const ignoreCount = previewRows.filter((r) => r.action === 'ignore').length;
  const errorCount = previewRows.filter((r) => r.action === 'error').length;

  if (!commit) {
    return NextResponse.json({ addCount, updateCount, ignoreCount, errorCount, previewRows });
  }

  // コミット: workId ごとにグループ化して一括保存
  const workGroups = new Map<string, ImportPreviewRow[]>();
  for (const row of previewRows) {
    if (row.action === 'error' || row.action === 'ignore') continue;
    if (!workGroups.has(row.workId)) workGroups.set(row.workId, []);
    workGroups.get(row.workId)!.push(row);
  }

  let savedCount = 0;
  const errors: string[] = [];

  for (const [workId, importRows] of workGroups) {
    const work = workMap.get(workId);
    if (!work) continue;

    const providers: VodProvider[] = importRows.map((row) => {
      const serviceInfo = SERVICE_LOOKUP[row.vodService];
      const providerType = TYPE_MAP[row.availabilityType.toLowerCase()] ?? 'flatrate';
      const providerId = serviceInfo ? serviceInfo.id : stringHash(row.vodService);
      return {
        providerId,
        providerName: row.vodService,
        logoPath: serviceInfo?.logoPath,
        type: providerType,
        countryCode: 'JP',
        source: 'manual_import' as const,
        sourceLabel: 'CSV調査インポート',
        confidence: (['high', 'medium', 'low'].includes(row.confidence)
          ? row.confidence
          : 'medium') as 'high' | 'medium' | 'low',
        sourceUrl: row.sourceUrl || undefined,
        checkedDate: row.checkedDate || undefined,
        note: row.note || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    try {
      await updateWorkVod(work.personName, workId, providers, {
        replaceSources: ['manual_import'],
      });
      savedCount++;
    } catch (err) {
      errors.push(`workId=${workId}: ${String(err)}`);
    }
  }

  return NextResponse.json({ savedCount, errors });
}
