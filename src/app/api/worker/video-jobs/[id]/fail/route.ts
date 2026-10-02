import { NextRequest } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { failVideoJob } from '@/server/video-jobs/job-store';
import { handleWorkerRequest, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 失敗報告。このジョブだけfailedにする（次のqueuedジョブは引き続き取得できる） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleWorkerRequest(req, async ({ workerId, body }) => {
    await failVideoJob(parseJobId(id), workerId, {
      step: str(body.errorStep, 200) ?? '(不明)',
      message: maskSecrets(str(body.errorMessage, 2000)) ?? '詳細不明',
      personSlug: str(body.personSlug, 100),
      workerExportDir: str(body.workerExportDir, 500),
    });
    return { ok: true };
  });
}
