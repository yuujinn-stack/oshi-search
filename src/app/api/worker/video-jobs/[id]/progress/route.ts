import { NextRequest } from 'next/server';
import { reportVideoJobProgress } from '@/server/video-jobs/job-store';
import { handleWorkerRequest, num, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleWorkerRequest(req, async ({ workerId, body }) => {
    await reportVideoJobProgress(parseJobId(id), workerId, {
      step: num(body.step),
      total: num(body.total),
      label: str(body.label, 200),
      personSlug: str(body.personSlug, 100),
    });
    return { ok: true };
  });
}
