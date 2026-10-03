import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs, videoWorkers } from '@/db/schema';
import { personVideoSlug } from './person-slug';

/**
 * 動画生成ジョブ（video_generation_jobs）とWorker情報（video_workers）の読み書き。
 * - 管理画面（/api/admin/video-jobs）: 作成・一覧・キャンセル・再生成
 * - Worker（/api/worker/*）: 取得(claim)・進捗・完了・失敗・生存報告
 * Workerは自分が取得したジョブ（worker_id一致・status=processing）にしか書き込めない。
 */

export type VideoJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type VideoJob = typeof videoGenerationJobs.$inferSelect;

/** Workerが報告するテンプレート情報（正本はoshi-video-makerのVIDEO_TEMPLATE_REGISTRY） */
export interface WorkerTemplateInfo {
  templateId: string;
  name: string;
  description: string;
  version: number;
  aspectRatio?: string;
  /** このWorkerが今実際に生成できるナレーション方式（registryの対応方式のうち、Worker実装済みのもの） */
  narrationModes: string[];
}

export interface WorkerInfo {
  workerId: string;
  lastSeenAt: Date;
  online: boolean;
  version: string | null;
  templates: WorkerTemplateInfo[];
  /** Workerが対応付けできる人物名（oshi-video-makerのPERSON_REGISTRY由来） */
  persons: string[];
  /** CapCut保存済み音声の状態（Worker報告。未報告ならnull） */
  capcutStore: CapcutStoreReport | null;
  /** 管理画面から依頼した、Worker未取得人物のCapCut台本準備（Workerが処理すると消える） */
  capcutPrepareRequests: CapcutPrepareRequest[];
}

/** CapCut台本の準備依頼（Workerが推しサーチの人物ページを取得し、台本を作れるようにする） */
export interface CapcutPrepareRequest {
  personName: string;
  personSlug: string;
  requestedAt: string;
}
export interface CapcutPrepareFailure {
  personName: string;
  message: string;
  at: string;
}
export const MAX_CAPCUT_PREPARE_REQUESTS = 20;

/** CapCut保存済み音声の状態（正本はoshi-video-makerのcapcutStore。ここでは報告された内容を保存・表示するだけ） */
export type CapcutStoreStatus = 'ready' | 'stale' | 'missing' | 'check_failed';
export interface CapcutStoreEntry {
  personName: string;
  personSlug: string;
  templateId: string;
  status: CapcutStoreStatus;
  message: string;
  /** 正式台本（表示・字幕と同じ表記。scriptHashの基準） */
  scriptText: string | null;
  /** CapCut音声生成用の読み台本（正式台本から作る。古いWorkerの報告には無い） */
  speechScriptText?: string | null;
  /** 読み辞書に無く、読み台本でも正式表記のまま残した人物名・作品名・配信サービス名 */
  unresolvedReadings?: Array<{ kind: 'person' | 'work' | 'service'; text: string }>;
  scriptHash: string | null;
  savedScriptHash: string | null;
  duration: number | null;
  updatedAt: string | null;
  fileBaseName: string;
}
export interface CapcutStoreReport {
  inboxDir: string;
  reportedAt: string;
  entries: CapcutStoreEntry[];
  /** 台本準備に失敗した人物（理由を管理画面に表示する） */
  prepareFailures?: CapcutPrepareFailure[];
}

export class VideoJobError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** 生存報告がこの時間以内ならオンライン扱い（Workerは30秒ごとに報告する） */
export const WORKER_ONLINE_WINDOW_MS = 90_000;
/** processingのまま進捗報告がこの時間途絶えたジョブは失敗扱いにする（Macのスリープ等） */
export const STALE_PROCESSING_MS = 15 * 60_000;
export const MAX_PERSONS_PER_REQUEST = 20;
export const MAX_QUEUED_JOBS = 50;
const NARRATION_MODES = new Set(['none', 'auto', 'capcut']);

// ── Worker情報 ────────────────────────────────────────────────────────────────

function toWorkerInfo(row: typeof videoWorkers.$inferSelect): WorkerInfo {
  return {
    workerId: row.workerId,
    lastSeenAt: row.lastSeenAt,
    online: Date.now() - row.lastSeenAt.getTime() <= WORKER_ONLINE_WINDOW_MS,
    version: row.version,
    templates: (row.templates ?? []) as WorkerTemplateInfo[],
    persons: (row.persons ?? []) as string[],
    capcutStore: (row.capcutStore ?? null) as CapcutStoreReport | null,
    capcutPrepareRequests: (Array.isArray(row.capcutPrepareRequests) ? row.capcutPrepareRequests : []) as CapcutPrepareRequest[],
  };
}

