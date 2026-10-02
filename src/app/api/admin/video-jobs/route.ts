import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { maskSecrets } from '@/lib/mask-secrets';
import {
  createVideoJobs,
  failStaleProcessingJobs,
  getLatestWorker,
  listVideoJobs,
  VideoJobError,
} from '@/server/video-jobs/job-store';

export const dynamic = 'force-dynamic';

/** 生成履歴（直近100件）＋Workerの状態（オンライン/オフライン、報告されたテンプレート一覧・対応人物） */
export async function GET() {
  try {
    await failStaleProcessingJobs();
    const [jobs, worker] = await Promise.all([listVideoJobs(), getLatestWorker()]);
    return NextResponse.json({
      jobs: jobs.map((j) => ({ ...j, errorMessage: maskSecrets(j.errorMessage) })),
      worker,
    });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

interface CreateBody {
  personNames?: unknown;
  templateId?: unknown;
  narrationMode?: unknown;
}

/** ジョブ作成（人物ごとに1ジョブ）。人物は登録済み人物のみ、テンプレート・方式はWorker報告の能力で検証する */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const personNames = Array.isArray(body.personNames)
    ? [...new Set(body.personNames.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean))]
    : [];
  const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
  const narrationMode = typeof body.narrationMode === 'string' ? body.narrationMode : '';
  try {
    const registered = new Set((await getAllPersonsMerged()).map((p) => p.name));
    const unknown = personNames.filter((p) => !registered.has(p));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `登録されていない人物です: ${unknown.join(', ')}` }, { status: 400 });
    }
    const jobs = await createVideoJobs({ personNames, templateId, narrationMode });
    return NextResponse.json({ jobs });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
