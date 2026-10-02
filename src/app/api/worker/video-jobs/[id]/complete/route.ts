import { NextRequest } from 'next/server';
import { head } from '@vercel/blob';
import { completeVideoJob, getOwnedProcessingJob, VideoJobError } from '@/server/video-jobs/job-store';
import { handleWorkerRequest, num, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_JSON_CHARS = 200_000;

function boundedJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value).length <= MAX_JSON_CHARS ? (value as T) : null;
}

/**
 * 完了報告。Workerが申告したURLをそのまま信用せず、BlobのURLを実際に確認（head）し、
 * アップロード許可の発行時にDBへ記録したパスと一致することを確かめてからcompletedにする。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleWorkerRequest(req, async ({ workerId, body }) => {
    const jobId = parseJobId(id);
    const job = await getOwnedProcessingJob(jobId, workerId);
    if (!job) throw new VideoJobError('このWorkerが実行中のジョブではありません。', 409);
    if (!job.videoPathname) throw new VideoJobError('動画のアップロード許可が発行されていません。', 409);
    const videoUrl = str(body.videoUrl, 1000);
    if (!videoUrl) throw new VideoJobError('動画URLがありません。', 400);
    const blob = await head(videoUrl).catch(() => null);
    if (!blob || blob.pathname !== job.videoPathname) {
      throw new VideoJobError('アップロードされた動画を確認できませんでした。', 400);
    }

    const postTextsRaw = (body.postTexts ?? {}) as Record<string, unknown>;
    const postTexts: Record<string, string | null> = {};
    for (const key of ['default', 'instagram', 'tiktok', 'threads', 'x']) {
      postTexts[key] = str(postTextsRaw[key], 5000);
    }
    const qaStatus = body.qaStatus === 'PASS' || body.qaStatus === 'FAIL' ? body.qaStatus : null;
    const qaWarnings = (Array.isArray(body.qaWarnings) ? body.qaWarnings : [])
      .filter((w): w is string => typeof w === 'string')
      .slice(0, 50)
      .map((w) => w.slice(0, 500));

    await completeVideoJob(jobId, workerId, {
      videoUrl: blob.url,
      videoSizeBytes: blob.size,
      durationSec: num(body.durationSec),
      qaStatus,
      qaWarnings,
      qaReport: boundedJson<Record<string, unknown>>(body.qaReport),
      postTexts,
      narrationScript: str(body.narrationScript, 5000),
      result: boundedJson<Record<string, unknown>>(body.result),
      workerExportDir: str(body.workerExportDir, 500),
      personSlug: str(body.personSlug, 100),
    });
    return { ok: true };
  });
}
