// POST /api/admin/vod-title-import
// 作品タイトルで全人物の既存作品を照合し、配信情報を manual_csv として登録する
// 必須列: workTitle, vodService
// 任意列: availabilityType, sourceUrl, confidence, note
import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, upsertManualCsvVodProviders } from '@/lib/work-store';
import type { VodProvider, VodProviderType } from '@/types/vod';

export const dynamic = 'force-dynamic';

// ── 配信サービス名 → TMDb ID / ロゴ ─────────────────────────────────────────
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
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[「」『』【】〈〉《》（）()[\]、。・～〜~]/g, '');
}

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  // 未知サービスは名前ハッシュで負の ID を割り当て
  if (!key) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
    return { id: -(h % 90000) - 10200 };
  }
  return SERVICE_LOOKUP[key];
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

// ── 型定義 ──────────────────────────────────────────────────────────────────

export interface VodTitlePreviewRow {
  rowNum: number;
  workTitle: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  note: string;
  personName: string;
  matchedWorkId: string;
  matchedWorkTitle: string;
  action: 'add' | 'update' | 'unmatched' | 'error';
  reason: string;
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

  // 必須列チェック
  if (!header.includes('worktitle') || !header.includes('vodservice')) {
    const missing = ['worktitle', 'vodservice'].filter((c) => !header.includes(c))
      .map((c) => (c === 'worktitle' ? 'workTitle' : 'vodService'));
    return NextResponse.json(
      {
        error: '必須列が不足しています',
        details: {
          foundColumns: rawHeader.map((h) => h.trim()).join(', ') || '（列なし）',
          missingColumns: missing.join(', '),
          example: 'workTitle,vodService,availabilityType,sourceUrl,confidence,note\n量産型ルカ,Lemino,flatrate,https://example.com,high,公式確認',
        },
      },
      { status: 400 },
    );
  }

  const COL = {
    workTitle:        header.indexOf('worktitle'),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    confidence:       header.indexOf('confidence'),
    sourceUrl:        header.indexOf('sourceurl'),
    note:             header.indexOf('note'),
  };

  // 全人物の全作品からタイトルインデックスを構築
  const persons = await getAllPersonsMerged();
  const titleIndex = new Map<string, { personName: string; workId: string; title: string }[]>();

  await Promise.all(
    persons.map(async (person) => {
      try {
        const works = await getAllWorks(person.name);
        for (const work of works) {
          const candidates = [work.title, work.originalTitle].filter(Boolean) as string[];
          for (const t of candidates) {
            const key = normalizeTitle(t);
            if (!key) continue;
            const list = titleIndex.get(key) ?? [];
            // 重複エントリを防ぐ（同タイトル・同人物）
            if (!list.some((e) => e.personName === person.name && e.workId === work.id)) {
              list.push({ personName: person.name, workId: work.id, title: work.title });
            }
            titleIndex.set(key, list);
          }
        }
      } catch { /* skip */ }
    }),
  );

  // CSV データ行を処理
  const previewRows: VodTitlePreviewRow[] = [];
  let matchedTitleCount = 0;
  let unmatchedTitleCount = 0;
  let addCount = 0;
  let errorCount = 0;

  // コミット用: (personName, workId) → VodProvider[]
  const commitMap = new Map<string, { personName: string; workId: string; providers: VodProvider[] }>();

  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const workTitle        = get(row, COL.workTitle);
    const vodService       = get(row, COL.vodService);
    const availabilityType = get(row, COL.availabilityType) || 'flatrate';
    const confidence       = get(row, COL.confidence) || 'high';
    const sourceUrl        = get(row, COL.sourceUrl);
    const note             = get(row, COL.note);

    if (!workTitle || !vodService) {
      previewRows.push({
        rowNum: i + 1, workTitle, vodService, availabilityType, confidence, sourceUrl, note,
        personName: '', matchedWorkId: '', matchedWorkTitle: '',
        action: 'error',
        reason: !workTitle ? 'workTitle が空です' : 'vodService が空です',
      });
      errorCount++;
      continue;
    }

    const matches = titleIndex.get(normalizeTitle(workTitle)) ?? [];

    if (matches.length === 0) {
      previewRows.push({
        rowNum: i + 1, workTitle, vodService, availabilityType, confidence, sourceUrl, note,
        personName: '', matchedWorkId: '', matchedWorkTitle: '',
        action: 'unmatched',
        reason: 'TMDb取得済み作品と一致する作品が見つかりません（先にデータ取得を実行してください）',
      });
      unmatchedTitleCount++;
      continue;
    }

    matchedTitleCount++;

    const svc = lookupService(vodService);
    const type = TYPE_MAP[availabilityType.toLowerCase()] ?? 'flatrate';
    const conf = (['high', 'medium', 'low'] as const).includes(confidence as 'high' | 'medium' | 'low')
      ? (confidence as 'high' | 'medium' | 'low')
      : 'high';

    const provider: VodProvider = {
      providerId:      svc.id,
      providerName:    vodService,
      logoPath:        svc.logoPath,
      type,
      countryCode:     'JP',
      source:          'manual_csv',
      sourceLabel:     '手動CSV',
      confidence:      conf,
      sourceUrl:       sourceUrl || undefined,
      note:            note || undefined,
      checkedDate:     new Date().toISOString().slice(0, 10),
      createdAt:       Date.now(),
      updatedAt:       Date.now(),
    };

    for (const match of matches) {
      previewRows.push({
        rowNum: i + 1, workTitle, vodService, availabilityType, confidence, sourceUrl, note,
        personName:       match.personName,
        matchedWorkId:    match.workId,
        matchedWorkTitle: match.title,
        action: 'add',
        reason: `${match.personName}の「${match.title}」と一致`,
      });
      addCount++;

      const key = `${match.personName}\x00${match.workId}`;
      const entry = commitMap.get(key) ?? { personName: match.personName, workId: match.workId, providers: [] };
      // 同一サービス重複防止
      if (!entry.providers.some((p) => p.providerName.toLowerCase() === vodService.toLowerCase())) {
        entry.providers.push(provider);
      }
      commitMap.set(key, entry);
    }
  }

  if (!commit) {
    return NextResponse.json({
      previewRows,
      matchedTitleCount,
      unmatchedTitleCount,
      addCount,
      errorCount,
    });
  }

  // コミット処理
  let savedWorkCount = 0;
  let savedProviderCount = 0;
  const errors: string[] = [];

  for (const { personName, workId, providers } of commitMap.values()) {
    try {
      const result = await upsertManualCsvVodProviders(personName, workId, providers);
      savedWorkCount++;
      savedProviderCount += result.added + result.updated;
    } catch (err) {
      errors.push(`${personName} / ${workId}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    savedWorkCount,
    savedProviderCount,
    unmatchedTitles: [...new Set(
      previewRows.filter((r) => r.action === 'unmatched').map((r) => r.workTitle),
    )],
    errors,
  });
}
