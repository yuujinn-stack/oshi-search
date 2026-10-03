import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { createReelScheduleFromVideoJob, ReelScheduleValidationError } from '@/server/instagram-schedule/reel-schedule';
import { DuplicateReelScheduleError, SlotConflictError } from '@/server/instagram-schedule/schedule-store';

export const dynamic = 'force-dynamic';

/**
 * 完成した動画（動画生成ジョブ）をInstagramリールとして予約する（Phase R2。DBへの予約保存のみで、Instagram APIは呼ばない）。
 * 受け取るのはキャプションと予定日時だけ。動画URL（ig-reel.mp4）・人物・仕様チェック結果はジョブIDからサーバー側で取得し、
 * 検証は createReelScheduleFromVideoJob（R1b）に任せる（ここに同じ検証を持たない）。
 * 実際の公開は既存のCronが行うが、INSTAGRAM_REELS_AUTOPUBLISH_ENABLED が有効になるまでは投稿されない。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { caption?: unknown; scheduledAt?: unknown };
  if (typeof body.caption !== 'string') return NextResponse.json({ error: '投稿文がありません' }, { status: 400 });
  if (typeof body.scheduledAt !== 'string') return NextResponse.json({ error: '予約日時が指定されていません' }, { status: 400 });
  try {
    const schedule = await createReelScheduleFromVideoJob({
      videoGenerationJobId: id,
      scheduledAt: new Date(body.scheduledAt),
      caption: body.caption,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof ReelScheduleValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SlotConflictError) return NextResponse.json({ error: 'この日時には既に予約があります。別の時間を選んでください。' }, { status: 409 });
    if (err instanceof DuplicateReelScheduleError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
