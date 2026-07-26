// VOD自動調査ジョブのバッチ処理エンジン。
// 1回の呼び出しで INVESTIGATION_BATCH_SIZE 件だけをDBから claim し、
// INVESTIGATION_CONCURRENCY の同時実行数で既存の supplementVodWithAIOrThrow を呼び出す。
// サーバーレス関数の実行時間制限内に収まる小さなバッチを、管理画面からのポーリングで
// 繰り返し呼び出すことで「進行状況表示・停止・再開」を実現する（新規ワーカー基盤は導入しない）。
import { supplementVodWithAIOrThrow } from '@/lib/vod-supplement';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { buildInvestigationCandidates, INVESTIGATION_BATCH_SIZE, INVESTIGATION_CONCURRENCY } from '@/lib/vod-investigation';
import { claimNextPendingItems, markItemInvestigated, markItemFailed } from '@/lib/vod-investigation-store';
import type { WorkRecord, WorkType } from '@/types/work';

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export interface InvestigationBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  requeuedForRetry: number;
}

// ジョブのアイテムを最小限のWorkRecordに変換する（supplementVodWithAIOrThrowが参照するのは
// title/type/releaseYear/originalTitle/overview/tmdbIdのみ。他は調査に使わないためプレースホルダ）
function toPseudoWorkRecord(item: { workId: string; personName: string; title: string; workType: string; releaseYear: number | null }): WorkRecord {
  const now = Date.now();
  return {
    id: item.workId,
    personName: item.personName,
    title: item.title,
    normalizedTitle: item.title,
    type: item.workType as WorkType,
    releaseYear: item.releaseYear ?? undefined,
    source: 'manual',
    confidenceScore: 0,
    status: 'needs_review',
    createdAt: now,
    updatedAt: now,
  };
}

export async function processInvestigationBatch(jobId: string): Promise<InvestigationBatchResult> {
  const items = await claimNextPendingItems(jobId, INVESTIGATION_BATCH_SIZE);
  if (items.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, requeuedForRetry: 0 };
  }

  const terminatedSlugs = await getInactiveProviderSlugs();
  let succeeded = 0;
  let failed = 0;
  let requeuedForRetry = 0;

  await runWithConcurrency(items, INVESTIGATION_CONCURRENCY, async (item) => {
    try {
      const aiProviders = await supplementVodWithAIOrThrow(toPseudoWorkRecord(item));
      const candidates = buildInvestigationCandidates(aiProviders, terminatedSlugs);
      await markItemInvestigated(item.id, candidates);
      succeeded++;
    } catch (err) {
      const result = await markItemFailed(item.id, item.retryCount, String(err));
      failed++;
      if (result.status === 'pending') requeuedForRetry++;
    }
  });

  return { processed: items.length, succeeded, failed, requeuedForRetry };
}
