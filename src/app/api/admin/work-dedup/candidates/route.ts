import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { works as worksTable, workDedupReviews as reviewsTable } from '@/db/schema';
import { aggregateEntries, detectDuplicates, computeStats, ALGORITHM_VERSION, type WorkRawRow } from '@/lib/work-dedup';
import { isGroupStale, computeReviewStats, type ReviewApiData, type ReviewStatus } from '@/lib/work-dedup-review';
import { parseQueryParams, filterGroups, filterGroupsByReviewStatus, paginateGroups, trimGroupsForResponse } from './lib';

// GET /api/admin/work-dedup/candidates
// クエリパラメータ: page, limit, confidence, q, reviewStatus
// 全作品を1クエリで取得し、重複候補グループを返す。DB 更新なし。
export async function GET(req: NextRequest) {
  const start = Date.now();
  let step = 'init';
  console.log('[work-dedup/candidates] start', {
    dbUrlPresent: !!process.env.DATABASE_URL && process.env.DATABASE_URL.length > 4,
  });
  try {
    const { page, limit, confidence, q, reviewStatus } = parseQueryParams(req.nextUrl.searchParams);

    // 全作品を取得
    step = 'fetch_works';
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

    const entries   = aggregateEntries(rawRows);
    const allGroups = detectDuplicates(entries);
    const stats     = computeStats(rawRows, entries, allGroups);

    // レビュー一覧を取得（全件、max 414 行）
    step = 'fetch_reviews';
    const reviewRows = await db.select().from(reviewsTable);
    const reviewMap = new Map(
      reviewRows.map((r) => [
        r.candidateGroupKey,
        {
          reviewStatus:    r.reviewStatus as ReviewStatus,
          candidateWorkIds: r.candidateWorkIds as string[],
          algorithmVersion: r.algorithmVersion,
        },
      ]),
    );

    // グループ workId マップ（進捗集計用）
    const groupWorkIdsMap = new Map<string, string[]>(
      allGroups.map((g) => [g.groupId, g.entries.map((e) => e.workId)]),
    );

    // レビュー進捗集計
    const reviewStats = computeReviewStats(allGroups.length, reviewMap, groupWorkIdsMap);

    // フィルタリング（confidence + q）
    let filtered = filterGroups(allGroups, confidence, q);

    // レビュー状態でフィルタリング
    filtered = filterGroupsByReviewStatus(filtered, reviewMap, reviewStatus);

    const { items, pagination } = paginateGroups(filtered, page, limit);
    const trimmed = trimGroupsForResponse(items);

    // 全レビューを ReviewApiData 形式に変換（クライアント側で進捗表示・状態管理に使用）
    const reviewsRecord: Record<string, ReviewApiData> = {};
    for (const row of reviewRows) {
      const key = row.candidateGroupKey;
      const currentWorkIds = groupWorkIdsMap.get(key) ?? [];
      reviewsRecord[key] = {
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
    }

    const elapsed = Date.now() - start;
    console.log('[work-dedup/candidates]', {
      totalRows:     rawRows.length,
      uniqueWorkIds: entries.length,
      allGroups:     allGroups.length,
      filtered:      filtered.length,
      page:          pagination.page,
      limit,
      reviewStatus,
      elapsedMs:     elapsed,
    });

    return NextResponse.json({
      groups:      trimmed,
      stats,
      pagination,
      reviews:     reviewsRecord,
      reviewStats,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    const errName    = err instanceof Error ? err.name    : 'UnknownError';
    const errMessage = err instanceof Error ? err.message : String(err);
    const pgCode     = (err as Record<string, unknown>).code as string | undefined;
    const errStack   = err instanceof Error
      ? err.stack?.split('\n').slice(0, 5).join(' | ')
      : undefined;

    console.error('[work-dedup/candidates] error', {
      step,
      name:         errName,
      message:      errMessage,
      pgCode,
      elapsedMs:    elapsed,
      stack:        errStack,
      dbUrlPresent: !!process.env.DATABASE_URL && process.env.DATABASE_URL.length > 4,
    });

    // work_dedup_reviews テーブルが存在しない（マイグレーション未適用）
    if (pgCode === '42P01' || errMessage.includes('"work_dedup_reviews"')) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'REVIEWS_TABLE_MISSING',
            message:
              'Preview DBにレビュー用テーブルがありません。drizzle/0004_work_dedup_reviews.sql をPreview DBに適用してください。',
          },
        },
        { status: 500 },
      );
    }

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
