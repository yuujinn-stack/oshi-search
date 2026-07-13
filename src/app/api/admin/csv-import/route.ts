import { NextRequest, NextResponse } from 'next/server';
import { getWorksForImport } from '@/lib/work-store';
import { batchUpdateVodData } from '@/db/write';
import { normalizeProviderName, VOD_SOURCE_PRIORITY, VOD_SOURCE_LABEL } from '@/lib/vod-dedup';
import type { VodProvider, VodProviderType } from '@/types/vod';

// Vercel 実行時間上限（秒）。同期モードで大量作品を処理する場合のタイムアウト対策。
export const maxDuration = 60;

// POST /api/admin/csv-import
// Preview: { csvContent: string, commit: false, personName?: string, syncMode?: boolean }
// Save:    { commit: true, personName?: string, syncMode?: boolean, normalizedRows: ImportPreviewRow[] }
// 照合キー: personName + workId（workId 単体では別人物の作品を混入させない）
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────

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
  flatrate: 'flatrate', subscription: 'flatrate', 見放題: 'flatrate',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  free: 'free', 無料: 'free',
  ads: 'ads', 'ad-supported': 'ads', 広告付き: 'ads',
  unknown: 'unknown',
};

const REQUIRED_COLS = ['workid', 'vodservice'] as const;

const EXAMPLE_CSV = `workId,personId,vodService,availabilityType,confidence,sourceUrl,note
tmdb-tv-12345,賀喜遥香,Hulu,flatrate,high,https://www.hulu.jp/...,公式ページで確認
tmdb-tv-12345,賀喜遥香,U-NEXT,flatrate,medium,,`;

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────

function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return -(h % 90000) - 10200;
}

// RFC 4180 準拠の簡易 CSV パーサー（BOM・改行コード対応）
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

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? SERVICE_LOOKUP[key] : { id: stringHash(name) };
}

// ─────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────

export interface ImportPreviewRow {
  rowNum: number;   // CSV行番号。同期モードの削除行は 0
  workId: string;
  personName: string;
  title: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
  // skip: 高優先度ソースが同名サービスを既に持つためCSV側をスキップ
  action: 'add' | 'update' | 'delete' | 'skip' | 'ignore' | 'error';
  reason: string;
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const {
    csvContent,
    commit = false,
    personName: bodyPersonName = '',
    syncMode = false,
    normalizedRows: rawNormalizedRows,
  } = body as {
    csvContent?: string;
    commit?: boolean;
    personName?: string;
    syncMode?: boolean;
    normalizedRows?: ImportPreviewRow[];
  };

