// VOD自動調査ジョブのDBアクセス層（Neon Postgres）。
// vod_investigation_jobs / vod_investigation_job_items を操作する。
// workId解決は候補一覧・CSV出力・CSV取り込みと共通の resolveActiveWorkTargets() を使う
// （旧workIdのcanonical解決・非活性化作品の拒否は既存ロジックをそのまま再利用する）。
import { db, neonSql } from '@/db/client';
import { vodInvestigationJobs, vodInvestigationJobItems } from '@/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { activeWorkFragment, resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { MAX_AUTO_RETRY_COUNT, type InvestigationJobStatus, type InvestigationDecision } from '@/lib/vod-investigation';
import type { VodProvider } from '@/types/vod';

export interface InvestigationTargetWork {
  workId: string;
  personName: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  currentProviders: VodProvider[];
}

export interface PrepareTargetsResult {
  targets: InvestigationTargetWork[];
  unresolvedWorkIds: string[];
}

// CSVのworkId列から、候補一覧・CSV出力と同じ判定基準で有効な作品だけを解決する。
// 非活性化作品・存在しないworkId・work_aliases経由のcanonical解決も既存関数に委ねる。
export async function prepareInvestigationTargets(workIds: string[]): Promise<PrepareTargetsResult> {
  const { resolved, unresolved } = await resolveActiveWorkTargets(workIds);
  const canonicalIds = [...new Set([...resolved.values()].map((t) => t.canonicalWorkId))];
  if (canonicalIds.length === 0) return { targets: [], unresolvedWorkIds: unresolved };

  const rows = await neonSql`
    SELECT DISTINCT ON (id) id, person_name, title, type, release_year, vod_data
    FROM works
    WHERE id = ANY(${canonicalIds}) AND ${activeWorkFragment()}
    ORDER BY id, person_name
  `;

  const targets: InvestigationTargetWork[] = rows.map((r) => {
    const vodData = (r.vod_data ?? {}) as Record<string, unknown>;
    return {
      workId: r.id as string,
      personName: r.person_name as string,
      title: r.title as string,
      workType: r.type as string,
      releaseYear: r.release_year != null ? (r.release_year as number) : null,
      currentProviders: (vodData.vodProviders as VodProvider[] | undefined) ?? [],
    };
  });

  return { targets, unresolvedWorkIds: unresolved };
}

export async function createInvestigationJob(
  targets: InvestigationTargetWork[],
  createdBy: string,
): Promise<string> {
  const jobId = crypto.randomUUID();
  await db.insert(vodInvestigationJobs).values({ id: jobId, status: 'pending', createdBy });
  if (targets.length > 0) {
    await db.insert(vodInvestigationJobItems).values(targets.map((t) => ({
      jobId,
      workId: t.workId,
      personName: t.personName,
      title: t.title,
      workType: t.workType,
      releaseYear: t.releaseYear,
      currentProvidersSnapshot: t.currentProviders,
      status: 'pending' as const,
      decision: 'pending' as const,
    })));
  }
  return jobId;
}

// 管理画面で「進行中のジョブに戻る（再開）」ためのジョブ一覧（新しい順）
export async function listRecentInvestigationJobs(limit = 20) {
  const jobs = await db.select().from(vodInvestigationJobs).orderBy(desc(vodInvestigationJobs.createdAt)).limit(limit);
  if (jobs.length === 0) return [];
  const jobIds = jobs.map((j) => j.id);
  const items = await db.select({
    jobId: vodInvestigationJobItems.jobId,
    status: vodInvestigationJobItems.status,
  }).from(vodInvestigationJobItems).where(inArray(vodInvestigationJobItems.jobId, jobIds));

  return jobs.map((job) => ({
    job,
    itemStatuses: items.filter((i) => i.jobId === job.id).map((i) => i.status),
  }));
}

export async function getInvestigationJob(jobId: string) {
  const jobRows = await db.select().from(vodInvestigationJobs).where(eq(vodInvestigationJobs.id, jobId));
  if (jobRows.length === 0) return null;
  const items = await db.select().from(vodInvestigationJobItems)
    .where(eq(vodInvestigationJobItems.jobId, jobId))
    .orderBy(vodInvestigationJobItems.id);
  return { job: jobRows[0], items };
}

