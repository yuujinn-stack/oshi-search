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
 * SNS別の完成動画（result.snsOutputs）。CTA を差し替えた動画は Blob を実際に確認（head）し、このジョブ専用の
 * sns-{SNS} のパス・video/mp4 であるものだけ URL を保存する（確認できなければその SNS だけ FAIL）。
 * final.mp4 と同じ内容（sameAsFinal）の SNS はジョブの動画URLを使う（別にアップロードしない）。
 */
async function buildSnsOutputs(jobId: string, raw: unknown, videoUrl: string): Promise<Record<string, unknown> | null> {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const targets = (Array.isArray(o.targets) ? o.targets : []).filter((t): t is 'instagram' | 'tiktok' => t === 'instagram' || t === 'tiktok');
  if (targets.length === 0) return null;
  const results: Record<string, unknown> = {};
  const rawResults = (o.results ?? {}) as Record<string, unknown>;
  for (const t of targets) {
    const r = (rawResults[t] ?? null) as Record<string, unknown> | null;
    if (!r) {
      results[t] = { status: 'FAIL', error: 'Workerから結果が届きませんでした。', ctaMode: null, sameAsFinal: false, url: null };
      continue;
    }
    const base = {
      ctaMode: r.ctaMode === 'search' || r.ctaMode === 'template' ? r.ctaMode : null,
      sameAsFinal: r.sameAsFinal === true,
      durationSec: num(r.durationSec),
      ctaStartSec: num(r.ctaStartSec),
      ctaDurationSec: num(r.ctaDurationSec),
      ctaAudio: r.ctaAudio === 'capcut' || r.ctaAudio === 'none' || r.ctaAudio === 'template' ? r.ctaAudio : null,
      ctaAudioKey: typeof r.ctaAudioKey === 'string' && /^[0-9a-f]{8}$/.test(r.ctaAudioKey) ? r.ctaAudioKey : null,
      narration: str(r.narration, 100),
      srt: str(r.srt, 20_000),
    };
    if (r.status !== 'PASS') {
      results[t] = { ...base, status: 'FAIL', url: null, error: str(r.error, 1000) ?? '作成できませんでした。' };
      continue;
    }
    if (base.sameAsFinal) {
      results[t] = { ...base, status: 'PASS', url: videoUrl, error: null };
      continue;
    }
    const url = str(r.url, 1000);
    const blob = url ? await head(url).catch(() => null) : null;
    const expected = new RegExp(`^video-jobs/${jobId}/sns-${t}-[0-9a-f]{16}\\.mp4$`);
    if (!blob || !expected.test(blob.pathname) || blob.contentType !== 'video/mp4') {
      results[t] = { ...base, status: 'FAIL', url: null, error: 'アップロードされた動画を確認できませんでした。' };
      continue;
    }
    results[t] = { ...base, status: 'PASS', url: blob.url, sizeBytes: blob.size, error: null };
  }
  return { version: 1, targets, results, checkedAt: new Date().toISOString() };
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
    const snsOutputs = await buildSnsOutputs(jobId, body.snsOutputs, blob.url);

    await completeVideoJob(jobId, workerId, {
      videoUrl: blob.url,
      videoSizeBytes: blob.size,
      durationSec: num(body.durationSec),
      qaStatus,
      qaWarnings,
      qaReport: boundedJson<Record<string, unknown>>(body.qaReport),
      postTexts,
      narrationScript: str(body.narrationScript, 5000),
      result:
        instagramReelVideo || snsOutputs
          ? { ...(result ?? {}), ...(instagramReelVideo ? { instagramReelVideo } : {}), ...(snsOutputs ? { snsOutputs } : {}) }
          : result,
      workerExportDir: str(body.workerExportDir, 500),
      personSlug: str(body.personSlug, 100),
    });
    return { ok: true };
  });
}
