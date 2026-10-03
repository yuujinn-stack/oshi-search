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

/** ig-reel.mp4の仕様（Workerの検査結果の要約）として保存する項目 */
const IG_REEL_SPEC_KEYS = [
  'videoCodec', 'width', 'height', 'fps', 'pixelFormat', 'videoBitrate',
  'audioCodec', 'audioSampleRate', 'audioChannels', 'audioBitrate', 'durationSec', 'sizeBytes',
] as const;

/**
 * Instagram Reels向け互換動画（ig-reel.mp4、Phase R1a）の結果を作る。URLはWorkerの申告をそのまま信用せず、
 * Blobを実際に確認（head）し、このジョブ専用のig-reelパス・video/mp4であることを確かめたものだけ保存する。
 * 確認できない・Worker側の検査がFAILの場合はURLを持たないFAILとして記録する（final.mp4の完了は妨げない）。
 */
async function buildInstagramReelVideo(jobId: string, raw: unknown): Promise<Record<string, unknown> | null> {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const checkedAt = new Date().toISOString();
  const failedChecks = (Array.isArray(r.failedChecks) ? r.failedChecks : [])
    .filter((c): c is string => typeof c === 'string')
    .slice(0, 30)
    .map((c) => c.slice(0, 300));
  const fail = (error: string) => ({ qaStatus: 'FAIL', error: error.slice(0, 500), failedChecks, checkedAt });
  if (r.qaStatus !== 'PASS') return fail(str(r.error, 500) ?? 'Instagram仕様の検査に合格しませんでした。');
  const url = str(r.url, 1000);
  if (!url) return fail('Instagram用動画のURLがありません。');
  const blob = await head(url).catch(() => null);
  const expected = new RegExp(`^video-jobs/${jobId}/ig-reel-[0-9a-f]{16}\\.mp4$`);
  if (!blob || !expected.test(blob.pathname) || blob.contentType !== 'video/mp4') {
    return fail('アップロードされたInstagram用動画を確認できませんでした。');
  }
  const specRaw = (r.spec ?? {}) as Record<string, unknown>;
  const spec: Record<string, string | number | null> = {};
  for (const key of IG_REEL_SPEC_KEYS) {
    const v = specRaw[key];
    spec[key] = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v.slice(0, 50) : null;
  }
  return {
    url: blob.url,
    pathname: blob.pathname,
    sizeBytes: blob.size,
    durationSec: num(r.durationSec),
    qaStatus: 'PASS',
    spec,
    checkedAt,
  };
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

    // Instagram Reels向け互換動画（あれば既存のresult JSONへ追加する。DBの列は増やさない）
    const result = boundedJson<Record<string, unknown>>(body.result);
    const instagramReelVideo = await buildInstagramReelVideo(jobId, body.instagramReelVideo);

    await completeVideoJob(jobId, workerId, {
      videoUrl: blob.url,
      videoSizeBytes: blob.size,
      durationSec: num(body.durationSec),
      qaStatus,
      qaWarnings,
      qaReport: boundedJson<Record<string, unknown>>(body.qaReport),
      postTexts,
      narrationScript: str(body.narrationScript, 5000),
      result: instagramReelVideo ? { ...(result ?? {}), instagramReelVideo } : result,
      workerExportDir: str(body.workerExportDir, 500),
      personSlug: str(body.personSlug, 100),
    });
    return { ok: true };
  });
}
