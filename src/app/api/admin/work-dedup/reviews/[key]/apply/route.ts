// POST /api/admin/work-dedup/reviews/[key]/apply
// WORK_DEDUP_APPLY_ENABLED=true のときのみ有効

import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import {
  aggregateEntries,
  detectDuplicates,
  makeGroupId,
  type WorkRawRow,
} from '@/lib/work-dedup';
import { isGroupStale } from '@/lib/work-dedup-review';
import { validateApplyRequest, executeApply } from '@/lib/work-dedup-apply';

function safeError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function isValidGroupKey(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  // WORK_DEDUP_APPLY_ENABLED チェック
  if (process.env.WORK_DEDUP_APPLY_ENABLED !== 'true') {
    return safeError(
      'APPLY_DISABLED',
      '統合実行は現在無効です（WORK_DEDUP_APPLY_ENABLED=false）',
      403,
    );
  }

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

  // バリデーション
  const validation = validateApplyRequest(body);
  if (!validation.ok) {
    return safeError(validation.error.code, validation.error.message, 400);
  }

  const { expectedCanonicalWorkId, expectedCandidateWorkIds, expectedUpdatedAt } = validation.input;

  // expectedCandidateWorkIds からgroupKeyを再計算して一致確認
  const recomputedKey = makeGroupId(expectedCandidateWorkIds);
  if (recomputedKey !== key) {
    return safeError(
      'KEY_MISMATCH',
      '候補グループキーが expectedCandidateWorkIds と一致しません',
      400,
    );
  }

  try {
    // 全作品を取得して現在の候補グループを再計算
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

    const currentGroup = allGroups.find((g) => g.groupId === key);
    if (!currentGroup) {
      return safeError(
        'CANDIDATE_NOT_FOUND',
        '指定されたグループは現在の候補に存在しません',
        404,
      );
    }

    const currentWorkIds = currentGroup.entries.map((e) => e.workId);

    // stale チェック
    const stale = isGroupStale(expectedCandidateWorkIds, 'v1', currentWorkIds);
    if (stale) {
      return safeError(
        'CANDIDATE_STALE',
        '候補グループの構成が変更されました。プレビューを再取得してください',
        409,
      );
    }

    // expectedCanonicalWorkId が現在の候補内にあることを確認
    if (!currentWorkIds.includes(expectedCanonicalWorkId)) {
      return safeError(
        'CANONICAL_NOT_IN_CANDIDATES',
        'expectedCanonicalWorkId は現在の候補グループ内に存在しません',
        400,
      );
    }

    const duplicateWorkIds = currentWorkIds.filter((id) => id !== expectedCanonicalWorkId);

    // 統合実行
    const result = await executeApply({
      groupKey:          key,
      canonicalWorkId:   expectedCanonicalWorkId,
      duplicateWorkIds,
      expectedUpdatedAt,
      appliedBy:         null, // セッションにユーザーIDなし
    });

    if (!result.success) {
      return safeError(
        'APPLY_FAILED',
        '統合の実行に失敗しました（前提条件チェックに失敗したか、DBエラーが発生しました）',
        500,
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[work-dedup/reviews/[key]/apply] POST error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    });
    return safeError('APPLY_FAILED', '統合の実行に失敗しました', 500);
  }
}
