import 'server-only';
import { db } from '@/db/client';
import { instagramAdminNotifications } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { getScheduleById, type ScheduleRecord } from './schedule-store';

/**
 * Instagram予約がfailed/needs_reviewになったことを知らせる「管理画面内通知」の読み書き。
 * instagram_post_schedules（予約本体）とは完全に独立したテーブルのみを扱う。
 * この中のどの関数も instagram_post_schedules の行を変更しない
 * （既読状態と投稿statusを完全に分離するため）。
 */

export type NotificationTargetStatus = 'failed' | 'needs_review';

/**
 * failed/needs_reviewへ確定した直後に呼ぶ。同じ予約・同じstatus・同じattemptsの組み合わせでは
 * 1件しか作られない（event_keyのUNIQUE制約 + onConflictDoNothingで原子的に重複を防ぐ）。
 * 呼び出し側（Cron）はこの関数の失敗を握りつぶして構わない設計
 * （投稿結果の保存を妨げないことを最優先するため、この関数自体は例外を投げうる）。
 */
export async function createAdminNotificationIfNeeded(input: {
  scheduleId: number;
  status: NotificationTargetStatus;
  attempts: number;
}): Promise<void> {
  const eventKey = `${input.scheduleId}:${input.status}:${input.attempts}`;
  await db.insert(instagramAdminNotifications)
    .values({ scheduleId: input.scheduleId, eventKey, status: input.status })
    .onConflictDoNothing({ target: instagramAdminNotifications.eventKey });
}

export interface AdminNotificationWithSchedule {
  id: number;
  scheduleId: number;
  status: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
  schedule: ScheduleRecord;
}

/**
 * 未読の通知を新しい順にN件、対応する予約（人物名・予定日時・status等）と合わせて返す。
 * 予約側は既存のgetScheduleById()をそのまま再利用する（新しい読み取りロジックを重複実装しない）。
 * 対応する予約が見つからない場合（想定外だが防御的に）はその通知をスキップする。
 */
export async function listUnreadAdminNotifications(limit: number = 5): Promise<AdminNotificationWithSchedule[]> {
  const rows = await db.select().from(instagramAdminNotifications)
    .where(eq(instagramAdminNotifications.isRead, false))
    .orderBy(desc(instagramAdminNotifications.createdAt))
    .limit(limit);

  const results: AdminNotificationWithSchedule[] = [];
  for (const row of rows) {
    const schedule = await getScheduleById(row.scheduleId);
    if (!schedule) continue;
    results.push({
      id: row.id,
      scheduleId: row.scheduleId,
      status: row.status,
      isRead: row.isRead,
      createdAt: row.createdAt,
      readAt: row.readAt,
      schedule,
    });
  }
  return results;
}

/** 未読件数のみ（DB側でCOUNT、件数バッジ表示用） */
export async function getUnreadAdminNotificationCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(instagramAdminNotifications)
    .where(eq(instagramAdminNotifications.isRead, false));
  return row?.count ?? 0;
}

export class NotificationNotFoundError extends Error {}

/**
 * 通知を既読にする。instagram_post_schedules側のstatus等は一切変更しない
 * （このテーブルのis_read/read_atだけを更新する）。
 */
export async function markAdminNotificationRead(id: number): Promise<void> {
  const [row] = await db.update(instagramAdminNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(instagramAdminNotifications.id, id))
    .returning();
  if (!row) throw new NotificationNotFoundError(`通知が見つかりません（id=${id}）`);
}
