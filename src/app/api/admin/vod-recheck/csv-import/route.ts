// POST /api/admin/vod-recheck/csv-import
// VOD再確認調査の結果CSVを取り込み、manual_csv として配信情報を保存する。
// 必須列: workId, vodService　（1作品1サービス1行）
// 任意列: availabilityType（flatrate/rent/buy/free/unknown）, sourceUrl, confidence, note
//
// workIdの解決は resolveActiveWorkTargets() を使い、候補一覧・CSV出力と同じ対象判定
// ロジックを共有する。work_aliasesに登録された旧workIdはcanonical workIdへ解決され、
// 非活性化（hidden/deleted）された作品・存在しないworkIdは解決不可（拒否）として扱う。
// 同一workIdに複数人物が紐づく場合は、その全員に同じ配信情報を適用する。
// commit=false（デフォルト）: プレビューのみ・DB変更なし。commit=true: 実際に保存 + 監査ログ記録。
// いずれの場合も公開状態（status/deleted）は変更しない（vod_dataのみ更新）。
import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { upsertManualCsvVodProviders, getWork } from '@/lib/work-store';
import { insertVodRecheckLog } from '@/db/write';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { detectRecheckReasons } from '@/lib/vod-recheck';
import type { VodProvider, VodProviderType } from '@/types/vod';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 200;

