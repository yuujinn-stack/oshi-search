import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { maskSecrets } from '@/lib/mask-secrets';
import { listReelSchedulesForJobs } from '@/server/instagram-schedule/schedule-store';
import { isAutopublishEnabled, isReelsAutopublishEnabled } from '@/server/instagram-post/config';
import {
  createVideoJobs,
  failStaleProcessingJobs,
  getLatestWorker,
  listVideoJobs,
  VideoJobError,
} from '@/server/video-jobs/job-store';
import { loadOshiVodVideoDiagnosis } from '@/server/oshi-vod/video-diagnosis';
import { markVideoAdminActive } from '@/server/video-jobs/worker-poll';
import { OSHI_SONKAMO_INPUT_KIND, OSHI_VOD_COMPARE_INPUT_KIND, parseOshiVodCompareInput, TemplateInputError } from '@/lib/video-template-input';

export const dynamic = 'force-dynamic';

/** 生成履歴（直近100件）＋Workerの状態（オンライン/オフライン、報告されたテンプレート一覧・対応人物） */
export async function GET() {
  try {
    // 管理画面を開いている間は Worker のジョブ確認を15秒ごとに保つ（src/lib/video-worker-poll.ts）
    await Promise.all([failStaleProcessingJobs(), markVideoAdminActive()]);
    const [jobs, worker] = await Promise.all([listVideoJobs(), getLatestWorker()]);
    // 完了した動画のInstagramリール予約（instagram_post_schedules、media_type='REEL'）の状態
    const reels = await listReelSchedulesForJobs(jobs.filter((j) => j.status === 'completed').map((j) => j.id));
    const reelSchedules = Object.fromEntries(
      Object.entries(reels).map(([jobId, s]) => [
        jobId,
        {
          id: s.id,
          status: s.status,
          scheduledAt: s.scheduledAt,
          caption: s.caption,
          mediaId: s.mediaId,
          permalink: s.permalink,
          publishedAt: s.publishedAt,
          attempts: s.attempts,
          errorMessage: maskSecrets(s.errorMessage),
        },
      ]),
    );
    return NextResponse.json({
      jobs: jobs.map((j) => ({ ...j, errorMessage: maskSecrets(j.errorMessage) })),
      worker,
      reelSchedules,
      // リールが実際に自動投稿される状態か（スイッチの有効/無効だけ。値そのものは返さない）
      reelAutopublishEnabled: isAutopublishEnabled() && isReelsAutopublishEnabled(),
    });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

interface CreateBody {
  personNames?: unknown;
  templateId?: unknown;
  narrationMode?: unknown;
  /** テンプレート固有の入力（推しでサブスク比較: { personSlugs: [3人] }）。それ以外のテンプレートでは指定しない */
  templateInput?: unknown;
}

/** ジョブ作成（人物ごとに1ジョブ）。人物は登録済み人物のみ、テンプレート・方式はWorker報告の能力で検証する */
export async function POST(req: NextRequest) {
  await markVideoAdminActive();
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const personNames = Array.isArray(body.personNames)
    ? [...new Set(body.personNames.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean))]
    : [];
  const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
  const narrationMode = typeof body.narrationMode === 'string' ? body.narrationMode : '';
  try {
    // 推しでサブスク比較（人物3人で1本）: 3人のslugを検証し、診断結果（比較対象作品が1件以上）を確認してから1ジョブだけ作る。
    // 人物1を person_name / person_slug に入れ、3人の正本は template_input に保存する（従来のテンプレートはこの分岐に入らない）
    const workerTemplate = (await getLatestWorker())?.templates.find((t) => t.templateId === templateId);
    if (workerTemplate?.templateInputKind === OSHI_VOD_COMPARE_INPUT_KIND) {
      const input = parseOshiVodCompareInput(body.templateInput);
      const diagnosis = await loadOshiVodVideoDiagnosis(input);
      const jobs = await createVideoJobs({ personNames: [diagnosis.persons[0].name], templateId, narrationMode, templateInput: input });
      return NextResponse.json({ jobs });
    }
    // 推し活で損してるかも？: 人物 または グループ1つで1ジョブ（グループ名は人物の登録には無いため、存在確認は createVideoJobs で行う）
    if (workerTemplate?.templateInputKind === OSHI_SONKAMO_INPUT_KIND) {
      if (personNames.length !== 1) return NextResponse.json({ error: '人物かグループを1つだけ選んでください。' }, { status: 400 });
      const jobs = await createVideoJobs({ personNames, templateId, narrationMode, templateInput: body.templateInput });
      return NextResponse.json({ jobs });
    }
    const registered = new Set((await getAllPersonsMerged()).map((p) => p.name));
    const unknown = personNames.filter((p) => !registered.has(p));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `登録されていない人物です: ${unknown.join(', ')}` }, { status: 400 });
    }
    const jobs = await createVideoJobs({ personNames, templateId, narrationMode, templateInput: body.templateInput });
    return NextResponse.json({ jobs });
  } catch (err) {
    if (err instanceof TemplateInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
