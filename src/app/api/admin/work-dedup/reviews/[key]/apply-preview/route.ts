// POST /api/admin/work-dedup/reviews/[key]/apply-preview
// 読み取り専用。WORK_DEDUP_APPLY_ENABLED の設定に関わらず常に利用可能。

import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import {
  aggregateEntries,
  detectDuplicates,
  type WorkRawRow,
} from '@/lib/work-dedup';
import { buildApplyPreview } from '@/lib/work-dedup-apply';

function safeError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function isValidGroupKey(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!isValidGroupKey(key)) {
    return safeError('INVALID_KEY', '不正な candidateGroupKey です', 400);
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

    // groupId === key のグループを探す
    const currentGroup = allGroups.find((g) => g.groupId === key);
    if (!currentGroup) {
      return safeError(
        'CANDIDATE_NOT_FOUND',
        '指定されたグループは現在の候補に存在しません',
        404,
      );
    }

    const currentWorkIds = currentGroup.entries.map((e) => e.workId);

    // buildApplyPreview を呼ぶ
    const result = await buildApplyPreview(key, currentWorkIds);

    if (!result.ok) {
      return safeError(result.error.code, result.error.message, 400);
    }

    return NextResponse.json({ ok: true, preview: result.preview });
  } catch (err) {
    console.error('[work-dedup/reviews/[key]/apply-preview] POST error', {
      name:    err instanceof Error ? err.name    : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    });
    return safeError('APPLY_PREVIEW_FAILED', 'プレビューの取得に失敗しました', 500);
  }
}
