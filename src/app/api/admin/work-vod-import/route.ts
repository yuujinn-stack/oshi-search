// POST /api/admin/work-vod-import
// 作品・配信情報の統合CSVインポート
// CSV列: personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note
//
// 動作:
//   - personName が未登録 → action:'unknown_person'（登録しない）
//   - 既存作品に一致 → action:'add_vod'（VODのみ追加）
//   - 作品が存在しない → action:'create_work'（作品を新規作成 + VOD追加）
// commit=false: プレビューのみ
// commit=true:  実際に保存

import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, saveWorkIfAbsent, upsertManualCsvVodProviders } from '@/lib/work-store';
import type { WorkRecord } from '@/types/work';
import type { VodProvider, VodProviderType } from '@/types/vod';

export const dynamic = 'force-dynamic';

// ── サービス辞書（vod-title-import と同じ） ──────────────────────────────────
const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix':             { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス':    { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video':  { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video':         { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu':                { id: 15,   logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+':             { id: 337,  logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Disney Plus':         { id: 337,  logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Apple TV+':           { id: 350,  logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'AppleTV+':            { id: 350,  logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'U-NEXT':              { id: 97,   logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV':                 { id: 408,  logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi':              { id: 258,  logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA':              { id: 395,  logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD':                 { id: 398,  logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'FODプレミアム':       { id: 398,  logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino':              { id: 570,  logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'レミノ':              { id: 570,  logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA':               { id: 223,  logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'アベマ':              { id: 223,  logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'NHKプラス':           { id: -101 },
  'NHK+':                { id: -101 },
  'NHKオンデマンド':     { id: -107 },
  'TVer':                { id: -102 },
  'YouTube':             { id: 192,  logoPath: '/oIkQkEkwfmcG7IGpRR1NB8frZZM.jpg' },
  '楽天TV':              { id: 35,   logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'RakutenTV':           { id: 35,   logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'Rakuten TV':          { id: 35,   logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'DMM TV':              { id: -104 },
  'DMMTV':               { id: -104 },
  'WOWOW':               { id: -105 },
  'WOWOWオンデマンド':   { id: -105 },
  'dアニメストア':       { id: -106 },
  'バンダイチャンネル':  { id: -108 },
};

const TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate', subscription: 'flatrate', 見放題: 'flatrate',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  free: 'free', 無料: 'free',
  ads: 'ads', 'ad-supported': 'ads', 広告付き: 'ads',
  unknown: 'unknown',
};

// ── ユーティリティ ───────────────────────────────────────────────────────────

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[「」『』【】〈〉《》（）()[\]、。・～〜~]/g, '');
}

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
    return { id: -(h % 90000) - 10200 };
  }
  return SERVICE_LOOKUP[key];
}

// CSV-imported manual work の決定論的 ID（同一内容の重複登録を防ぐ）
function manualWorkId(personName: string, normTitle: string, workType: string): string {
  let h = 5381;
  const str = `manual_csv:${personName}:${normTitle}:${workType}`;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return `mc_${h.toString(36)}`;
}

// RFC 4180 準拠 CSV パーサー（BOM・CRLF 対応）
function parseCSV(content: string): string[][] {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const fields: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
          } else cur += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === ',') { fields.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      fields.push(cur);
      return fields;
    })
    .filter((row) => row.some((f) => f.trim() !== ''));
}

// ── 型定義 ──────────────────────────────────────────────────────────────────

export type WorkVodRowAction = 'add_vod' | 'create_work' | 'unknown_person' | 'error';

export interface WorkVodPreviewRow {
  rowNum: number;
  personName: string;
  workTitle: string;
  workType: string;
  releaseYear?: number;
  roleName?: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  note: string;
  action: WorkVodRowAction;
  reason: string;
  matchedWorkId?: string;
  matchedWorkTitle?: string;
  isNewWork: boolean;
}

// ── ハンドラー ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { csvContent, commit = false } = body as { csvContent?: string; commit?: boolean };

  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
  }

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  const required = ['personname', 'worktitle', 'worktype', 'vodservice'];
  const missing = required.filter((c) => !header.includes(c)).map((c) => rawHeader[header.indexOf(c)] ?? c);
  if (missing.length) {
    return NextResponse.json(
      {
        error: '必須列が不足しています',
        details: {
          foundColumns: rawHeader.map((h) => h.trim()).join(', ') || '（列なし）',
          missingColumns: missing.join(', '),
          example: 'personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note',
        },
      },
      { status: 400 },
    );
  }

  const COL = {
    personName:       header.indexOf('personname'),
    workTitle:        header.indexOf('worktitle'),
    workType:         header.indexOf('worktype'),
    releaseYear:      header.indexOf('releaseyear'),
    roleName:         header.indexOf('rolename'),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    confidence:       header.indexOf('confidence'),
    sourceUrl:        header.indexOf('sourceurl'),
    note:             header.indexOf('note'),
  };

  // 全登録済み人物名セット
  const persons = await getAllPersonsMerged();
  const personNames = new Set(persons.map((p) => p.name));

  // 人物ごとの全作品を事前ロード（重複API呼び出し防止）
  const worksCache = new Map<string, WorkRecord[]>();
  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '');

  // プレビュー行・コミット用マップ
  const previewRows: WorkVodPreviewRow[] = [];
  // key: `${personName}\x00${workId}` → { work, isNew, providers }
  const commitMap = new Map<string, {
    personName: string;
    work: WorkRecord;
    isNew: boolean;
    providers: VodProvider[];
  }>();

  let addVodCount = 0;
  let createWorkCount = 0;
  let unknownPersonCount = 0;
  let errorCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const personName   = get(row, COL.personName);
    const workTitle    = get(row, COL.workTitle);
    const workTypeRaw  = get(row, COL.workType).toLowerCase();
    const releaseYearRaw = get(row, COL.releaseYear);
    const roleName     = get(row, COL.roleName);
    const vodService   = get(row, COL.vodService);
    const availType    = get(row, COL.availabilityType) || 'flatrate';
    const confidence   = get(row, COL.confidence) || 'high';
    const sourceUrl    = get(row, COL.sourceUrl);
    const note         = get(row, COL.note);
    const rowNum       = i + 1;
    const releaseYear  = releaseYearRaw ? Number(releaseYearRaw) : undefined;
    const workType     = workTypeRaw === 'movie' ? 'movie' : 'tv';

    if (!personName || !workTitle || !vodService) {
      previewRows.push({
        rowNum, personName, workTitle, workType, releaseYear, roleName,
        vodService, availabilityType: availType, confidence, sourceUrl, note,
        action: 'error', reason: !personName ? 'personName が空' : !workTitle ? 'workTitle が空' : 'vodService が空',
        isNewWork: false,
      });
      errorCount++;
      continue;
    }

    // ① 人物確認
    if (!personNames.has(personName)) {
      previewRows.push({
        rowNum, personName, workTitle, workType, releaseYear, roleName,
        vodService, availabilityType: availType, confidence, sourceUrl, note,
        action: 'unknown_person', reason: `「${personName}」はシステムに登録されていません`,
        isNewWork: false,
      });
      unknownPersonCount++;
      continue;
    }

    // ② 作品検索（人物の全作品をキャッシュ）
    if (!worksCache.has(personName)) {
      worksCache.set(personName, await getAllWorks(personName));
    }
    const allWorks = worksCache.get(personName)!;
    const normQuery = normalizeTitle(workTitle);

    const candidates = allWorks.filter((w) => {
      if (normalizeTitle(w.title) !== normQuery &&
          (!w.originalTitle || normalizeTitle(w.originalTitle) !== normQuery)) return false;
      if (w.type !== workType) return false;
      if (releaseYear && w.releaseYear && w.releaseYear !== releaseYear) return false;
      return true;
    });

    const svc  = lookupService(vodService);
    const type = TYPE_MAP[availType.toLowerCase()] ?? 'flatrate';
    const conf = (['high', 'medium', 'low'] as const).includes(confidence as 'high' | 'medium' | 'low')
      ? (confidence as 'high' | 'medium' | 'low')
      : 'high';

    const provider: VodProvider = {
      providerId:   svc.id,
      providerName: vodService,
      logoPath:     svc.logoPath,
      type,
      countryCode:  'JP',
      source:       'manual_csv',
      sourceLabel:  'CSV手動',
      confidence:   conf,
      sourceUrl:    sourceUrl || undefined,
      note:         note || undefined,
      checkedDate:  new Date().toISOString().slice(0, 10),
      createdAt:    Date.now(),
      updatedAt:    Date.now(),
    };

    if (candidates.length > 0) {
      // ③-a 既存作品に配信情報追加
      const matched = candidates[0];
      const key = `${personName}\x00${matched.id}`;

      previewRows.push({
        rowNum, personName, workTitle, workType, releaseYear, roleName,
        vodService, availabilityType: availType, confidence, sourceUrl, note,
        action: 'add_vod',
        reason: `「${matched.title}」（${matched.type}/${matched.releaseYear ?? '年不明'}）に配信情報追加`,
        matchedWorkId: matched.id, matchedWorkTitle: matched.title,
        isNewWork: false,
      });
      addVodCount++;

      const entry = commitMap.get(key) ?? { personName, work: matched, isNew: false, providers: [] };
      if (!entry.providers.some((p) => p.providerName.toLowerCase() === vodService.toLowerCase())) {
        entry.providers.push(provider);
      }
      commitMap.set(key, entry);

    } else {
      // ③-b 新規作品を作成して配信情報を追加
      const normTitle  = normalizeTitle(workTitle);
      const newWorkId  = manualWorkId(personName, normTitle, workType);
      const key        = `${personName}\x00${newWorkId}`;

      const newWork: WorkRecord = {
        id:             newWorkId,
        personName,
        title:          workTitle,
        normalizedTitle: normTitle,
        type:           workType,
        source:         'manual_csv',
        releaseYear:    releaseYear || undefined,
        roleName:       roleName || undefined,
        confidenceScore: 0,
        status:         'needs_review',
        usedAi:         false,
        createdAt:      Date.now(),
        updatedAt:      Date.now(),
      };

      previewRows.push({
        rowNum, personName, workTitle, workType, releaseYear, roleName,
        vodService, availabilityType: availType, confidence, sourceUrl, note,
        action: 'create_work',
        reason: `作品を新規作成（手動CSV）して配信情報追加。ステータス: 確認待ち`,
        matchedWorkId: newWorkId,
        isNewWork: true,
      });
      createWorkCount++;

      const existing = commitMap.get(key);
      if (existing) {
        if (!existing.providers.some((p) => p.providerName.toLowerCase() === vodService.toLowerCase())) {
          existing.providers.push(provider);
        }
      } else {
        commitMap.set(key, { personName, work: newWork, isNew: true, providers: [provider] });
      }
    }
  }

  if (!commit) {
    return NextResponse.json({
      previewRows,
      addVodCount,
      createWorkCount,
      unknownPersonCount,
      errorCount,
    });
  }

  // ── コミット処理 ────────────────────────────────────────────────────────────
  let savedWorkCount = 0;
  let savedVodCount  = 0;
  const errors: string[] = [];

  for (const { personName, work, isNew, providers } of commitMap.values()) {
    try {
      if (isNew) {
        const result = await saveWorkIfAbsent(work);
        if (result === 'created') savedWorkCount++;
      }
      const vod = await upsertManualCsvVodProviders(personName, work.id, providers);
      savedVodCount += vod.added + vod.updated;
    } catch (err) {
      errors.push(`${personName} / ${work.title}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    savedWorkCount,
    savedVodCount,
    errors,
    unknownPersons: [...new Set(
      previewRows.filter((r) => r.action === 'unknown_person').map((r) => r.personName),
    )],
  });
}
