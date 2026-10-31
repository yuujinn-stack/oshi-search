import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { maskSecrets } from '@/lib/mask-secrets';
import { SONKAMO_TEMPLATE_ID } from '@/server/video-jobs/sonkamo-target';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LIMITS = {
  wav: { ext: 'wav', contentType: 'audio/wav', maxBytes: 60 * 1024 * 1024 },
  srt: { ext: 'srt', contentType: 'text/plain', maxBytes: 1024 * 1024 },
} as const;
const TOKEN_TTL_MS = 15 * 60_000;

/**
 * 「推し活で損してるかも？ V1」の音声なし動画のジョブに付ける CapCut の WAV・SRT を、管理画面から Vercel Blob へ直接
 * アップロードするための一時許可（client token）を発行する（ファイル本体はこのAPIを通らない。Vercel関数のサイズ上限を避ける）。
 * 許可は「このジョブ専用のパス video-jobs/{ジョブID}/capcut-{乱数}.wav|.srt・種類と大きさの上限・15分で失効・上書き不可」に限定する。
 * 音声付きの動画は、このURLを template_input.audio に入れて別のジョブとして作る（元の音声なし動画は変更しない）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; fileSizeBytes?: unknown };
  const limit = body.kind === 'wav' || body.kind === 'srt' ? LIMITS[body.kind] : null;
  if (!limit) return NextResponse.json({ error: 'ファイルの種類は wav か srt です' }, { status: 400 });
  const size = typeof body.fileSizeBytes === 'number' ? body.fileSizeBytes : NaN;
  if (!Number.isFinite(size) || size <= 0 || size > limit.maxBytes) {
    return NextResponse.json({ error: `ファイルの大きさが不正です（${limit.ext.toUpperCase()} は ${limit.maxBytes / 1024 / 1024}MB まで）` }, { status: 400 });
  }
  try {
    const [job] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, id));
    if (!job) return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
    if (job.templateId !== SONKAMO_TEMPLATE_ID || job.status !== 'completed' || job.narrationMode !== 'none') {
      return NextResponse.json({ error: 'CapCut 音声は「推し活で損してるかも？ V1」の完了した音声なし動画にだけ付けられます' }, { status: 409 });
    }
    const pathname = `video-jobs/${id}/capcut-${randomBytes(8).toString('hex')}.${limit.ext}`;
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: [limit.contentType],
      maximumSizeInBytes: limit.maxBytes,
      validUntil: Date.now() + TOKEN_TTL_MS,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return NextResponse.json({ pathname, clientToken, contentType: limit.contentType });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
