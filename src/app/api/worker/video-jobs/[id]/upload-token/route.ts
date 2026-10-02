import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { assignVideoPathname, VideoJobError } from '@/server/video-jobs/job-store';
import { handleWorkerRequest, num, parseJobId } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const TOKEN_TTL_MS = 30 * 60_000;

/**
 * final.mp4 をWorkerからVercel Blobへ直接アップロードするための一時許可（client token）を発行する。
 * 動画本体はこのAPIを通らない（Vercel関数のリクエストサイズ上限を避けるため）。
 * 許可は「このジョブ専用の1つのパス・video/mp4のみ・200MBまで・30分で失効・上書き不可」に限定し、
 * パスはサーバー側で決めてDBに記録する（完了報告時に一致を確認する）。BLOB_READ_WRITE_TOKEN自体は渡さない。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleWorkerRequest(req, async ({ workerId, body }) => {
    const jobId = parseJobId(id);
    const size = num(body.fileSizeBytes);
    if (size === null || size <= 0 || size > MAX_VIDEO_BYTES) {
      throw new VideoJobError(`動画サイズが不正です（上限${MAX_VIDEO_BYTES / 1024 / 1024}MB）。`, 400);
    }
    const pathname = `video-jobs/${jobId}/final-${randomBytes(8).toString('hex')}.mp4`;
    await assignVideoPathname(jobId, workerId, pathname);
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: ['video/mp4'],
      maximumSizeInBytes: MAX_VIDEO_BYTES,
      validUntil: Date.now() + TOKEN_TTL_MS,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { pathname, clientToken };
  });
}