export async function setJobStatus(jobId: string, status: InvestigationJobStatus): Promise<void> {
  await db.update(vodInvestigationJobs).set({ status, updatedAt: new Date() }).where(eq(vodInvestigationJobs.id, jobId));
}

// 次に処理するpending件のアイテムを取得し、即座に'investigating'へ更新する
// （同じアイテムが二重に処理されることを避けるための簡易な楽観排他）
export async function claimNextPendingItems(jobId: string, limit: number) {
  const rows = await db.select().from(vodInvestigationJobItems)
    .where(and(eq(vodInvestigationJobItems.jobId, jobId), eq(vodInvestigationJobItems.status, 'pending')))
    .limit(limit);
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    await db.update(vodInvestigationJobItems)
      .set({ status: 'investigating', updatedAt: new Date() })
      .where(inArray(vodInvestigationJobItems.id, ids));
  }
  return rows;
}

export async function markItemInvestigated(
  itemId: number,
  candidateProviders: VodProvider[],
): Promise<void> {
  await db.update(vodInvestigationJobItems).set({
    status: 'needs_review',
    candidateProviders,
    investigatedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(vodInvestigationJobItems.id, itemId));
}

// 調査失敗時: 自動リトライ上限(MAX_AUTO_RETRY_COUNT)以内ならpendingへ戻し次バッチで再試行、
// 上限を超えたらfailedとして確定する（無限リトライ防止）
export async function markItemFailed(
  itemId: number,
  currentRetryCount: number,
  errorMessage: string,
): Promise<{ status: 'pending' | 'failed'; retryCount: number }> {
  const retryCount = currentRetryCount + 1;
  const status = retryCount > MAX_AUTO_RETRY_COUNT ? 'failed' as const : 'pending' as const;
  await db.update(vodInvestigationJobItems).set({
    status, retryCount, errorMessage, updatedAt: new Date(),
  }).where(eq(vodInvestigationJobItems.id, itemId));
  return { status, retryCount };
}

// 明示的な「失敗作品だけ再試行」操作。自動リトライ上限に関係なくpendingへ戻す
export async function retryFailedItems(jobId: string): Promise<number> {
  const result = await db.update(vodInvestigationJobItems)
    .set({ status: 'pending', retryCount: 0, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(vodInvestigationJobItems.jobId, jobId), eq(vodInvestigationJobItems.status, 'failed')))
    .returning({ id: vodInvestigationJobItems.id });
  return result.length;
}

// decision（管理者の判断）→ item.status（処理状態）のマッピング。
// 'needs_review'（要再調査）は「レビュー待ち」ではなく「もう一度AI調査させる」の意味なので、
// statusは'pending'に戻し次バッチで再度claimNextPendingItemsの対象にする。
// 自動リトライ上限(MAX_AUTO_RETRY_COUNT)は「AI呼び出し自体の失敗」に対する歯止めであり、
// 管理者が明示的に要求した再調査はカウントしない（retryCountを0に戻す）。
const DECISION_TO_STATUS: Record<InvestigationDecision, 'pending' | 'needs_review' | 'approved' | 'rejected'> = {
  pending: 'needs_review',
  needs_review: 'pending',
  approved: 'approved',
  manual: 'approved',
  rejected: 'rejected',
};

export async function setItemDecision(
  itemId: number,
  decision: InvestigationDecision,
  manualProviders: VodProvider[] | undefined,
  decidedBy: string,
): Promise<void> {
  const status = DECISION_TO_STATUS[decision];
  await db.update(vodInvestigationJobItems).set({
    decision,
    status,
    manualProviders: manualProviders ?? null,
    ...(status === 'pending' ? { retryCount: 0, errorMessage: null } : {}),
    decidedAt: new Date(),
    decidedBy,
    updatedAt: new Date(),
  }).where(eq(vodInvestigationJobItems.id, itemId));
}

// 反映対象（承認済み・手動修正済み）のアイテムを取得する
export async function getDecidedItemsForApply(jobId: string) {
  return db.select().from(vodInvestigationJobItems)
    .where(and(
      eq(vodInvestigationJobItems.jobId, jobId),
      inArray(vodInvestigationJobItems.decision, ['approved', 'manual']),
    ));
}
