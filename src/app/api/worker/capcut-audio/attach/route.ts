import { NextRequest } from 'next/server';
import { attachCapcutAutoImport } from '@/server/video-jobs/capcut-auto-import';
import { handleWorkerRequest, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * フォロー獲得リールの CapCut 音声の自動取り込み（2/2）: アップロードした WAV・SRT で音声付きの動画のジョブを作る
 * （管理画面の「音声付き動画を生成」と同じ createVideoJobs。WAV・SRT の URL がこの動画専用のパスかもそこで確かめる）。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ body }) => {
    const job = await attachCapcutAutoImport({ sourceJobId: parseJobId(str(body.sourceJobId, 40) ?? ''), wavUrl: str(body.wavUrl, 500) ?? '', srtUrl: str(body.srtUrl, 500) ?? '' });
    return { jobId: job.id };
  });
}
