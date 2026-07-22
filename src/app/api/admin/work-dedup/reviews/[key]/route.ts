import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { works as worksTable, workDedupReviews as reviewsTable } from '@/db/schema';
import {
  ALGORITHM_VERSION,
  aggregateEntries,
  detectDuplicates,
  makeGroupId,
  type WorkRawRow,
} from '@/lib/work-dedup';
import {
  validateReviewUpdate,
  isGroupStale,
  type ReviewApiData,
  type ReviewStatus,
} from '@/lib/work-dedup-review';

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function safeError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** SHA-256 の完全な 64文字 lowercase hex かどうかチェック */
function isValidGroupKey(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}

// ─── GET /api/admin/work-dedup/reviews/[key] ─────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!isValidGroupKey(key)) {
    return safeError('INVALID_KEY', '不正な candidateGroupKey です', 400);
  }

  try {
    const rows = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.candidateGroupKey, key))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, data: null });
    }

    const row = rows[0];

    // stale 判定のため現在の候補グループを取得
    const works = await db.select({
      id: worksTable.id, personName: worksTable.personName, title: worksTable.title,
      normalizedTitle: worksTable.normalizedTitle, type: worksTable.type,
      tmdbId: worksTable.tmdbId, source: worksTable.source, releaseYear: worksTable.releaseYear,
      overview: worksTable.overview, posterUrl: worksTable.posterUrl, status: worksTable.status,
      deleted: worksTable.deleted, vodData: worksTable.vodData,
      updatedAt: worksTable.updatedAt, createdAt: worksTable.createdAt,
    }).from(worksTable);

    const rawRows = works.map((r): WorkRawRow => ({
      id: r.id, personName: r.personName, title: r.title,
      normalizedTitle: r.normalizedTitle, type: r.type, tmdbId: r.tmdbId ?? null,
      source: r.source, releaseYear: r.releaseYear ?? null, overview: r.overview ?? null,
      posterUrl: r.posterUrl ?? null, status: r.status, deleted: r.deleted,
      vodData: (r.vodData ?? {}) as Record<string, unknown>,
      updatedAt: r.updatedAt ?? new Date(), createdAt: r.createdAt ?? new Date(),
    }));

    const entries   = aggregateEntries(rawRows);
    const allGroups = detectDuplicates(entries);
    const currentGroup = allGroups.find((g) => g.groupId === key);
    const currentWorkIds = currentGroup?.entries.map((e) => e.workId) ?? [];

    const data: ReviewApiData = {
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

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('[work-dedup/reviews/[key]] GET error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    });
    return safeError('REVIEW_FETCH_FAILED', 'レビューを取得できませんでした', 500);
  }
}

// ─── PUT /api/admin/work-dedup/reviews/[key] ─────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!isValidGroupKey(key)) {
    return safeError('INVALID_KEY', '不正な candidateGroupKey です', 400);
  }

  // リクエストボディ解析
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return safeError('INVALID_JSON', '不正な JSON です', 400);
  }

  try {
    // 全作品を取得して現在の候補グループを再計算（サーバー側で候補を再検証）
    const workRows = await db.select({
      id: worksTable.id, personName: worksTable.personName, title: worksTable.title,
      normalizedTitle: worksTable.normalizedTitle, type: worksTable.type,
      tmdbId: worksTable.tmdbId, source: worksTable.source, releaseYear: worksTable.releaseYear,
      overview: worksTable.overview, posterUrl: worksTable.posterUrl, status: worksTable.status,
      deleted: worksTable.deleted, vodData: worksTable.vodData,
      updatedAt: worksTable.updatedAt, createdAt: worksTable.createdAt,
    }).from(worksTable);

    const rawRows = workRows.map((r): WorkRawRow => ({
      id: r.id, personName: r.personName, title: r.title,
      normalizedTitle: r.normalizedTitle, type: r.type, tmdbId: r.tmdbId ?? null,
      source: r.source, releaseYear: r.releaseYear ?? null, overview: r.overview ?? null,
      posterUrl: r.posterUrl ?? null, status: r.status, deleted: r.deleted,
      vodData: (r.vodData ?? {}) as Record<string, unknown>,
      updatedAt: r.updatedAt ?? new Date(), createdAt: r.createdAt ?? new Date(),
    }));

    const entries   = aggregateEntries(rawRows);
    const allGroups = detectDuplicates(entries);

    // candidateGroupKey が現在の候補から計算できることを確認
    const currentGroup = allGroups.find((g) => g.groupId === key);
    if (!currentGroup) {
      return safeError(
        'CANDIDATE_NOT_FOUND',
        '指定されたグループは現在の候補に存在しません。候補構成が変更された可能性があります。',
        404,
      );
    }

    const currentWorkIds  = currentGroup.entries.map((e) => e.workId);
    const recomputedKey   = makeGroupId(currentWorkIds);

    // キーが一致することを再検証（改ざん対策）
    if (recomputedKey !== key) {
      return safeError('KEY_MISMATCH', '候補グループキーが一致しません', 400);
    }

    // リクエストボディ検証
    const validation = validateReviewUpdate(body, currentWorkIds);
    if (!validation.ok) {
      return safeError(validation.error.code, validation.error.message, 400);
    }

    const { reviewStatus, selectedCanonicalWorkId, reviewerNote } = validation.input;

    // pending への戻しの場合は reviewedAt をクリア
    const isReviewed = reviewStatus !== 'pending';
    const now = new Date();

    // DB upsert（ON CONFLICT UPDATE）
    await db
      .insert(reviewsTable)
      .values({
        candidateGroupKey:       key,
        algorithmVersion:        ALGORITHM_VERSION,
        candidateWorkIds:        currentWorkIds,
        normalizedTitle:         currentGroup.entries[0]?.title ?? '',
        detectedConfidence:      currentGroup.confidence,
        reviewStatus,
        selectedCanonicalWorkId: reviewStatus === 'rejected_distinct' ? null : (selectedCanonicalWorkId ?? null),
        reviewerNote:            reviewerNote ?? null,
        reviewedBy:              null, // セッションにユーザーIDなし
        reviewedAt:              isReviewed ? now : null,
        createdAt:               now,
        updatedAt:               now,
      })
      .onConflictDoUpdate({
        target: reviewsTable.candidateGroupKey,
        set: {
          algorithmVersion:        ALGORITHM_VERSION,
          candidateWorkIds:        currentWorkIds,
          normalizedTitle:         currentGroup.entries[0]?.title ?? '',
          detectedConfidence:      currentGroup.confidence,
          reviewStatus,
          selectedCanonicalWorkId: reviewStatus === 'rejected_distinct' ? null : (selectedCanonicalWorkId ?? null),
          reviewerNote:            reviewerNote ?? null,
          reviewedAt:              isReviewed ? now : null,
          updatedAt:               now,
        },
      });

    const data: ReviewApiData = {
      candidateGroupKey:       key,
      algorithmVersion:        ALGORITHM_VERSION,
      candidateWorkIds:        currentWorkIds,
      detectedConfidence:      currentGroup.confidence,
      reviewStatus,
      selectedCanonicalWorkId: reviewStatus === 'rejected_distinct' ? null : (selectedCanonicalWorkId ?? null),
      reviewerNote:            reviewerNote ?? null,
      reviewedAt:              isReviewed ? now.toISOString() : null,
      updatedAt:               now.toISOString(),
      stale:                   false, // 直後は必ず最新
    };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('[work-dedup/reviews/[key]] PUT error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    });
    return safeError('REVIEW_SAVE_FAILED', 'レビューを保存できませんでした', 500);
  }
}