/** 最後に生存報告したWorker（Phase AはWorker 1台想定）。未接続ならnull */
export async function getLatestWorker(): Promise<WorkerInfo | null> {
  const rows = await db.select().from(videoWorkers).orderBy(desc(videoWorkers.lastSeenAt)).limit(1);
  return rows[0] ? toWorkerInfo(rows[0]) : null;
}

export async function upsertWorkerHeartbeat(input: {
  workerId: string;
  version: string | null;
  templates: WorkerTemplateInfo[];
  persons: string[];
  /** 送られてきた場合だけ更新する（省略時は前回の報告を維持） */
  capcutStore?: CapcutStoreReport;
}): Promise<CapcutPrepareRequest[]> {
  const now = new Date();
  const capcut = input.capcutStore ? { capcutStore: input.capcutStore } : {};
  const [row] = await db
    .insert(videoWorkers)
    .values({ workerId: input.workerId, lastSeenAt: now, version: input.version, templates: input.templates, persons: input.persons, updatedAt: now, ...capcut })
    .onConflictDoUpdate({
      target: videoWorkers.workerId,
      set: { lastSeenAt: now, version: input.version, templates: input.templates, persons: input.persons, updatedAt: now, ...capcut },
    })
    .returning({ capcutPrepareRequests: videoWorkers.capcutPrepareRequests });
  const requests = (Array.isArray(row?.capcutPrepareRequests) ? row.capcutPrepareRequests : []) as CapcutPrepareRequest[];
  if (!input.capcutStore || requests.length === 0) return requests;
  // 台本準備が済んだ（状態一覧に載った）人物と、依頼後に失敗が報告された人物の依頼を消す
  const prepared = new Set(input.capcutStore.entries.map((e) => e.personName));
  const failedAt = new Map((input.capcutStore.prepareFailures ?? []).map((f) => [f.personName, f.at]));
  const remaining = requests.filter((r) => !prepared.has(r.personName) && !((failedAt.get(r.personName) ?? '') >= r.requestedAt));
  if (remaining.length !== requests.length) {
    await db.update(videoWorkers).set({ capcutPrepareRequests: remaining }).where(eq(videoWorkers.workerId, input.workerId));
  }
  return remaining;
}

/**
 * CapCut台本の準備を依頼する（Workerがまだ素材を持っていない人物だけ）。人物は推しサーチの登録人物であることを
 * 呼び出し側で確認済み。slugは人物名から決まる値を付け、Worker側でも検証する。
 */
export async function requestCapcutPrepare(personNames: string[]): Promise<CapcutPrepareRequest[]> {
  const worker = await getLatestWorker();
  if (!worker) throw new VideoJobError('動画生成Workerがまだ接続していません。', 409);
  const known = new Set((worker.capcutStore?.entries ?? []).map((e) => e.personName));
  const current = worker.capcutPrepareRequests;
  const requestedAt = new Date().toISOString();
  const added = personNames
    .filter((name) => !known.has(name) && !current.some((r) => r.personName === name))
    .map((personName) => ({ personName, personSlug: personVideoSlug(personName), requestedAt }));
  // 失敗後の再依頼は、既存の依頼を新しい時刻で置き換える
  const retried = current.map((r) => (personNames.includes(r.personName) && !known.has(r.personName) ? { ...r, requestedAt } : r));
  const next = [...retried, ...added];
  if (next.length > MAX_CAPCUT_PREPARE_REQUESTS) {
    throw new VideoJobError(`台本準備の依頼は同時に${MAX_CAPCUT_PREPARE_REQUESTS}人までです。準備が終わってから追加してください。`, 429);
  }
  await db.update(videoWorkers).set({ capcutPrepareRequests: next }).where(eq(videoWorkers.workerId, worker.workerId));
  return next;
}

export function capcutStatusLabel(status: CapcutStoreStatus): string {
  switch (status) {
    case 'ready': return '使用可能';
    case 'stale': return '台本変更あり・再作成が必要';
    case 'missing': return '音声なし';
    case 'check_failed': return '取り込みチェック失敗';
  }
}

// ── 管理画面向け ──────────────────────────────────────────────────────────────

/** 進捗報告が途絶えたprocessingジョブを失敗にする（一覧取得時に実行。次のジョブはそのまま処理できる） */
export async function failStaleProcessingJobs(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_PROCESSING_MS);
  await db
    .update(videoGenerationJobs)
    .set({
      status: 'failed',
      errorStep: 'Worker応答なし',
      errorMessage: `Workerからの進捗報告が${STALE_PROCESSING_MS / 60_000}分以上ありません（Macのスリープ・Worker停止等）。`,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(videoGenerationJobs.status, 'processing'), lt(videoGenerationJobs.heartbeatAt, threshold)));
}

