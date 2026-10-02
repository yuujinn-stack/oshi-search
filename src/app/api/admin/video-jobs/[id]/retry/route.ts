import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { retryVideoJob, VideoJobError } from '@/server/video-jobs/job-store';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }
  try {
    const job = await retryVideoJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
