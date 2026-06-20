import { NextRequest, NextResponse } from 'next/server';
import {
  getAllJobs,
  getQueueLength,
  requeueJob,
  updateJob,
} from '@/lib/person-job-queue';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [jobs, queueLength] = await Promise.all([getAllJobs(200), getQueueLength()]);
    return NextResponse.json({ jobs, queueLength });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; jobId?: string };
    const { action, jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId が必要です' }, { status: 400 });
    }

    if (action === 'requeue') {
      await requeueJob(jobId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'cancel') {
      await updateJob(jobId, { status: 'cancelled' });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '不明なアクション' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