export async function listVideoJobs(limit = 100): Promise<VideoJob[]> {
  return db.select().from(videoGenerationJobs).orderBy(desc(videoGenerationJobs.createdAt)).limit(limit);
}

/**
 * ジョブ作成。テンプレート・ナレーション方式は「Workerが報告した能力」で検証する
 * （oshi-search側にテンプレート定義を持たない）。人物はoshi-searchの登録人物であることを呼び出し側で確認済み。
 */
export async function createVideoJobs(input: {
  personNames: string[];
  templateId: string;
  narrationMode: string;
  retryOfJobId?: string | null;
}): Promise<VideoJob[]> {
  if (input.personNames.length === 0) throw new VideoJobError('人物が選択されていません。', 400);
  if (input.personNames.length > MAX_PERSONS_PER_REQUEST) {
    throw new VideoJobError(`一度に依頼できるのは${MAX_PERSONS_PER_REQUEST}人までです。`, 400);
  }
  if (!NARRATION_MODES.has(input.narrationMode)) throw new VideoJobError('不正なナレーション方式です。', 400);

  const worker = await getLatestWorker();
  if (!worker) throw new VideoJobError('動画生成Workerがまだ接続していないため、テンプレート情報がありません。', 409);
  const template = worker.templates.find((t) => t.templateId === input.templateId);
  if (!template) throw new VideoJobError(`Workerが対応していないテンプレートです: ${input.templateId}`, 400);
  if (!template.narrationModes.includes(input.narrationMode)) {
    throw new VideoJobError(`「${template.name}」はこのナレーション方式に対応していません。`, 400);
  }
  // CapCut保存済み音声: Workerが報告した状態がreadyの人物だけ受け付ける（フロントだけに任せない）。
  // 実際に生成する直前にもWorker側で再確認する。
  if (input.narrationMode === 'capcut') {
    const notReady = input.personNames
      .map((name) => {
        const entry = worker.capcutStore?.entries.find((e) => e.personName === name && e.templateId === template.templateId);
        return entry?.status === 'ready' ? null : `${name}（${entry ? capcutStatusLabel(entry.status) : 'Worker未対応・状態不明'}）`;
      })
      .filter((x): x is string => x !== null);
    if (notReady.length > 0) {
      throw new VideoJobError(`CapCut保存済み音声がreadyではないため生成できません: ${notReady.join('、')}`, 400);
    }
  }

  const [{ queued }] = await db
    .select({ queued: sql<number>`count(*)::int` })
    .from(videoGenerationJobs)
    .where(eq(videoGenerationJobs.status, 'queued'));
  if (queued + input.personNames.length > MAX_QUEUED_JOBS) {
    throw new VideoJobError(`待機中のジョブが多すぎます（上限${MAX_QUEUED_JOBS}件）。`, 429);
  }

  const batchId = input.personNames.length > 1 ? `vb_${randomUUID()}` : null;
  const now = Date.now();
  // 選択した順に1本ずつ処理されるよう、作成時刻を1msずつずらす（Workerはcreated_atの古い順に取得する）
  const rows = input.personNames.map((personName, i) => ({
    id: randomUUID(),
    batchId,
    retryOfJobId: input.retryOfJobId ?? null,
    personName,
    // 推しサーチDBで確認済みの人物のslug（PERSON_REGISTRY登録済みの人物はWorker側でregistryのslugが優先される）
    personSlug: personVideoSlug(personName),
    templateId: template.templateId,
    templateVersion: template.version,
    narrationMode: input.narrationMode,
    status: 'queued' as const,
    createdAt: new Date(now + i),
    updatedAt: new Date(now + i),
  }));
  return db.insert(videoGenerationJobs).values(rows).returning();
}

/** queuedのジョブだけキャンセルできる（Phase Aでは実行中ジョブの中断は行わない） */
export async function cancelVideoJob(id: string): Promise<VideoJob> {
  const rows = await db
    .update(videoGenerationJobs)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(videoGenerationJobs.id, id), eq(videoGenerationJobs.status, 'queued')))
    .returning();
  if (rows[0]) return rows[0];
  const exists = await db.select({ status: videoGenerationJobs.status }).from(videoGenerationJobs).where(eq(videoGenerationJobs.id, id));
  if (!exists[0]) throw new VideoJobError('ジョブが見つかりません。', 404);
  throw new VideoJobError('待機中（queued）のジョブだけキャンセルできます。', 409);
}

