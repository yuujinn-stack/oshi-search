import { NextRequest } from 'next/server';
import { prepareCapcutAutoImport } from '@/server/video-jobs/capcut-auto-import';
import { handleWorkerRequest, num, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * フォロー獲得リールの CapCut 音声の自動取り込み（1/2）: Worker が受信フォルダで見つけた
 * 「{人物slug}__{templateId}__{ジョブIDの先頭8桁}.wav / .srt」から元のジョブ（完了した音声なし動画）を確かめ、
 * WAV・SRT を Vercel Blob へ直接アップロードする一時許可を返す（手動の取り込みと同じ許可・同じパス）。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ body }) =>
    prepareCapcutAutoImport(
      { jobKey: str(body.jobKey, 20) ?? '', personSlug: str(body.personSlug, 100) ?? '', templateId: str(body.templateId, 100) ?? '' },
      { wavBytes: num(body.wavBytes) ?? NaN, srtBytes: num(body.srtBytes) ?? NaN },
    ),
  );
}
