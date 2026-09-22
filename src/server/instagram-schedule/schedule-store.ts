import 'server-only';
import { db } from '@/db/client';
import { instagramPostSchedules } from '@/db/schema';
import { and, asc, desc, eq, gte, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { type ScheduleStatus, MAX_AUTO_RETRY_ATTEMPTS } from '@/lib/instagram-schedule-status';

/**
 * needs_review: media_publish呼び出し自体が失敗し、Instagram側で実際には公開が
 * 完了している可能性を否定できない状態。二重投稿を避けるため自動再試行の対象には
 * 一切含めない（人が実際にInstagramを確認した上で、キャンセルするか手動で判断する）。
 */
export type { ScheduleStatus };

// MAX_AUTO_RETRY_ATTEMPTS（自動再試行の上限）は管理画面の表示（「再試行回数: 2/3」等）にも
// 必要なため @/lib/instagram-schedule-status（client-safe）で定義し、ここではそれを再利用・
// 再exportする（値の定義箇所は1か所のまま）。
export { MAX_AUTO_RETRY_ATTEMPTS };
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

/**
 * status別の件数（管理画面上部のサマリーカード用）。listSchedules()の200件上限とは無関係に、
 * テーブル全体をDB側でGROUP BY COUNTして集計するため、件数が増えても軽量。
 */
export async function getScheduleStatusCounts(): Promise<Record<string, number>> {
  const rows = await db.select({
    status: instagramPostSchedules.status,
    count: sql<number>`count(*)::int`,
  }).from(instagramPostSchedules).groupBy(instagramPostSchedules.status);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** 直近の予定日時順にN件（Instagram管理トップの「最近の投稿結果」表示用、読み取り専用） */
export async function listRecentSchedules(limit: number = 5): Promise<ScheduleRecord[]> {
  const rows = await db.select().from(instagramPostSchedules)
    .orderBy(desc(instagramPostSchedules.scheduledAt))
    .limit(limit);
  return rows.map(toRecord);
}

export async function getScheduleById(id: number): Promise<ScheduleRecord | null> {
  const [row] = await db.select().from(instagramPostSchedules).where(eq(instagramPostSchedules.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * 直近に作成された予約（cancelled除く）のtemplateIdを返す。
 * 「自動（おすすめ）」テンプレートのローテーション（同じテンプレートが連続しにくくする）で、
 * 一括予約のように呼び出し側が直前の選択結果を渡せない場合（通常の単発予約）の
 * 基準値として使う。予約が1件もない場合はnullを返す。
 */
export async function getMostRecentTemplateId(): Promise<string | null> {
  const [row] = await db.select({ templateId: instagramPostSchedules.templateId })
    .from(instagramPostSchedules)
    .where(ne(instagramPostSchedules.status, 'cancelled'))
    .orderBy(desc(instagramPostSchedules.createdAt))
    .limit(1);
  return row?.templateId ?? null;
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

/**
 * failed または needs_review の予約を再度scheduledへ戻す
 * （画像・キャプションは再生成せず、保存済みのものをそのまま再利用する）。
 *
 * これ自体はInstagram APIを一切呼び出さない。statusをscheduledへ戻すだけで、
 * 実際の投稿は次回のCron実行時に既存のclaimDueSchedule（Atomic Claim）・
 * publishScheduleToInstagram（二重投稿防止込み）がそのまま処理する
 * ＝新しい投稿経路は一切追加していない。
 *
 * media_idが既に入っている（＝Instagram側で公開済みの可能性がある）予約は、
 * statusが不整合であっても誤って再実行できないよう明示的に拒否する
 * （claimDueSchedule側のmedia_id IS NULL条件と合わせた二重の安全策）。
 */
export async function retrySchedule(id: number): Promise<ScheduleRecord> {
  const current = await getScheduleById(id);
  if (!current) throw new ScheduleNotFoundError(`予約が見つかりません（id=${id}）`);
  if (current.status !== 'failed' && current.status !== 'needs_review') {
    throw new InvalidScheduleStateError(`status=${current.status} の予約は再実行できません（failed/needs_reviewのみ再実行可能）`);
  }
  if (current.mediaId) {
    throw new InvalidScheduleStateError(`予約id=${id}は既にmedia_id=${current.mediaId}で公開済みのため、再実行できません`);
  }
  const [row] = await db.update(instagramPostSchedules)
    .set({ status: 'scheduled', errorMessage: null, processingStartedAt: null, updatedAt: new Date() })
    .where(eq(instagramPostSchedules.id, id))
    .returning();
  return toRecord(row);
}

// ─── 一括予約（bulk）専用 ──────────────────────────────────────────────────────
// 既存のcreateSchedule / claimDueSchedule / dueCondition 等には一切手を加えていない。
// 一括予約はこれらとは独立した「複数件をまとめてINSERTする」経路として追加した。

/**
 * 指定期間内で、キャンセル以外の状態（draft/scheduled/processing/published/failed/needs_review）
 * を持つ予約の予定日時（ISO文字列）集合を返す。一括予約の空き枠計算（allocateBulkSlots）に渡す
 * occupiedIsoSetとして使う。cancelledの予約はその枠を「空き」として扱ってよいため除外する。
 */
export async function listOccupiedSlotIsos(from: Date, to: Date): Promise<Set<string>> {
  const rows = await db.select({ scheduledAt: instagramPostSchedules.scheduledAt })
    .from(instagramPostSchedules)
    .where(and(
      gte(instagramPostSchedules.scheduledAt, from),
      lte(instagramPostSchedules.scheduledAt, to),
      ne(instagramPostSchedules.status, 'cancelled'),
    ));
  return new Set(rows.map((r) => r.scheduledAt.toISOString()));
}

export class SlotConflictError extends Error {
  constructor(message: string, public readonly conflicts: string[]) {
    super(message);
  }
}

/**
 * 一括予約の確定登録。
 *
 * 安全性: (1) 渡されたリスト内で予定日時が重複していないか、(2) DB上で既に
 * その日時が（cancelled以外の状態で）埋まっていないかを直前に再確認し、
 * 1件でも問題があればDBへは一切書き込まずSlotConflictErrorを投げる。
 * 全件クリアであれば、1回の複数行INSERT文でまとめて挿入する
 * （drizzle-orm/neon-httpはdb.transaction()に非対応のため、単一SQL文自体の原子性を利用する。
 * Postgresでは複数行INSERTは1つの文として実行されるため、一部の行だけ挿入されて
 * 残りが失敗する、という中途半端な状態にはならない＝全件成功か全件失敗のいずれかになる）。
 */
export async function createSchedulesBatch(inputs: CreateScheduleInput[]): Promise<ScheduleRecord[]> {
  if (inputs.length === 0) return [];

  const isos = inputs.map((i) => i.scheduledAt.toISOString());
  const uniqueIsos = new Set(isos);
  if (uniqueIsos.size !== isos.length) {
    throw new SlotConflictError('一括予約リスト内に同一日時が重複しています', []);
  }

  const times = inputs.map((i) => i.scheduledAt.getTime());
  const occupied = await listOccupiedSlotIsos(new Date(Math.min(...times)), new Date(Math.max(...times)));
  const conflicts = isos.filter((iso) => occupied.has(iso));
  if (conflicts.length > 0) {
    throw new SlotConflictError(`既に予約済みの日時が含まれています: ${conflicts.join(', ')}`, conflicts);
  }

  const rows = await db.insert(instagramPostSchedules).values(
    inputs.map((input) => ({
      personId: input.personId,
      personName: input.personName,
      templateId: input.templateId,
      scheduledAt: input.scheduledAt,
      status: 'scheduled' as const,
      caption: input.caption,
      hashtags: input.hashtags,
      imageUrls: input.imageUrls,
    })),
  ).returning();
  return rows.map(toRecord);
}
