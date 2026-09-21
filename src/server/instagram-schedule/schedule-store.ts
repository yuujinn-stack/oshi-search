import 'server-only';
import { db } from '@/db/client';
import { instagramPostSchedules } from '@/db/schema';
import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';

/**
 * needs_review: media_publish呼び出し自体が失敗し、Instagram側で実際には公開が
 * 完了している可能性を否定できない状態。二重投稿を避けるため自動再試行の対象には
 * 一切含めない（人が実際にInstagramを確認した上で、キャンセルするか手動で判断する）。
 */
export type ScheduleStatus = 'draft' | 'scheduled' | 'processing' | 'published' | 'failed' | 'cancelled' | 'needs_review';

/** 自動再試行の上限（この回数に達したfailedはCronの自動対象から外れ、手動再実行のみ可能になる） */
export const MAX_AUTO_RETRY_ATTEMPTS = 3;
/** 1回のCron実行で処理する予約の最大件数 */
export const CRON_BATCH_LIMIT = 5;

export interface ScheduleRecord {
  id: number;
  personId: string;
  personName: string;
  templateId: string;
  scheduledAt: Date;
  status: ScheduleStatus;
  caption: string;
  hashtags: string;
  imageUrls: string[];
  mediaId: string | null;
  publishedAt: Date | null;
  errorMessage: string | null;
  attempts: number;
  processingStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: typeof instagramPostSchedules.$inferSelect): ScheduleRecord {
  return {
    id: row.id,
    personId: row.personId,
    personName: row.personName,
    templateId: row.templateId,
    scheduledAt: row.scheduledAt,
    status: row.status as ScheduleStatus,
    caption: row.caption,
    hashtags: row.hashtags,
    imageUrls: (row.imageUrls as string[] | null) ?? [],
    mediaId: row.mediaId,
    publishedAt: row.publishedAt,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    processingStartedAt: row.processingStartedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ScheduleNotFoundError extends Error {}
export class InvalidScheduleStateError extends Error {}

export interface CreateScheduleInput {
  personId: string;
  personName: string;
  templateId: string;
  scheduledAt: Date;
  caption: string;
  hashtags: string;
  imageUrls: string[];
}

/** 予約を作成する（この時点で画像・キャプションは完成済みのものを渡す）。初期status='scheduled' */
export async function createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
  const [row] = await db.insert(instagramPostSchedules).values({
    personId: input.personId,
    personName: input.personName,
    templateId: input.templateId,
    scheduledAt: input.scheduledAt,
    status: 'scheduled',
    caption: input.caption,
    hashtags: input.hashtags,
    imageUrls: input.imageUrls,
  }).returning();
  return toRecord(row);
}

/** 予約一覧（新しい予定日時が先頭に来るよう昇順で返す。直近200件まで） */
export async function listSchedules(): Promise<ScheduleRecord[]> {
  const rows = await db.select().from(instagramPostSchedules)
    .orderBy(asc(instagramPostSchedules.scheduledAt))
    .limit(200);
  return rows.map(toRecord);
}

export async function getScheduleById(id: number): Promise<ScheduleRecord | null> {
  const [row] = await db.select().from(instagramPostSchedules).where(eq(instagramPostSchedules.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * Cronの「今すぐ処理すべき予約」を判定する条件。
 * ・scheduled_at <= now()（予定日時が到来済み）
 * ・media_id IS NULL（万が一にも既に公開済みのものは絶対に対象へ含めない。多重の安全策）
 * ・status='scheduled'（通常のケース）、または
 *   status='failed' AND attempts < MAX_AUTO_RETRY_ATTEMPTS（失敗からの自動再試行。
 *   上限に達したfailedは対象から外れ、管理画面からの手動再実行のみ可能になる）
 *
 * claimDueSchedule() のUPDATE文のWHERE句も必ずこれと同じ条件にすること
 * （ここでリストアップされたのに claim できない、という食い違いを防ぐため）。
 */
function dueCondition(now: Date) {
  return and(
    lte(instagramPostSchedules.scheduledAt, now),
    isNull(instagramPostSchedules.mediaId),
    or(
      eq(instagramPostSchedules.status, 'scheduled'),
      and(
        eq(instagramPostSchedules.status, 'failed'),
        lt(instagramPostSchedules.attempts, MAX_AUTO_RETRY_ATTEMPTS),
      ),
    ),
  );
}

/** 現在時刻以前で処理対象となる予約のIDを、予定日時の古い順に最大limit件まで返す */
export async function listDueScheduleIds(limit: number = CRON_BATCH_LIMIT): Promise<number[]> {
  const rows = await db.select({ id: instagramPostSchedules.id })
    .from(instagramPostSchedules)
    .where(dueCondition(new Date()))
    .orderBy(asc(instagramPostSchedules.scheduledAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * 指定IDの予約を「自分が処理する権利」として排他的に確保する。
 *
 * UPDATE ... WHERE (dueConditionと同じ条件) という条件付き更新1本のみで実現している
 * （SELECT FOR UPDATEやトランザクションは使わない。drizzle-orm/neon-httpは
 * db.transaction()に対応していないため）。Postgresでは単一のUPDATE文自体が
 * 対象行に対して原子的に実行されるため、複数のCron実行が同時にこの関数を呼んでも、
 * 条件に一致してUPDATEできるのは必ず1回だけになる
 * （2回目以降は対象行が見つからずreturning()が空配列になる）。
 * これが「同じ予約を2回投稿しない」ための唯一かつ最重要の防御線。
 */
export async function claimDueSchedule(id: number): Promise<ScheduleRecord | null> {
  const rows = await db.update(instagramPostSchedules)
    .set({ status: 'processing', processingStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(instagramPostSchedules.id, id), dueCondition(new Date())))
    .returning();
  return rows[0] ? toRecord(rows[0]) : null;
}

/** dry-run検証専用: claim済み（processing）の予約を、実際には投稿せずscheduledへ戻す */
export async function releaseSchedule(id: number): Promise<void> {
  await db.update(instagramPostSchedules)
    .set({ status: 'scheduled', processingStartedAt: null, updatedAt: new Date() })
    .where(and(
      eq(instagramPostSchedules.id, id),
      eq(instagramPostSchedules.status, 'processing'),
    ));
}

export async function markPublished(id: number, data: { mediaId: string; publishedAt: Date }): Promise<void> {
  await db.update(instagramPostSchedules)
    .set({ status: 'published', mediaId: data.mediaId, publishedAt: data.publishedAt, updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id));
}

export async function markFailed(id: number, data: { errorMessage: string; attempts: number }): Promise<void> {
  await db.update(instagramPostSchedules)
    .set({ status: 'failed', errorMessage: data.errorMessage, attempts: data.attempts, updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id));
}

/**
 * media_publish呼び出し自体が失敗し、Instagram側で実際に公開が完了している可能性を
 * 否定できない場合に使う。failedとは異なり、この状態は自動再試行の対象に一切含めない
 * （dueConditionのOR条件に'needs_review'を含めていないため、Cronからは永久に無視される）。
 */
export async function markNeedsReview(id: number, data: { errorMessage: string; attempts: number }): Promise<void> {
  await db.update(instagramPostSchedules)
    .set({ status: 'needs_review', errorMessage: data.errorMessage, attempts: data.attempts, updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id));
}

/** draft/scheduled/failed/needs_review からのみキャンセル可能（published/processingは不可） */
export async function cancelSchedule(id: number): Promise<ScheduleRecord> {
  const current = await getScheduleById(id);
  if (!current) throw new ScheduleNotFoundError(`予約が見つかりません（id=${id}）`);
  if (!['draft', 'scheduled', 'failed', 'needs_review'].includes(current.status)) {
    throw new InvalidScheduleStateError(`status=${current.status} の予約はキャンセルできません`);
  }
  const [row] = await db.update(instagramPostSchedules)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id))
    .returning();
  return toRecord(row);
}

/** failedの予約を再度scheduledへ戻す（画像・キャプションは再生成せず、保存済みのものをそのまま再利用） */
export async function retrySchedule(id: number): Promise<ScheduleRecord> {
  const current = await getScheduleById(id);
  if (!current) throw new ScheduleNotFoundError(`予約が見つかりません（id=${id}）`);
  if (current.status !== 'failed') {
    throw new InvalidScheduleStateError(`status=${current.status} の予約は再実行できません（failedのみ再実行可能）`);
  }
  const [row] = await db.update(instagramPostSchedules)
    .set({ status: 'scheduled', errorMessage: null, processingStartedAt: null, updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id))
    .returning();
  return toRecord(row);
}
