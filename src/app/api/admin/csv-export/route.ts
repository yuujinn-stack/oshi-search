import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks } from '@/lib/work-store';
import type { WorkRecord } from '@/types/work';

// GET /api/admin/csv-export
//   ?filter=all|auto_published|needs_review|hidden|no_vod|ai_only|tmdb_only
//   &person=NAME          ← 後方互換: 1人に絞り込む
//   &persons=A,B,C        ← 新: カンマ区切り複数人物（省略で全人物）
//   &mode=preview|csv     ← preview なら JSON、csv（デフォルト）なら CSV ファイル
//   &format=full|simple   ← 新: simple=ChatGPT用8列CSV（mode=csv 時のみ有効）
//
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
// 【重要】作品の取得は getAllWorks(personName) で personName スコープ済みの Redis から行う
//         workId だけで絞り込まない（同一workIdを複数人物が持つため）

// ─────────────────────────────────────────
// CSV ユーティリティ
// ─────────────────────────────────────────

function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─────────────────────────────────────────
// ラベル定義
// ─────────────────────────────────────────

const WORK_SOURCE_LABEL: Record<string, string> = {
  tmdb: 'TMDb',
  openai_suggestion: 'AI補完（作品）',
  ai_supplement: 'AI補完確定',
  manual: '手動',
  manual_csv: 'CSV手動',
};

const STATUS_LABEL: Record<string, string> = {
  auto_published: '公開中',
  needs_review: '確認待ち',
  hidden: '非表示',
};

const VOD_TYPE_LABEL: Record<string, string> = {
  flatrate: '見放題',
  rent: 'レンタル',
  buy: '購入',
  free: '無料',
  ads: '広告付き',
  unknown: '不明',
};

// ─────────────────────────────────────────
// フィルタ条件
// 管理画面（PersonWorks.tsx）の表示条件と合わせる
// ─────────────────────────────────────────