// ── サービス辞書（work-vod-import / vod-title-import と同じテーブルをこの機能専用に複製） ──
const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix':             { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス':    { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video':  { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video':         { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu':                { id: 15,   logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+':             { id: 337,  logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'U-NEXT':              { id: 97,   logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV':                 { id: 408,  logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi':              { id: 258,  logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA':              { id: 395,  logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD':                 { id: 398,  logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino':              { id: 570,  logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA':               { id: 223,  logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
};

const TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate', subscription: 'flatrate', 見放題: 'flatrate',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  free: 'free', 無料: 'free',
  unknown: 'unknown',
};

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
    return { id: -(h % 90000) - 10200 };
  }
  return SERVICE_LOOKUP[key];
}

// RFC4180準拠の簡易CSVパーサー（BOM・改行コード対応。他のCSV importルートと同じ実装）
function parseCSV(content: string): string[][] {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

interface ParsedRow {
  workId: string;
  vodService: string;
  availabilityType: VodProviderType;
  sourceUrl?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { csv?: unknown; commit?: unknown };
  const { csv, commit } = body;

  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv（文字列）が必要です' }, { status: 400 });
  }

  const table = parseCSV(csv);
  if (table.length < 2) {
    return NextResponse.json({ error: 'CSVにヘッダー行とデータ行が必要です' }, { status: 400 });
  }

  const header = table[0].map((h) => h.trim());
  const workIdIdx = header.indexOf('workId');
  const vodServiceIdx = header.indexOf('vodService');
  if (workIdIdx === -1 || vodServiceIdx === -1) {
    return NextResponse.json({ error: '必須列 workId, vodService がヘッダーに見つかりません' }, { status: 400 });
  }
  const availIdx = header.indexOf('availabilityType');
  const sourceUrlIdx = header.indexOf('sourceUrl');
  const confidenceIdx = header.indexOf('confidence');
  const noteIdx = header.indexOf('note');

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `一度にインポートできるのは最大 ${MAX_ROWS} 行です（${dataRows.length}行が指定されました）` }, { status: 400 });
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  dataRows.forEach((cols, i) => {
    const workId = (cols[workIdIdx] ?? '').trim();
    const vodService = (cols[vodServiceIdx] ?? '').trim();
    if (!workId || !vodService) {
      errors.push(`${i + 2}行目: workId と vodService は必須です`);
      return;
    }
    const availRaw = (availIdx >= 0 ? cols[availIdx] : '')?.trim().toLowerCase() ?? '';
    const availabilityType = availRaw ? TYPE_MAP[availRaw] : 'unknown';
    if (availRaw && !availabilityType) {
      errors.push(`${i + 2}行目: availabilityType の値が不正です（${cols[availIdx]}）`);
      return;
    }
    const confidenceRaw = (confidenceIdx >= 0 ? cols[confidenceIdx] : '')?.trim().toLowerCase();
    const confidence = confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low' ? confidenceRaw : undefined;
    parsed.push({
      workId,
      vodService,
      availabilityType: availabilityType ?? 'unknown',
      sourceUrl: sourceUrlIdx >= 0 ? (cols[sourceUrlIdx] ?? '').trim() || undefined : undefined,
      confidence,
      note: noteIdx >= 0 ? (cols[noteIdx] ?? '').trim() || undefined : undefined,
    });
  });

  if (errors.length > 0) {
    return NextResponse.json({ error: 'CSVの内容にエラーがあります', details: errors }, { status: 400 });
  }

  // workId解決: 候補一覧・CSV出力と共通のロジック（resolveActiveWorkTargets）を使う。
  // 旧workId（work_aliases登録済み）はcanonical workIdへ解決され、非活性化・存在しない
  // workIdはunresolvedWorkIdsに入る（DBは変更しない・読み取りのみ）。
  const workIds = [...new Set(parsed.map((p) => p.workId))];
  const { resolved, unresolved: unresolvedWorkIds } = await resolveActiveWorkTargets(workIds);

  // canonical workId単位でVodProviderへ変換（同一canonicalに複数の入力workId・複数サービス行が
  // 集まる場合は1つの配列にまとめる）
  const providersByCanonical = new Map<string, VodProvider[]>();
  const personsByCanonical = new Map<string, string[]>();
  const canonicalByInput = new Map<string, { canonicalWorkId: string; resolvedViaAlias: boolean }>();

  for (const row of parsed) {
    const target = resolved.get(row.workId);
    if (!target) continue; // unresolved（未解決）はスキップ。unresolvedWorkIdsで報告済み
    canonicalByInput.set(row.workId, { canonicalWorkId: target.canonicalWorkId, resolvedViaAlias: target.resolvedViaAlias });
    personsByCanonical.set(target.canonicalWorkId, target.personNames);

    const svc = lookupService(row.vodService);
    const list = providersByCanonical.get(target.canonicalWorkId) ?? [];
    list.push({
      providerId: svc.id,
      providerName: row.vodService,
      logoPath: svc.logoPath,
      type: row.availabilityType,
      countryCode: 'JP',
      source: 'manual_csv',
      sourceLabel: 'CSV',
      sourceUrl: row.sourceUrl,
      confidence: row.confidence,
      note: row.note,
      checkedDate: new Date().toISOString().slice(0, 10),
      updatedAt: Date.now(),
    });
    providersByCanonical.set(target.canonicalWorkId, list);
  }

  const preview = [...providersByCanonical.entries()].map(([canonicalWorkId, providers]) => {
    // このcanonicalに解決された入力workIdのうち、canonical自身と異なるもの（= 旧workIdだった）を集める
    const resolvedFrom = [...canonicalByInput.entries()]
      .filter(([, v]) => v.canonicalWorkId === canonicalWorkId && v.resolvedViaAlias)
      .map(([inputWorkId]) => inputWorkId);
    return {
      workId: canonicalWorkId,
      resolvedFrom: resolvedFrom.length > 0 ? resolvedFrom : undefined,
      persons: personsByCanonical.get(canonicalWorkId) ?? [],
      providers: providers.map((p) => ({ providerName: p.providerName, type: p.type })),
    };
  });

  if (!commit) {
    return NextResponse.json({
      commit: false,
      preview,
      unresolvedWorkIds,
      totalWorkIds: providersByCanonical.size,
      totalRows: parsed.length,
    });
  }

  // ── 実行 ──
  const terminatedSlugs = await getInactiveProviderSlugs();
  const now = Date.now();
  let updatedWorks = 0;
  const applyErrors: string[] = [];

  for (const [workId, providers] of providersByCanonical.entries()) {
    const persons = personsByCanonical.get(workId) ?? [];
    for (const personName of persons) {
      try {
        const before = await getWork(personName, workId);
        const beforeDetection = before ? detectRecheckReasons({
          vodProviders: before.vodProviders,
          lastVodCheckAt: before.lastVodCheckAt,
          vodAiCheckedAt: before.vodAiCheckedAt,
          terminatedSlugs,
          isHighTraffic: false,
          isPostMergeUnchecked: false,
          now,
        }) : undefined;

        // vod_dataのみ更新。status/deleted（公開状態）は一切変更しない
        await upsertManualCsvVodProviders(personName, workId, providers);

        const after = await getWork(personName, workId);
        const afterDetection = after ? detectRecheckReasons({
          vodProviders: after.vodProviders,
          lastVodCheckAt: after.lastVodCheckAt,
          vodAiCheckedAt: after.vodAiCheckedAt,
          terminatedSlugs,
          isHighTraffic: false,
          isPostMergeUnchecked: false,
          now,
        }) : undefined;

        try {
          await insertVodRecheckLog({
            personName,
            workId,
            action: 'complete',
            performedBy: 'admin:vod-recheck-csv-import',
            note: `CSVインポート: ${providers.length}件のVOD情報を反映`,
            updatedProviderCount: providers.length,
            activeCountBefore: beforeDetection?.activeCount,
            activeCountAfter: afterDetection?.activeCount,
            unknownCountBefore: beforeDetection?.unknownCount,
            unknownCountAfter: afterDetection?.unknownCount,
            vodCheckStatusAfter: after?.vodCheckStatus,
          });
        } catch (logErr) {
          console.warn('[vod-recheck/csv-import] 監査ログ書き込み失敗:', String(logErr));
        }

        updatedWorks++;
      } catch (err) {
        applyErrors.push(`${workId} / ${personName}: ${String(err)}`);
      }
    }
  }

  return NextResponse.json({
    commit: true,
    updatedWorks,
    unresolvedWorkIds,
    errors: applyErrors,
  });
}
