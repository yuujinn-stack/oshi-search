import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { maskSecrets } from '@/lib/mask-secrets';
import { SONKAMO_TEMPLATE_ID } from '@/server/video-jobs/sonkamo-target';
import { isFollowTemplateId } from '@/lib/video-follow-reel';
import { issueCapcutUploadToken } from '@/server/video-jobs/capcut-auto-import';
import { VideoJobError } from '@/server/video-jobs/job-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 「推し活で損してるかも？ V1」・フォロー獲得リール（10種類）の音声なし動画のジョブに付ける CapCut の WAV・SRT を、管理画面から Vercel Blob へ直接
 * アップロードするための一時許可（client token）を発行する（ファイル本体はこのAPIを通らない。Vercel関数のサイズ上限を避ける）。
 * 許可は「このジョブ専用のパス video-jobs/{ジョブID}/capcut-{乱数}.wav|.srt・種類と大きさの上限・15分で失効・上書き不可」に限定する。
 * 音声付きの動画は、このURLを template_input.audio に入れて別のジョブとして作る（元の音声なし動画は変更しない）。
 * フォロー獲得リールは Worker の受信フォルダからの自動取り込みもある（src/server/video-jobs/capcut-auto-import.ts。この手動の取り込みは予備として残す）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; fileSizeBytes?: unknown };
  const kind = body.kind === 'wav' || body.kind === 'srt' ? body.kind : null;
  if (!kind) return NextResponse.json({ error: 'ファイルの種類は wav か srt です' }, { status: 400 });
  const size = typeof body.fileSizeBytes === 'number' ? body.fileSizeBytes : NaN;
  try {
    const [job] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, id));
    if (!job) return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
    if ((job.templateId !== SONKAMO_TEMPLATE_ID && !isFollowTemplateId(job.templateId)) || job.status !== 'completed' || job.narrationMode !== 'none') {
      return NextResponse.json({ error: 'CapCut 音声は「推し活で損してるかも？ V1」・フォロー獲得リールの完了した音声なし動画にだけ付けられます' }, { status: 409 });
    }
    // 許可の中身（パス・種類・大きさ・期限）は自動取り込み（Worker）と共通
    return NextResponse.json(await issueCapcutUploadToken(id, kind, size));
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
