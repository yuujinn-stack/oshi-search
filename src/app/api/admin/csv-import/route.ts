import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks, upsertManualCsvVodProviders } from '@/lib/work-store';
import type { VodProvider, VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// POST /api/admin/csv-import
// body: { csvContent: string, commit?: boolean }
// commit=false (default): プレビューのみ（保存しない）
// commit=true: 実際に保存する
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────

// よく使われる配信サービス名 → TMDb providerId マッピング
const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu': { id: 15, logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Disney Plus': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Apple TV+': { id: 350, logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'AppleTV+': { id: 350, logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'U-NEXT': { id: 97, logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV': { id: 408, logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi': { id: 258, logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA': { id: 395, logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'FODプレミアム': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'レミノ': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'アベマ': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'NHKプラス': { id: -101 },
  'NHK+': { id: -101 },
  'NHKオンデマンド': { id: -107 },
  'TVer': { id: -102 },
  'YouTube': { id: 192, logoPath: '/oIkQkEkwfmcG7IGpRR1NB8frZZM.jpg' },
  '楽天TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'RakutenTV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'Rakuten TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'DMM TV': { id: -104 },
  'DMMTV': { id: -104 },
  'WOWOW': { id: -105 },
  'WOWOWオンデマンド': { id: -105 },
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

const REQUIRED_COLS = ['workid', 'vodservice'] as const;

const EXAMPLE_CSV = `workId,vodService,availabilityType,confidence,sourceUrl,note
abc123,Hulu,flatrate,high,https://www.hulu.jp/...,公式ページで確認
abc123,Lemino,flatrate,medium,,配信情報サイトで確認
def456,Netflix,flatrate,high,https://www.netflix.com/jp/title/...,`;

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────

function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return -(h % 90000) - 10200;
}

// RFC 4180 準拠の簡易 CSV パーサー（BOM・改行コード対応）
function parseCSV(content: string): string[][] {
  const normalized = content
    .replace(/^﻿/, '')   // BOM 除去（UTF-8 BOM あり/なし 両対応）
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
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

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key) return SERVICE_LOOKUP[key];
  return { id: stringHash(name) };
}

// ─────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────

export interface ImportPreviewRow {
  rowNum: number;
  workId: string;
  personName: string;
  title: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
  action: 'add' | 'update' | 'ignore' | 'error';
  reason: string;
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { csvContent, commit = false } = body as {
    csvContent?: string;
    commit?: boolean;
  };

  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  // ── CSVパース ──
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
  }

  // ヘッダー行を小文字・スペース除去で正規化して列インデックスを取得
  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  // 必須列チェック（不足していたら詳細エラーを返す）
  const missingCols = REQUIRED_COLS.filter((col) => header.indexOf(col) === -1);
  if (missingCols.length > 0) {
    const foundDisplay = rawHeader.map((h) => h.trim()).join(', ') || '（列が見つかりません）';
    const missingDisplay = missingCols
      .map((c) => (c === 'workid' ? 'workId' : 'vodService'))
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

  // 列インデックス（任意列は -1 = 存在しない）
  const COL = {
    workId:           header.indexOf('workid'),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    confidence:       header.indexOf('confidence'),
    sourceUrl:        header.indexOf('sourceurl'),
    checkedDate:      header.indexOf('checkeddate'),
    note:             header.indexOf('note'),
  };

  // ── 全作品を workId → WorkRecord にインデックス化 ──
  const persons = getAllPersonsWithConfig();
  const workMap = new Map<string, WorkRecord>();
  for (const person of persons) {
    const works = await getAllWorks(person.name);
    for (const w of works) workMap.set(w.id, w);
  }

  // ── データ行をパース・バリデーション ──
  const previewRows: ImportPreviewRow[] = [];
  const seenInCsv = new Set<string>(); // workId:vodService（CSV内重複除去用）

  const dataRows = rows.slice(1);
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const get = (col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');

    const workId           = get(COL.workId);
    const vodService       = get(COL.vodService);
    const availabilityType = get(COL.availabilityType) || 'flatrate';
    const confidence       = get(COL.confidence) || 'medium';
    const sourceUrl        = get(COL.sourceUrl);
    const checkedDate      = get(COL.checkedDate);
    const note             = get(COL.note);

    // workId が空 → エラー
    if (!workId) {
      previewRows.push({
        rowNum: i + 2, workId: '', personName: '', title: '', vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'error', reason: 'workId が空です',
      });
      continue;
    }

    // vodService が空 → スキップ（無視）
    if (!vodService) {
      previewRows.push({
        rowNum: i + 2, workId, personName: '', title: '', vodService: '',
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'ignore', reason: 'vodService が空のためスキップ',
      });
      continue;
    }

    // workId が DB に存在しない → エラー
    const work = workMap.get(workId);
    if (!work) {
      previewRows.push({
        rowNum: i + 2, workId, personName: '', title: '', vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'error', reason: `workId "${workId}" が見つかりません`,
      });
      continue;
    }

    // CSV内の重複 → 無視（同じ workId+vodService が既出）
    const dedupeKey = `${workId}:${vodService.toLowerCase()}`;
    if (seenInCsv.has(dedupeKey)) {
      previewRows.push({
        rowNum: i + 2, workId, personName: work.personName, title: work.title, vodService,
        availabilityType, confidence, sourceUrl, checkedDate, note,
        action: 'ignore', reason: 'このCSV内で同じ workId+vodService が既出のため無視',
      });
      continue;
    }
    seenInCsv.add(dedupeKey);

    // DB内に同じ manual_csv エントリが存在するか確認（add vs update）
    const existingCsvEntry = (work.vodProviders ?? []).find(
      (p) =>
        p.source === 'manual_csv' &&
        p.providerName.toLowerCase() === vodService.toLowerCase(),
    );

    previewRows.push({
      rowNum: i + 2,
      workId,
      personName: work.personName,
      title: work.title,
      vodService,
      availabilityType,
      confidence,
      sourceUrl,
      checkedDate,
      note,
      action: existingCsvEntry ? 'update' : 'add',
      reason: existingCsvEntry ? '既存のCSVインポートデータを最新情報で上書き' : '新規追加',
    });
  }

  const addCount    = previewRows.filter((r) => r.action === 'add').length;
  const updateCount = previewRows.filter((r) => r.action === 'update').length;
  const ignoreCount = previewRows.filter((r) => r.action === 'ignore').length;
  const errorCount  = previewRows.filter((r) => r.action === 'error').length;

  // プレビューのみ → ここで返す
  if (!commit) {
    return NextResponse.json({ addCount, updateCount, ignoreCount, errorCount, previewRows });
  }

  // ── コミット: workId ごとにグループ化してアップサート ──
  const workGroups = new Map<string, ImportPreviewRow[]>();
  for (const row of previewRows) {
    if (row.action !== 'add' && row.action !== 'update') continue;
    if (!workGroups.has(row.workId)) workGroups.set(row.workId, []);
    workGroups.get(row.workId)!.push(row);
  }

  let savedWorkCount = 0;
  let savedProviderCount = 0;
  const errors: string[] = [];

  for (const [workId, importRows] of workGroups) {
    const work = workMap.get(workId);
    if (!work) continue;

    const providers: VodProvider[] = importRows.map((row) => {
      const serviceInfo = lookupService(row.vodService);
      const providerType = TYPE_MAP[row.availabilityType.toLowerCase()] ?? 'flatrate';
      const today = new Date().toISOString().slice(0, 10);
      return {
        providerId: serviceInfo.id,
        providerName: row.vodService,
        logoPath: serviceInfo.logoPath,
        type: providerType,
        countryCode: 'JP',
        source: 'manual_csv' as const,
        sourceLabel: 'CSV調査',
        confidence: (['high', 'medium', 'low'].includes(row.confidence)
          ? row.confidence
          : 'medium') as 'high' | 'medium' | 'low',
        sourceUrl: row.sourceUrl || undefined,
        checkedDate: row.checkedDate || today,
        note: row.note || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    try {
      const { added, updated } = await upsertManualCsvVodProviders(work.personName, workId, providers);
      if (added + updated > 0) {
        savedWorkCount++;
        savedProviderCount += added + updated;
      }
    } catch (err) {
      errors.push(`workId=${workId}: ${String(err)}`);
    }
  }

  return NextResponse.json({ savedWorkCount, savedProviderCount, errors });
}
