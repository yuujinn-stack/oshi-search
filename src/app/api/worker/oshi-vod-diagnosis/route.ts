import { NextRequest } from 'next/server';
import { handleWorkerRequest } from '@/server/video-jobs/worker-route';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { loadOshiVodVideoDiagnosis } from '@/server/oshi-vod/video-diagnosis';
import { parseOshiVodCompareInput, TemplateInputError } from '@/lib/video-template-input';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 動画「推しでサブスク比較」用: 人物3人（推しサーチDBの人物slug）の「推しに合うサブスク診断」の結果（読み取りのみ）。
 * 診断ページ（/oshi-vod）と同じ loadOshiVodDiagnosis を使う。Worker専用（Bearer VIDEO_WORKER_SECRET）。
 * 入力: { personSlugs: [slug, slug, slug] }（3人ちょうど・重複なし・選択順）
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ body }) => {
    let input;
    try {
      input = parseOshiVodCompareInput({ personSlugs: body.personSlugs });
    } catch (err) {
      if (err instanceof TemplateInputError) throw new VideoJobError(err.message, 400);
      throw err;
    }
    return { diagnosis: await loadOshiVodVideoDiagnosis(input) };
  });
}
