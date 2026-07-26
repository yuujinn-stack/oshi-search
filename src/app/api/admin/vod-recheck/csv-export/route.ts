// POST /api/admin/vod-recheck/csv-export
// 選択したVOD再確認対象を調査用CSVとして出力する。
// 同一workIdに複数人物が紐づく場合は、既存の作品CSV運用（csv-export/route.ts）と同様に
// 1行1人物で出力する（personName列で複数行に分かれる）。
//
// body: { items: Array<{ personName: string; workId: string }> }  最大 MAX_EXPORT_ITEMS 件
import { NextRequest, NextResponse } from 'next/server';
import { neonSql } from '@/db/client';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { deduplicateProviders, isConfirmedVodAvailability } from '@/lib/vod-dedup';
import { detectRecheckReasons, RECHECK_REASON_LABEL, RECHECK_PRIORITY_LABEL } from '@/lib/vod-recheck';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_ITEMS = 500;

function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface ExportItem {
  personName: string;
  workId: string;
}

function isExportItem(v: unknown): v is ExportItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.personName === 'string' && typeof o.workId === 'string' && o.workId.trim() !== '';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { items?: unknown };
  const { items } = body;

  if (!Array.isArray(items) || items.length === 0 || !items.every(isExportItem)) {
    return NextResponse.json({ error: 'items は { personName, workId } の配列である必要があります' }, { status: 400 });
  }
  if (items.length > MAX_EXPORT_ITEMS) {
    return NextResponse.json({ error: `一度にエクスポートできるのは最大 ${MAX_EXPORT_ITEMS} 件です` }, { status: 400 });
  }

  const workIds = [...new Set((items as ExportItem[]).map((i) => i.workId))];

  try {
    // 選択されたworkIdに紐づく全人物行を取得（1行1人物・既存CSV運用と同じ方式）
    const rows = await neonSql`
      SELECT person_name, id AS work_id, title, type, release_year, role_name, vod_data
      FROM works
      WHERE id = ANY(${workIds}) AND status = 'auto_published' AND deleted = false
      ORDER BY id, person_name
    `;

    const terminatedSlugs = await getInactiveProviderSlugs();
    const now = Date.now();

    const dataRows = rows.map((r) => {
      const vodData = (r.vod_data ?? {}) as Record<string, unknown>;
      const vodProviders = (vodData.vodProviders as VodProvider[] | undefined) ?? [];
      const lastVodCheckAt = vodData.lastVodCheckAt as number | undefined;
      const vodAiCheckedAt = vodData.vodAiCheckedAt as number | undefined;

      const detection = detectRecheckReasons({
        vodProviders,
        lastVodCheckAt,
        vodAiCheckedAt,
        terminatedSlugs,
        isHighTraffic: false,
        isPostMergeUnchecked: false,
        now,
      });

      const currentVodServices = deduplicateProviders(vodProviders)
        .filter((p) => isConfirmedVodAvailability(p, terminatedSlugs))
        .map((p) => p.providerName)
        .join(', ');

      const lastCheckedAt = detection.lastCheckedAt
        ? new Date(detection.lastCheckedAt).toISOString().slice(0, 10)
        : '';

      return [
        r.work_id as string,
        r.person_name as string,
        r.title as string,
        r.type as string,
        r.release_year != null ? String(r.release_year) : '',
        (r.role_name as string | null) ?? '',
        currentVodServices,
        lastCheckedAt,
        detection.codes.map((c) => RECHECK_REASON_LABEL[c]).join('/'),
        RECHECK_PRIORITY_LABEL[detection.priority],
      ].map(csvEscape).join(',');
    });

    const headers = [
      'workId', 'personName', 'workTitle', 'workType', 'releaseYear', 'roleName',
      'currentVodServices', 'lastCheckedAt', 'recheckReason', 'priority',
    ];
    const csv = '﻿' + [headers.join(','), ...dataRows].join('\n');

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`vod-recheck_${date}.csv`)}`,
      },
    });
  } catch (err) {
    console.error('[vod-recheck/csv-export] error:', err);
    return NextResponse.json({ error: 'CSV出力に失敗しました' }, { status: 500 });
  }
}
