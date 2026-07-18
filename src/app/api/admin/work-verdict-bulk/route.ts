import { NextRequest, NextResponse } from 'next/server';
import { getAllWorks, updateWorkStatus } from '@/lib/work-store';
import { insertWorkStatusHistory } from '@/db/write';
import type { WorkStatus } from '@/types/work';

const VALID_STATUSES: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];

// POST /api/admin/work-verdict-bulk
// body: { personName, workIds: string[], status, includeManualCsv?: boolean, reason?: string }
//
// データ消失防止: source=manual_csv の作品は includeManualCsv=true の明示なしにデフォルト除外する。
// 一括 hidden 操作でCSV登録作品が誤って非表示になるのを防ぐ安全策。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workIds, status, includeManualCsv, reason } = body as {
    personName?: string;
    workIds?: string[];
    status?: string;
    includeManualCsv?: boolean;
    reason?: string;
  };

  if (!personName || !workIds?.length || !status) {
    return NextResponse.json(
      { error: 'personName, workIds, status が必要です' },
      { status: 400 },
    );
  }
  if (!VALID_STATUSES.includes(status as WorkStatus)) {
    return NextResponse.json({ error: '無効な status です' }, { status: 400 });
  }

  // 人物の全作品を取得して workIds のソース情報を解決する
  const allWorks = await getAllWorks(personName);
  const workMap = new Map(allWorks.map((w) => [w.id, w]));

  const targetIds: string[] = [];
  const skippedManualCsvIds: string[] = [];

  for (const id of workIds) {
    const work = workMap.get(id);
    if (!work) continue;
    // manual_csv は includeManualCsv=true の明示なしに除外
    if (work.source === 'manual_csv' && !includeManualCsv) {
      skippedManualCsvIds.push(id);
    } else {
      targetIds.push(id);
    }
  }

  // ステータス更新 + 履歴記録
  await Promise.all(
    targetIds.map(async (id) => {
      const work = workMap.get(id);
      if (!work || work.status === status) return;
      await updateWorkStatus(personName, id, status as WorkStatus);
      // 履歴記録（fire-and-forget）
      insertWorkStatusHistory({
        personName,
        workId:         id,
        title:          work.title,
        workSource:     work.source,
        previousStatus: work.status,
        newStatus:      status,
        changedBy:      'admin:work-verdict-bulk',
        reason,
      }).catch((err: unknown) =>
        console.warn('[work-verdict-bulk] history log failed:', String(err)),
      );
    }),
  );

  return NextResponse.json({
    ok: true,
    count:             targetIds.length,
    skippedManualCsv:  skippedManualCsvIds.length,
  });
}
