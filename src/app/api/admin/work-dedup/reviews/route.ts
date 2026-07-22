import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { workDedupReviews as reviewsTable } from '@/db/schema';
import { isGroupStale, type ReviewApiData, type ReviewStatus } from '@/lib/work-dedup-review';
import { aggregateEntries, detectDuplicates, ALGORITHM_VERSION, type WorkRawRow } from '@/lib/work-dedup';
import { works as worksTable } from '@/db/schema';

// GET /api/admin/work-dedup/reviews
// 全レビュー記録を返す（works・Redis を変更しない）
export async function GET(_req: NextRequest) {
  try {
    const reviewRows = await db.select().from(reviewsTable);

    // 現在の候補グループ workId マップを構築（stale 判定のため）
    const rows = await db.select({ id: worksTable.id, personName: worksTable.personName,
      title: worksTable.title, normalizedTitle: worksTable.normalizedTitle,
      type: worksTable.type, tmdbId: worksTable.tmdbId, source: worksTable.source,
      releaseYear: worksTable.releaseYear, overview: worksTable.overview,
      posterUrl: worksTable.posterUrl, status: worksTable.status, deleted: worksTable.deleted,
      vodData: worksTable.vodData, updatedAt: worksTable.updatedAt, createdAt: worksTable.createdAt,
    }).from(worksTable);

    const rawRows = rows.map((r): WorkRawRow => ({
      id: r.id, personName: r.personName, title: r.title,
      normalizedTitle: r.normalizedTitle, type: r.type, tmdbId: r.tmdbId ?? null,
      source: r.source, releaseYear: r.releaseYear ?? null, overview: r.overview ?? null,
      posterUrl: r.posterUrl ?? null, status: r.status, deleted: r.deleted,
      vodData: (r.vodData ?? {}) as Record<string, unknown>,
      updatedAt: r.updatedAt ?? new Date(), createdAt: r.createdAt ?? new Date(),
    }));

    const entries   = aggregateEntries(rawRows);
    const allGroups = detectDuplicates(entries);
    const groupWorkIdsMap = new Map<string, string[]>(
      allGroups.map((g) => [g.groupId, g.entries.map((e) => e.workId)]),
    );

    const reviews: ReviewApiData[] = reviewRows.map((row) => {
      const currentWorkIds = groupWorkIdsMap.get(row.candidateGroupKey) ?? [];
      return {
        candidateGroupKey:       row.candidateGroupKey,
        algorithmVersion:        row.algorithmVersion,
        candidateWorkIds:        row.candidateWorkIds as string[],
        detectedConfidence:      row.detectedConfidence,
        reviewStatus:            row.reviewStatus as ReviewStatus,
        selectedCanonicalWorkId: row.selectedCanonicalWorkId ?? null,
        reviewerNote:            row.reviewerNote ?? null,
        reviewedAt:              row.reviewedAt?.toISOString() ?? null,
        updatedAt:               (row.updatedAt ?? new Date()).toISOString(),
        stale:                   isGroupStale(
          row.candidateWorkIds as string[],
          row.algorithmVersion,
          currentWorkIds,
        ),
      };
    });

    return NextResponse.json({ ok: true, data: reviews });
  } catch (err) {
    console.error('[work-dedup/reviews] GET error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: { code: 'REVIEWS_FETCH_FAILED', message: 'レビュー一覧を取得できませんでした' } },
      { status: 500 },
    );
  }
}
