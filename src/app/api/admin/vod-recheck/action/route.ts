// POST /api/admin/vod-recheck/action
// /admin/vod-recheck からの手動操作（処理開始・再確認完了・要確認・スキップ・メモ保存）。
// このエンドポイントはステータス遷移のみを行い、VODプロバイダー自体の更新は行わない
// （プロバイダーの更新は /api/admin/vod-recheck/csv-import 側の役割）。
//
// body:
//   items: Array<{ personName: string; workId: string }>  — 対象（最大 MAX_ITEMS 件）
//   action: 'start' | 'complete' | 'needs_review' | 'skip' | 'note'
//   note?: string
import { NextRequest, NextResponse } from 'next/server';
import { getWork, updateWorkVodCheckStatus } from '@/lib/work-store';
import { insertVodRecheckLog } from '@/db/write';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { detectRecheckReasons, isValidRecheckAction, RECHECK_ACTION_TO_STATUS, shouldUpdateLastCheckedAt } from '@/lib/vod-recheck';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 50;

interface ActionItem {
  personName: string;
  workId: string;
}

function isActionItem(v: unknown): v is ActionItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.personName === 'string' && o.personName.trim() !== ''
    && typeof o.workId === 'string' && o.workId.trim() !== '';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    items?: unknown;
    action?: unknown;
    note?: unknown;
  };

  const { items, action, note } = body;

  if (!isValidRecheckAction(action)) {
    return NextResponse.json({ error: `不正な action です: ${String(action)}` }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0 || !items.every(isActionItem)) {
    return NextResponse.json({ error: 'items は { personName, workId } の配列である必要があります' }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `一度に処理できるのは最大 ${MAX_ITEMS} 件です（${items.length}件が指定されました）` }, { status: 400 });
  }
  if (note !== undefined && typeof note !== 'string') {
    return NextResponse.json({ error: 'note は文字列である必要があります' }, { status: 400 });
  }
  if (typeof note === 'string' && note.length > 2000) {
    return NextResponse.json({ error: 'note は2000文字以内にしてください' }, { status: 400 });
  }

  const terminatedSlugs = await getInactiveProviderSlugs();
  const now = Date.now();
  const newStatus = RECHECK_ACTION_TO_STATUS[action];

  const results: Array<{ personName: string; workId: string; ok: boolean; error?: string }> = [];

  for (const { personName, workId } of items as ActionItem[]) {
    try {
      const work = await getWork(personName, workId);
      if (!work) {
        results.push({ personName, workId, ok: false, error: '作品が見つかりません' });
        continue;
      }

      const before = detectRecheckReasons({
        vodProviders: work.vodProviders,
        lastVodCheckAt: work.lastVodCheckAt,
        vodAiCheckedAt: work.vodAiCheckedAt,
        terminatedSlugs,
        isHighTraffic: false,
        isPostMergeUnchecked: false,
        now,
      });

      if (action !== 'note') {
        await updateWorkVodCheckStatus(personName, workId, newStatus, {
          source: 'manual',
          lastVodCheckAt: shouldUpdateLastCheckedAt(action) ? now : undefined,
        });
      }

      // 監査ログはfire-and-forgetではなく結果を待つ（一括操作の成否をレスポンスに反映するため）。
      // ただし失敗しても本処理（ステータス更新）は既に成功しているため、ログ失敗のみ warn に留める。
      try {
        await insertVodRecheckLog({
          personName,
          workId,
          action,
          performedBy: 'admin:vod-recheck',
          note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
          updatedProviderCount: 0,
          activeCountBefore: before.activeCount,
          activeCountAfter: before.activeCount,
          unknownCountBefore: before.unknownCount,
          unknownCountAfter: before.unknownCount,
          vodCheckStatusAfter: action === 'note' ? work.vodCheckStatus : newStatus,
        });
      } catch (logErr) {
        console.warn('[vod-recheck/action] 監査ログ書き込み失敗:', String(logErr));
      }

      results.push({ personName, workId, ok: true });
    } catch (err) {
      results.push({ personName, workId, ok: false, error: String(err) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, processed: okCount, failed: results.length - okCount, results });
}
