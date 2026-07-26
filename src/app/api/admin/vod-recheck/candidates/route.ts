// GET /api/admin/vod-recheck/candidates
// VOD再確認対象の一覧をサーバー側ページングで返す（/admin/vod-recheck 用）。
// 既存の /api/admin/vod-recheck（work-check組み込みウィジェット用・N+1あり）とは別経路。
// query params: page, pageSize, search, workId, reason, priority, workType, processStatus
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PAGE_SIZE } from '@/lib/vod-recheck-store';
import { fetchRecheckListPage } from '@/lib/vod-recheck-list';
import { isValidRecheckPriority, RECHECK_STATUS_LABEL, type RecheckReasonCode, type RecheckPriority } from '@/lib/vod-recheck';
import { WORK_TYPE_LABEL, type WorkType } from '@/types/work';

export const dynamic = 'force-dynamic';

const VALID_REASONS: readonly string[] = [
  'stale_180_days', 'never_checked', 'unknown_only', 'no_active_provider', 'high_traffic',
  'deprecated_provider', 'post_merge_unchecked', 'missing_source', 'low_confidence', 'inconsistent_checked_at',
];
const VALID_WORK_TYPES: readonly string[] = Object.keys(WORK_TYPE_LABEL);
const VALID_PROCESS_STATUSES: readonly string[] = Object.keys(RECHECK_STATUS_LABEL);

function isValidReason(value: string): value is RecheckReasonCode {
  return VALID_REASONS.includes(value);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE));
  const search = searchParams.get('search') ?? undefined;
  const workId = searchParams.get('workId') ?? undefined;
  const reasonParam = searchParams.get('reason');
  const priorityParam = searchParams.get('priority');
  const workTypeParam = searchParams.get('workType');
  const processStatusParam = searchParams.get('processStatus');

  if (reasonParam && !isValidReason(reasonParam)) {
    return NextResponse.json({ error: `不正な reason です: ${reasonParam}` }, { status: 400 });
  }
  if (priorityParam && !isValidRecheckPriority(priorityParam)) {
    return NextResponse.json({ error: `不正な priority です: ${priorityParam}` }, { status: 400 });
  }
  if (workTypeParam && !VALID_WORK_TYPES.includes(workTypeParam)) {
    return NextResponse.json({ error: `不正な workType です: ${workTypeParam}` }, { status: 400 });
  }
  if (processStatusParam && !VALID_PROCESS_STATUSES.includes(processStatusParam)) {
    return NextResponse.json({ error: `不正な processStatus です: ${processStatusParam}` }, { status: 400 });
  }

  try {
    const result = await fetchRecheckListPage({
      page,
      pageSize,
      search,
      workId,
      reason: reasonParam as RecheckReasonCode | undefined,
      priority: priorityParam as RecheckPriority | undefined,
      workType: workTypeParam as WorkType | undefined,
      processStatus: processStatusParam ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/admin/vod-recheck/candidates] error:', err);
    return NextResponse.json({ error: '一覧の取得に失敗しました' }, { status: 500 });
  }
}