function matchesFilter(w: WorkRecord, filterParam: string): boolean {
  switch (filterParam) {
    case 'auto_published':
      return w.status === 'auto_published';
    case 'needs_review':
      return w.status === 'needs_review';
    case 'hidden':
      return w.status === 'hidden';
    case 'no_vod': {
      // hidden は除外
      if (w.status === 'hidden') return false;
      // 「配信確認できず」のみの場合は「配信情報なし」扱い
      const realProviders = (w.vodProviders ?? []).filter(
        (p) => p.providerName !== '配信確認できず',
      );
      // vodStatus が found でなく、実配信情報もない作品
      return realProviders.length === 0 && w.vodStatus !== 'found';
    }
    case 'ai_only':
      return (w.vodProviders ?? []).some(
        (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
      );
    case 'tmdb_only':
      return (w.vodProviders ?? []).some((p) => p.source === 'tmdb_watch_provider');
    default: // 'all'
      return true;
  }
}

// ─────────────────────────────────────────
// 作品 → CSV 行
// ─────────────────────────────────────────

// ChatGPT調査用 8列簡略CSV
function workToSimpleRow(w: WorkRecord, groupName: string): string {
  const vodServices = (w.vodProviders ?? [])
    .filter((p) => p.providerName !== '配信確認できず')
    .map((p) => p.providerName)
    .join('/');
  return [
    csvEscape(w.personName),
    csvEscape(groupName),
    csvEscape(w.title),
    csvEscape(w.type),
    csvEscape(String(w.releaseYear ?? '')),
    csvEscape(w.roleName ?? ''),
    csvEscape(w.source),
    csvEscape(vodServices),
  ].join(',');
}

function workToRow(w: WorkRecord): string {
  const tmdbUrl = w.tmdbId
    ? `https://www.themoviedb.org/${w.type}/${w.tmdbId}`
    : '';
  const vodServices = (w.vodProviders ?? [])
    .filter((p) => p.providerName !== '配信確認できず')
    .map((p) => `${p.providerName}(${VOD_TYPE_LABEL[p.type] ?? p.type})`)
    .join('|');
  const checkedDate = w.vodUpdatedAt
    ? new Date(w.vodUpdatedAt).toISOString().slice(0, 10)
    : '';
  return [
    csvEscape(w.personName),                                     // personId（= personName）
    csvEscape(w.personName),                                     // personName
    csvEscape(w.id),                                             // workId
    csvEscape(w.title),
    csvEscape(w.originalTitle ?? ''),
    csvEscape(w.type),
    csvEscape(String(w.releaseYear ?? '')),
    csvEscape((w.overview ?? '').replace(/[\n\r]/g, ' ').slice(0, 200)),
    csvEscape(String(w.tmdbId ?? '')),
    csvEscape(tmdbUrl),
    csvEscape(w.source),
    csvEscape(WORK_SOURCE_LABEL[w.source] ?? w.source),
    csvEscape(STATUS_LABEL[w.status] ?? w.status),
    csvEscape(vodServices),
    csvEscape(checkedDate),
    csvEscape(w.aiReason ?? ''),
  ].join(',');
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get('filter') ?? 'all';
  const personParam  = searchParams.get('person')  ?? '';   // 後方互換: 1人
  const personsParam = searchParams.get('persons') ?? '';   // 新: カンマ区切り複数
  const mode   = searchParams.get('mode')   ?? 'csv';       // 'preview' | 'csv'
  const format = searchParams.get('format') ?? 'full';      // 'full' | 'simple'

  const allPersons = await getAllPersonsMerged();
  const personGroupMap = new Map(allPersons.map((p) => [p.name, p.group ?? '']));

  // ── 人物絞り込み ──
  // persons=A,B,C (新) → person=NAME (後方互換) → 全人物 の優先順
  let selectedNames: string[] = [];
  if (personsParam) {
    selectedNames = personsParam.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (personParam) {
    selectedNames = [personParam];
  }

  const targetPersons = selectedNames.length > 0
    ? allPersons.filter((p) => selectedNames.includes(p.name))
    : allPersons;

  // 選択名が指定されているのに一致する人物が存在しない場合
  if (selectedNames.length > 0 && targetPersons.length === 0) {
    const label = selectedNames.join(', ');
    console.warn('[csv-export] 対象人物が見つかりません', { selectedNames });

    if (mode === 'preview') {
      return NextResponse.json({
        count: 0,
        personName: label,
        filter: filterParam,
        works: [],
        warning: `"${label}" に一致する人物がいません`,
      });
    }

    return NextResponse.json(
      { error: `"${label}" に一致する人物がいません` },
      { status: 404 },
    );
  }

  // ── 各人物の作品を取得（personName スコープ済みの Redis キーから）──
  // allWorks は targetPersons に属する作品のみを含む
  const allWorks: WorkRecord[] = [];
  for (const person of targetPersons) {
    const works = await getAllWorks(person.name); // works:{personName} から取得
    allWorks.push(...works);
  }

  // ── フィルタリング ──
  const filtered = allWorks.filter((w) => matchesFilter(w, filterParam));

  // ── ソート: personName → releaseYear 降順 ──
  filtered.sort((a, b) => {
    if (a.personName !== b.personName) return a.personName.localeCompare(b.personName);
    return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
  });

  // プレビュー表示名
  const displayName = selectedNames.length === 0
    ? '全人物'
    : selectedNames.length === 1
    ? selectedNames[0]
    : `${selectedNames.length}人選択中`;

  // ── ログ ──
  console.log('[csv-export]', {
    selectedNames: selectedNames.length > 0 ? selectedNames : '（全人物）',
    selectedFilter: filterParam,
    format,
    mode,
    exportCount: filtered.length,
  });

  // ── プレビューモード: JSON を返す ──
  if (mode === 'preview') {
    return NextResponse.json({
      count: filtered.length,
      personName: displayName,
      filter: filterParam,
      works: filtered.map((w) => ({
        workId: w.id,
        title: w.title,
        personName: w.personName,
        status: w.status,
        releaseYear: w.releaseYear ?? null,
        currentVodServices: (w.vodProviders ?? [])
          .filter((p) => p.providerName !== '配信確認できず')
          .map((p) => p.providerName)
          .join(', ') || '—',
      })),
    });
  }

  // ── CSVモード: simple（ChatGPT用8列）──
  if (format === 'simple') {
    const simpleHeaders = ['personName', 'groupName', 'workTitle', 'workType', 'releaseYear', 'roleName', 'source', 'vodServices'];
    const rows = filtered.map((w) => workToSimpleRow(w, personGroupMap.get(w.personName) ?? ''));
    const csv = [simpleHeaders.join(','), ...rows].join('\n');

    const date = new Date().toISOString().slice(0, 10);
    const filename = selectedNames.length === 1
      ? `works_chatgpt_${selectedNames[0]}_${filterParam}_${date}.csv`
      : `works_chatgpt_${filterParam}_${date}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  }

  // ── CSVモード: full（詳細16列）──
  const csvHeaders = [
    'personId', 'personName', 'workId', 'title', 'originalTitle',
    'type', 'releaseYear', 'overview', 'tmdbId', 'tmdbUrl',
    'source', 'sourceLabel', 'status', 'currentVodServices', 'checkedDate', 'memo',
  ];

  const rows = filtered.map(workToRow);
  const csv = '﻿' + [csvHeaders.join(','), ...rows].join('\n'); // BOM付きUTF-8

  const date = new Date().toISOString().slice(0, 10);
  const filename = selectedNames.length === 1
    ? `works_${selectedNames[0]}_${filterParam}_${date}.csv`
    : selectedNames.length > 1
    ? `works_${selectedNames.length}persons_${filterParam}_${date}.csv`
    : `works_${filterParam}_${date}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
