import { NextRequest } from 'next/server';
import { claimNextVideoJob } from '@/server/video-jobs/job-store';
import { handleWorkerRequest } from '@/server/video-jobs/worker-route';
import { isVideoAdminActive, recordWorkerPoll } from '@/server/video-jobs/worker-poll';
import { decideWorkerPollSeconds } from '@/lib/video-worker-poll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 最も古いqueuedジョブを1件取得してprocessingにする（無ければ job: null）。二重取得はDB側の単一UPDATEで防ぐ。
 * あわせて Worker の最終確認時刻を更新し（生存報告の代わり）、次の確認までの秒数（pollSeconds）と
 * 依頼の状態の要約（requestSignal。変わったら Worker がすぐ生存報告を送る）を返す。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ workerId }) => {
    const [job, poll, adminActive] = await Promise.all([
      claimNextVideoJob(workerId),
      recordWorkerPoll(workerId),
      isVideoAdminActive(),
    ]);
    return {
      pollSeconds: decideWorkerPollSeconds({ claimed: !!job, hasActiveJobs: poll.hasActiveJobs, adminActive }),
      requestSignal: poll.requestSignal,
      hasPendingRequests: poll.hasPendingRequests,
      job: job && {
        id: job.id,
        personName: job.personName,
        // 推しサーチDBで確認済みの人物のslug（PERSON_REGISTRY未登録の人物はWorkerがこれを検証して使う）
        personSlug: job.personSlug,
        templateId: job.templateId,
        templateVersion: job.templateVersion,
        narrationMode: job.narrationMode,
        attempts: job.attempts,
        // テンプレート固有の入力（推しでサブスク比較: 人物3人のslug。従来のテンプレートは null）
        templateInput: job.templateInput ?? null,
      },
    };
  });
}