/** 再生成: 元ジョブは書き換えず、同じ依頼内容の新しいジョブを作る */
export async function retryVideoJob(id: string): Promise<VideoJob> {
  const rows = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, id));
  const source = rows[0];
  if (!source) throw new VideoJobError('ジョブが見つかりません。', 404);
  if (source.status !== 'failed' && source.status !== 'cancelled' && source.status !== 'completed') {
    throw new VideoJobError('完了・失敗・キャンセル済みのジョブだけ再生成できます。', 409);
  }
  const [job] = await createVideoJobs({
    personNames: [source.personName],
    templateId: source.templateId,
    narrationMode: source.narrationMode,
    retryOfJobId: source.id,
  });
  return job;
}

// ── Worker向け ───────────────────────────────────────────────────────────────

/**
 * 最も古いqueuedジョブを1件だけ取得してprocessingにする。
 * 1本の条件付きUPDATE（サブクエリでFOR UPDATE SKIP LOCKED）で行うため、複数Workerが同時に呼んでも
 * 同じジョブを二重に取得しない（drizzle-orm/neon-httpはトランザクション非対応のため単一文で実現）。
 */
export async function claimNextVideoJob(workerId: string): Promise<VideoJob | null> {
  const now = new Date();
  const rows = await db
    .update(videoGenerationJobs)
    .set({
      status: 'processing',
      workerId,
      startedAt: now,
      heartbeatAt: now,
      updatedAt: now,
      attempts: sql`${videoGenerationJobs.attempts} + 1`,
      progressStep: null,
      progressTotal: null,
      progressLabel: '取得済み',
    })
    .where(
      and(
        eq(videoGenerationJobs.status, 'queued'),
        eq(
          videoGenerationJobs.id,
          sql`(SELECT id FROM video_generation_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)`,
        ),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** 自分が実行中のジョブだけ更新できる条件 */
function ownedProcessing(id: string, workerId: string) {
  return and(eq(videoGenerationJobs.id, id), eq(videoGenerationJobs.workerId, workerId), eq(videoGenerationJobs.status, 'processing'));
}

async function updateOwned(id: string, workerId: string, values: Partial<typeof videoGenerationJobs.$inferInsert>): Promise<VideoJob> {
  const rows = await db
    .update(videoGenerationJobs)
    .set({ ...values, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(ownedProcessing(id, workerId))
    .returning();
  if (!rows[0]) throw new VideoJobError('このWorkerが実行中のジョブではありません。', 409);
  return rows[0];
}

export async function reportVideoJobProgress(
  id: string,
  workerId: string,
  progress: { step: number | null; total: number | null; label: string | null; personSlug?: string | null },
): Promise<VideoJob> {
  return updateOwned(id, workerId, {
    progressStep: progress.step,
    progressTotal: progress.total,
    progressLabel: progress.label,
    ...(progress.personSlug ? { personSlug: progress.personSlug } : {}),
  });
}

/** アップロード許可を出す前に、このジョブ専用の保存先パスを確定させてDBに記録する */
export async function assignVideoPathname(id: string, workerId: string, pathname: string): Promise<VideoJob> {
  return updateOwned(id, workerId, { videoPathname: pathname });
}

export async function getOwnedProcessingJob(id: string, workerId: string): Promise<VideoJob | null> {
  const rows = await db.select().from(videoGenerationJobs).where(ownedProcessing(id, workerId));
  return rows[0] ?? null;
}

export async function completeVideoJob(
  id: string,
  workerId: string,
  values: Pick<
    typeof videoGenerationJobs.$inferInsert,
    | 'videoUrl'
    | 'videoSizeBytes'
    | 'durationSec'
    | 'qaStatus'
    | 'qaWarnings'
    | 'qaReport'
    | 'postTexts'
    | 'narrationScript'
    | 'result'
    | 'workerExportDir'
    | 'personSlug'
  >,
): Promise<VideoJob> {
  return updateOwned(id, workerId, {
    ...values,
    status: 'completed',
    completedAt: new Date(),
    progressLabel: '完了',
    errorStep: null,
    errorMessage: null,
  });
}

export async function failVideoJob(
  id: string,
  workerId: string,
  error: { step: string; message: string; personSlug?: string | null; workerExportDir?: string | null },
): Promise<VideoJob> {
  return updateOwned(id, workerId, {
    status: 'failed',
    completedAt: new Date(),
    errorStep: error.step,
    errorMessage: error.message,
    ...(error.personSlug ? { personSlug: error.personSlug } : {}),
    ...(error.workerExportDir ? { workerExportDir: error.workerExportDir } : {}),
  });
}

/** Workerの生存報告に合わせて、実行中ジョブのheartbeat_atも更新する（長いレンダリング中の誤判定防止） */
export async function touchVideoJobHeartbeat(id: string, workerId: string): Promise<void> {
  await db
    .update(videoGenerationJobs)
    .set({ heartbeatAt: new Date() })
    .where(ownedProcessing(id, workerId));
}
