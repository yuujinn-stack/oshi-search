import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import { aggregateEntries, detectDuplicates, computeStats } from '@/lib/work-dedup';
import type { WorkRawRow } from '@/lib/work-dedup';

// GET /api/admin/work-dedup/candidates
// 全作品を1クエリで取得し、重複候補グループを返す。DB 更新なし。
export async function GET() {
  try {
    const rows = await db.select({
      id:              worksTable.id,
      personName:      worksTable.personName,
      title:           worksTable.title,
      normalizedTitle: worksTable.normalizedTitle,
      type:            worksTable.type,
      tmdbId:          worksTable.tmdbId,
      source:          worksTable.source,
      releaseYear:     worksTable.releaseYear,
      overview:        worksTable.overview,
      posterUrl:       worksTable.posterUrl,
      status:          worksTable.status,
      deleted:         worksTable.deleted,
      vodData:         worksTable.vodData,
      updatedAt:       worksTable.updatedAt,
      createdAt:       worksTable.createdAt,
    }).from(worksTable);

    const rawRows = rows.map((r): WorkRawRow => ({
      id:              r.id,
      personName:      r.personName,
      title:           r.title,
      normalizedTitle: r.normalizedTitle,
      type:            r.type,
      tmdbId:          r.tmdbId ?? null,
      source:          r.source,
      releaseYear:     r.releaseYear ?? null,
      overview:        r.overview ?? null,
      posterUrl:       r.posterUrl ?? null,
      status:          r.status,
      deleted:         r.deleted,
      vodData:         (r.vodData ?? {}) as Record<string, unknown>,
      updatedAt:       r.updatedAt ?? new Date(),
      createdAt:       r.createdAt ?? new Date(),
    }));

    const entries = aggregateEntries(rawRows);
    const groups  = detectDuplicates(entries);
    const stats   = computeStats(rawRows, entries, groups);

    console.log('[work-dedup/candidates]', {
      totalRows: rawRows.length,
      uniqueWorkIds: entries.length,
      groups: groups.length,
    });

    return NextResponse.json({ groups, stats });
  } catch (err) {
    console.error('[work-dedup/candidates] error:', String(err));
    return NextResponse.json(
      { error: '重複候補の取得に失敗しました', detail: String(err) },
      { status: 500 },
    );
  }
}