  // ── SAVE PATH ──
  if (commit) {
    if (!Array.isArray(rawNormalizedRows) || rawNormalizedRows.length === 0) {
      return NextResponse.json({ error: 'normalizedRows が必要です' }, { status: 400 });
    }

    const actionableRows = (rawNormalizedRows as ImportPreviewRow[]).filter(
      (r) => r.action === 'add' || r.action === 'update' || r.action === 'delete',
    );

    for (const r of actionableRows) {
      if (!r.workId || !r.personName) {
        return NextResponse.json(
          { error: 'normalizedRows に workId/personName が不足している行があります' },
          { status: 400 },
        );
      }
    }

    // 対象作品を一括取得（1クエリ）
    const pairMap = new Map<string, { personName: string; workId: string }>();
    for (const r of actionableRows) {
      pairMap.set(`${r.personName}:${r.workId}`, { personName: r.personName, workId: r.workId });
    }
    const workMap = await getWorksForImport([...pairMap.values()]);
    console.log(`[VOD CSV IMPORT] save: DB loaded ${workMap.size} works in ${Date.now() - t0}ms`);

    // (personName + workId) ごとにグループ化
    const workGroups = new Map<string, ImportPreviewRow[]>();
    for (const r of actionableRows) {
      const key = `${r.personName}:${r.workId}`;
      if (!workGroups.has(key)) workGroups.set(key, []);
      workGroups.get(key)!.push(r);
    }

    const today = new Date().toISOString().slice(0, 10);
    const worksToUpdate: Array<{ personName: string; id: string; vodData: Record<string, unknown> }> = [];
    const errors: string[] = [];
    let savedWorkCount = 0;
    let savedProviderCount = 0;
    let deletedProviderCount = 0;

    for (const [key, rows] of workGroups) {
      const dbWork = workMap.get(key);
      if (!dbWork) {
        errors.push(`保存時に作品が見つかりません: ${key}`);
        continue;
      }

      const existingVodData = dbWork.vodData;
      const existingProviders = (existingVodData.vodProviders ?? []) as VodProvider[];
      const nonCsvProviders = existingProviders.filter((p) => p.source !== 'manual_csv');

      // 既存 manual_csv を正規化名→VodProvider のマップにする
      const csvProviderMap = new Map<string, VodProvider>();
      for (const p of existingProviders.filter((p) => p.source === 'manual_csv')) {
        csvProviderMap.set(normalizeProviderName(p.providerName), p);
      }

      // 削除
      for (const r of rows.filter((r) => r.action === 'delete')) {
        if (csvProviderMap.delete(normalizeProviderName(r.vodService))) {
          deletedProviderCount++;
        }
      }

      // 追加・更新
      for (const r of rows.filter((r) => r.action === 'add' || r.action === 'update')) {
        const serviceInfo = lookupService(r.vodService);
        const providerType = TYPE_MAP[r.availabilityType?.toLowerCase() ?? ''] ?? 'flatrate';
        const normName = normalizeProviderName(r.vodService);
        const existing = csvProviderMap.get(normName);
        csvProviderMap.set(normName, {
          providerId: serviceInfo.id,
          providerName: r.vodService,
          logoPath: serviceInfo.logoPath,
          type: providerType,
          countryCode: 'JP',
          source: 'manual_csv',
          sourceLabel: 'CSV調査',
          confidence: (['high', 'medium', 'low'].includes(r.confidence)
            ? r.confidence : 'medium') as 'high' | 'medium' | 'low',
          sourceUrl: r.sourceUrl || undefined,
          checkedDate: r.checkedDate || today,
          note: r.note || undefined,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
        savedProviderCount++;
      }

      worksToUpdate.push({
        personName: dbWork.personName,
        id: dbWork.id,
        vodData: {
          ...existingVodData,
          vodProviders: [...nonCsvProviders, ...csvProviderMap.values()],
          vodUpdatedAt: Date.now(),
        },
      });
      savedWorkCount++;
    }

    if (worksToUpdate.length > 0) {
      try {
        await batchUpdateVodData(worksToUpdate, syncMode);
      } catch (dbErr) {
        const msg = String(dbErr);
        console.error(`[VOD CSV IMPORT] batchUpdateVodData failed: ${msg}`);
        return NextResponse.json(
          { error: `DB更新中にエラーが発生しました: ${msg}` },
          { status: 500 },
        );
      }
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[VOD CSV IMPORT] save done in ${elapsed}ms` +
      ` (${savedWorkCount} works, ${savedProviderCount} providers added/updated, ${deletedProviderCount} deleted)`,
    );

    return NextResponse.json({
      syncMode,
      savedWorkCount,
      savedProviderCount,
      deletedProviderCount,
      errors,
      elapsedMs: elapsed,
    });
  }

  // ── PREVIEW PATH ──
  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
  }

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  // 必須列チェック
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

  // 列インデックス（personid / personname 両方認識）
  const COL = {
    workId:           header.indexOf('workid'),
    personId:         Math.max(header.indexOf('personid'), header.indexOf('personname')),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    confidence:       header.indexOf('confidence'),
    sourceUrl:        header.indexOf('sourceurl'),
    checkedDate:      header.indexOf('checkeddate'),
    note:             header.indexOf('note'),
  };

  const dataRows = rows.slice(1);

  // Pass 1: 各行のフィールドを取り出す
  const rawRows = dataRows.map((row, i) => {
    const get = (col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');
    return {
      rowNum: i + 2,
      workId: get(COL.workId),
      personName: get(COL.personId) || bodyPersonName,
      vodService: get(COL.vodService),
      availabilityType: get(COL.availabilityType) || 'flatrate',
      confidence: get(COL.confidence) || 'medium',
      sourceUrl: get(COL.sourceUrl),
      checkedDate: get(COL.checkedDate),
      note: get(COL.note),
    };
  });

  // CSVに登場する (personName, workId) ペアだけを一括取得（1クエリ）
  const pairMap = new Map<string, { personName: string; workId: string }>();
  for (const r of rawRows) {
    if (r.workId && r.personName) {
      pairMap.set(`${r.personName}:${r.workId}`, { personName: r.personName, workId: r.workId });
    }
  }
  const workMap = await getWorksForImport([...pairMap.values()]);
  console.log(`[VOD CSV IMPORT] preview: DB loaded ${workMap.size} works in ${Date.now() - t0}ms`);

  // Pass 2: アクション分類
  const previewRows: ImportPreviewRow[] = [];
  const seenInCsv = new Set<string>();
  // 同期モード用: workキーごとにCSVに登場した正規化 vodService を記録
  const csvServicesPerWork = new Map<string, Set<string>>();

  for (const r of rawRows) {
    if (!r.workId) {
      previewRows.push({
        rowNum: r.rowNum, workId: '', personName: r.personName, title: '', vodService: r.vodService,
        availabilityType: r.availabilityType, confidence: r.confidence, sourceUrl: r.sourceUrl,
        checkedDate: r.checkedDate, note: r.note,
        action: 'error', reason: 'workId が空です',
      });
      continue;
    }

    if (!r.vodService) {
      previewRows.push({
        rowNum: r.rowNum, workId: r.workId, personName: r.personName, title: '', vodService: '',
        availabilityType: r.availabilityType, confidence: r.confidence, sourceUrl: r.sourceUrl,
        checkedDate: r.checkedDate, note: r.note,
        action: 'ignore', reason: 'vodService が空のためスキップ',
      });
      continue;
    }

    if (!r.personName) {
      previewRows.push({
        rowNum: r.rowNum, workId: r.workId, personName: '', title: '', vodService: r.vodService,
        availabilityType: r.availabilityType, confidence: r.confidence, sourceUrl: r.sourceUrl,
        checkedDate: r.checkedDate, note: r.note,
        action: 'error',
        reason: 'personId列がなく対象人物も未選択です。インポート対象の人物をセレクターで選択してください。',
      });
      continue;
    }

    const mapKey = `${r.personName}:${r.workId}`;
    const work = workMap.get(mapKey);
    if (!work) {
      previewRows.push({
        rowNum: r.rowNum, workId: r.workId, personName: r.personName, title: '', vodService: r.vodService,
        availabilityType: r.availabilityType, confidence: r.confidence, sourceUrl: r.sourceUrl,
        checkedDate: r.checkedDate, note: r.note,
        action: 'error',
        reason: `workId "${r.workId}" が "${r.personName}" の作品として見つかりません`,
      });
      continue;
    }

    // CSV 内重複チェック
    const dedupeKey = `${r.personName}:${r.workId}:${r.vodService.toLowerCase()}`;
    if (seenInCsv.has(dedupeKey)) {
      previewRows.push({
        rowNum: r.rowNum, workId: r.workId, personName: work.personName, title: work.title,
        vodService: r.vodService, availabilityType: r.availabilityType, confidence: r.confidence,
        sourceUrl: r.sourceUrl, checkedDate: r.checkedDate, note: r.note,
        action: 'ignore', reason: 'このCSV内で同じ personId+workId+vodService が既出のため無視',
      });
      continue;
    }
    seenInCsv.add(dedupeKey);

    const normalizedVodService = normalizeProviderName(r.vodService);
    const existingProviders = (work.vodData.vodProviders ?? []) as VodProvider[];
    const existingByNorm = existingProviders.find(
      (p) => normalizeProviderName(p.providerName) === normalizedVodService,
    );

    let rowAction: ImportPreviewRow['action'];
    let rowReason: string;

    if (existingByNorm) {
      const existingPriority = VOD_SOURCE_PRIORITY[existingByNorm.source as keyof typeof VOD_SOURCE_PRIORITY] ?? 99;
      if (existingPriority < VOD_SOURCE_PRIORITY['manual_csv']) {
        // 高優先度ソース（TMDb / AI / manual）が同名サービスを保持 → CSV側をスキップ
        rowAction = 'skip';
        rowReason = `${VOD_SOURCE_LABEL[existingByNorm.source as keyof typeof VOD_SOURCE_LABEL] ?? existingByNorm.source}由来の「${existingByNorm.providerName}」が既に存在するためスキップ（CSV側は追加しません）`;
      } else {
        // 既存が manual_csv → 上書き
        rowAction = 'update';
        rowReason = '既存のCSVインポートデータを最新情報で上書き';
      }
    } else {
      rowAction = 'add';
      rowReason = '新規追加';
    }

    // 同期モード用: add/update/skip いずれもCSVに「このサービスが含まれている」として記録
    if (rowAction === 'add' || rowAction === 'update' || rowAction === 'skip') {
      if (!csvServicesPerWork.has(mapKey)) csvServicesPerWork.set(mapKey, new Set());
      csvServicesPerWork.get(mapKey)!.add(normalizedVodService);
    }

    previewRows.push({
      rowNum: r.rowNum, workId: r.workId, personName: work.personName, title: work.title,
      vodService: r.vodService, availabilityType: r.availabilityType, confidence: r.confidence,
      sourceUrl: r.sourceUrl, checkedDate: r.checkedDate, note: r.note,
      action: rowAction, reason: rowReason,
    });
  }

  // ── 同期モード: CSVにない既存 manual_csv を削除予定行として追加 ──
  // 対象: CSVに登場した personName + workId の組み合わせのみ
  // TMDb / AI / manual ソースは対象外
  if (syncMode) {
    for (const [mapKey, csvServices] of csvServicesPerWork) {
      const work = workMap.get(mapKey);
      if (!work) continue;
      for (const p of ((work.vodData.vodProviders ?? []) as VodProvider[])) {
        if (p.source !== 'manual_csv') continue;
        // normalizeProviderName で比較（toLowerCase のみでは前後空白・CSV表記を正規化できない）
        if (!csvServices.has(normalizeProviderName(p.providerName))) {
          previewRows.push({
            rowNum: 0, // CSV 由来でない行
            workId: work.id,
            personName: work.personName,
            title: work.title,
            vodService: p.providerName,
            availabilityType: p.type,
            confidence: p.confidence ?? '',
            sourceUrl: p.sourceUrl ?? '',
            checkedDate: p.checkedDate ?? '',
            note: p.note ?? '',
            action: 'delete',
            reason: '同期モード: CSVに記載がないため削除',
          });
        }
      }
    }
  }

  const addCount    = previewRows.filter((r) => r.action === 'add').length;
  const updateCount = previewRows.filter((r) => r.action === 'update').length;
  const deleteCount = previewRows.filter((r) => r.action === 'delete').length;
  const skipCount   = previewRows.filter((r) => r.action === 'skip').length;
  const ignoreCount = previewRows.filter((r) => r.action === 'ignore').length;
  const errorCount  = previewRows.filter((r) => r.action === 'error').length;

  const elapsed = Date.now() - t0;
  console.log(
    `[VOD CSV IMPORT] preview done in ${elapsed}ms` +
    ` (${pairMap.size} unique works, ${dataRows.length} rows)`,
  );

  return NextResponse.json({
    syncMode,
    addCount,
    updateCount,
    deleteCount,
    skipCount,
    ignoreCount,
    errorCount,
    previewRows,
    elapsedMs: elapsed,
  });
}
