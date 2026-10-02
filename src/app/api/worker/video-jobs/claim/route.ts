import { NextRequest } from 'next/server';
import { claimNextVideoJob } from '@/server/video-jobs/job-store';
import { handleWorkerRequest } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 最も古いqueuedジョブを1件取得してprocessingにする（無ければ job: null）。二重取得はDB側の単一UPDATEで防ぐ */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ workerId }) => {
    const job = await claimNextVideoJob(workerId);
    return {
      job: job && {
        id: job.id,
        personName: job.personName,
        templateId: job.templateId,
        templateVersion: job.templateVersion,
        narrationMode: job.narrationMode,
        attempts: job.attempts,
      },
    };
  });
}
