import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks } from '@/lib/work-store';
import type { WorkRecord } from '@/types/work';

// GET /api/admin/csv-export?filter=all|auto_published|needs_review|no_vod|ai_only|tmdb_only&person=NAME
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）

function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const WORK_SOURCE_LABEL: Record<string, string> = {
  tmdb: 'TMDb',
  openai_suggestion: 'AI補完（作品）',
  manual: '手動',
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

function workToRow(w: WorkRecord): string {
  const tmdbUrl = w.tmdbId
    ? `https://www.themoviedb.org/${w.type}/${w.tmdbId}`
    : '';
  const vodServices = (w.vodProviders ?? [])
    .map((p) => `${p.providerName}(${VOD_TYPE_LABEL[p.type] ?? p.type})`)
    .join('|');
  const checkedDate = w.vodUpdatedAt
    ? new Date(w.vodUpdatedAt).toISOString().slice(0, 10)
    : '';
  const memo = w.aiReason ?? '';
  return [
    csvEscape(w.personName),
    csvEscape(w.personName),
    csvEscape(w.id),
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
    csvEscape(memo),
  ].join(',');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get('filter') ?? 'all';
  const personParam = searchParams.get('person') ?? '';

  const persons = getAllPersonsWithConfig();
  const targetPersons = personParam
    ? persons.filter((p) => p.name === personParam)
    : persons;

  const allWorks: WorkRecord[] = [];
  for (const person of targetPersons) {
    const works = await getAllWorks(person.name);
    allWorks.push(...works);
  }

  const filtered = allWorks.filter((w) => {
    switch (filterParam) {
      case 'auto_published': return w.status === 'auto_published';
      case 'needs_review': return w.status === 'needs_review';
      case 'no_vod': return !w.vodProviders || w.vodProviders.length === 0;
      case 'ai_only':
        return (w.vodProviders ?? []).some(
          (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
        );
      case 'tmdb_only':
        return (w.vodProviders ?? []).some((p) => p.source === 'tmdb_watch_provider');
      default: return true;
    }
  });

  // personName → releaseYear 順でソート
  filtered.sort((a, b) => {
    if (a.personName !== b.personName) return a.personName.localeCompare(b.personName);
    return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
  });

  const headers = [
    'personId', 'personName', 'workId', 'title', 'originalTitle',
    'type', 'releaseYear', 'overview', 'tmdbId', 'tmdbUrl',
    'source', 'sourceLabel', 'status', 'currentVodServices', 'checkedDate', 'memo',
  ];

  const rows = filtered.map(workToRow);
  // BOM付きUTF-8でExcelでも文字化けしない
  const csv = '﻿' + [headers.join(','), ...rows].join('\n');

  const date = new Date().toISOString().slice(0, 10);
  const filename = personParam
    ? `works_${personParam}_${date}.csv`
    : `works_${filterParam}_${date}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
