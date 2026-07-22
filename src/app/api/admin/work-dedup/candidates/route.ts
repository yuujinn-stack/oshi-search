import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import { aggregateEntries, detectDuplicates, computeStats, type WorkRawRow } from '@/lib/work-dedup';
import { parseQueryParams, filterGroups, paginateGroups, trimGroupsForResponse } from './lib';

// GET /api/admin/work-dedup/candidates
// クエリパラメータ: page, limit, confidence, q
// 全作品を1クエリで取得し、重複候補グループを返す。DB 更新なし。
export async function GET(req: NextRequest) {
  const start = Date.now();
  try {
    const { page, limit, confidence, q } = parseQueryParams(req.nextUrl.searchParams);

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

    const entries  = aggregateEntries(rawRows);
    const allGroups = detectDuplicates(entries);
    const stats    = computeStats(rawRows, entries, allGroups);

    const filtered = filterGroups(allGroups, confidence, q);
    const { items, pagination } = paginateGroups(filtered, page, limit);
    const trimmed = trimGroupsForResponse(items);

    const elapsed = Date.now() - start;
    console.log('[work-dedup/candidates]', {
      totalRows: rawRows.length,
      uniqueWorkIds: entries.length,
      allGroups: allGroups.length,
      filtered: filtered.length,
      page: pagination.page,
      limit,
      elapsedMs: elapsed,
    });

    return NextResponse.json({
      groups: trimmed,
      stats,
      pagination,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    // スタックトレース・接続情報はログのみ（レスポンスには含めない）
    console.error('[work-dedup/candidates] error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: elapsed,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'WORK_DEDUP_FETCH_FAILED',
          message: '重複候補を取得できませんでした',
        },
      },
      { status: 500 },
    );
  }
}
