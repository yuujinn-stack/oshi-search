import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { validateCaption } from '@/lib/instagram-caption-rules';
import { createReelSchedule, listOccupiedSlotIsos, SlotConflictError, type ScheduleRecord } from './schedule-store';

/**
 * 動画生成ジョブ（video_generation_jobs）から、Instagram Reel予約（instagram_post_schedules、media_type='REEL'）を作る（Phase R1b）。
 * R2の管理画面（/admin/video-maker）から呼ぶ想定。ここではDBへの保存だけを行い、Instagram APIは呼ばない。
 *
 * ・動画は R1a の result.instagramReelVideo（ig-reel.mp4）だけを使う。qaStatus=PASS かつ このジョブ専用の
 *   ig-reel のBlob URLがある場合のみ予約できる（final.mp4はReel APIへ渡さない）。
 * ・キャプションは新しく生成しない。Workerが作った post_texts.instagram を正本とし、予約時に編集した文面を渡した場合はそれを保存する。
 * ・予約日時は既存の予約と同じく「未来・JSTの毎時0分」。同じ時間枠にキャンセル以外の予約があれば拒否する（既存の空き枠判定を再利用）。
 * ・同じ動画生成ジョブのReel予約はキャンセル以外で1件まで（schedule-store.createReelSchedule＋DBの部分ユニークインデックス）。
 */

export class ReelScheduleValidationError extends Error {}

const IG_REEL_URL_PATTERN = (jobId: string) =>
  new RegExp(`^https://[a-z0-9]+\\.public\\.blob\\.vercel-storage\\.com/video-jobs/${jobId}/ig-reel-[0-9a-f]{16}\\.mp4$`);

interface InstagramReelVideoResult {
  url?: unknown;
  qaStatus?: unknown;
}

export async function createReelScheduleFromVideoJob(input: {
  videoGenerationJobId: string;
  scheduledAt: Date;
  /** 予約画面で編集したキャプション（省略時は post_texts.instagram） */
  caption?: string | null;
  now?: Date;
}): Promise<ScheduleRecord> {
  const now = input.now ?? new Date();
  if (!/^[0-9a-f-]{36}$/.test(input.videoGenerationJobId)) throw new ReelScheduleValidationError('動画生成ジョブIDの形式が不正です');
  const [job] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, input.videoGenerationJobId)).limit(1);
  if (!job) throw new ReelScheduleValidationError('動画生成ジョブが見つかりません');
  if (job.status !== 'completed') throw new ReelScheduleValidationError(`完了した動画だけ予約できます（現在: ${job.status}）`);

  const reel = ((job.result ?? {}) as { instagramReelVideo?: InstagramReelVideoResult }).instagramReelVideo;
  if (!reel || reel.qaStatus !== 'PASS') {
    throw new ReelScheduleValidationError('Instagram用動画（ig-reel.mp4）の仕様チェックに合格していないため予約できません');
  }
  const videoUrl = typeof reel.url === 'string' ? reel.url : '';
  if (!IG_REEL_URL_PATTERN(job.id).test(videoUrl) || videoUrl === job.videoUrl) {
    throw new ReelScheduleValidationError('Instagram用動画（ig-reel.mp4）のURLがありません');
  }

  const caption = (input.caption ?? job.postTexts?.instagram ?? '').trim();
  const captionError = validateCaption(caption);
  if (captionError) throw new ReelScheduleValidationError(captionError);

  const scheduledAt = input.scheduledAt;
  if (Number.isNaN(scheduledAt.getTime())) throw new ReelScheduleValidationError('予約日時の形式が不正です');
  if (scheduledAt.getTime() <= now.getTime()) throw new ReelScheduleValidationError('過去の日時は予約できません');
  // 既存の予約と同じく、JSTの毎時0分だけ（自動投稿のCronが毎時0分に動くため）
  if (scheduledAt.getUTCMinutes() !== 0 || scheduledAt.getUTCSeconds() !== 0 || scheduledAt.getUTCMilliseconds() !== 0) {
    throw new ReelScheduleValidationError('予約日時は毎時0分（00:00〜23:00の1時間単位）で指定してください');
  }
  const occupied = await listOccupiedSlotIsos(scheduledAt, scheduledAt);
  if (occupied.has(scheduledAt.toISOString())) {
    throw new SlotConflictError(`この日時には既に予約があります: ${scheduledAt.toISOString()}`, [scheduledAt.toISOString()]);
  }

  return createReelSchedule({
    personName: job.personName,
    scheduledAt,
    caption,
    videoUrl,
    videoGenerationJobId: job.id,
    templateId: `reel:${job.templateId}`,
  });
}
