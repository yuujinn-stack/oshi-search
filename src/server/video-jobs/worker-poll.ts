import 'server-only';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoWorkers } from '@/db/schema';
import { getRedis } from '@/lib/redis';
import {
  VIDEO_ADMIN_ACTIVE_WINDOW_SECONDS,
  hasPendingWorkerRequests,
  pronunciationReadingsVersion,
  workerRequestSignal,
  type WorkerRequestState,
} from '@/lib/video-worker-poll';

// 動画Workerの claim（ジョブ確認）に付ける処理: 最終確認時刻の更新・依頼の状態・管理画面の使用状況。
// 判定そのものは src/lib/video-worker-poll.ts。

const ADMIN_ACTIVE_KEY = 'video-admin:active';
/** 同じインスタンスからの「使用中」の書き込みはこの間隔に1回だけ（5秒ごとの自動更新で毎回書かない） */
const ADMIN_MARK_THROTTLE_MS = 60_000;
let lastAdminMarkAt = 0;

/** 管理画面（動画）が使われたことを記録する。Redis が無い・失敗しても管理画面の処理は止めない */
export async function markVideoAdminActive(): Promise<void> {
  if (Date.now() - lastAdminMarkAt < ADMIN_MARK_THROTTLE_MS) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(ADMIN_ACTIVE_KEY, Date.now(), { ex: VIDEO_ADMIN_ACTIVE_WINDOW_SECONDS });
    lastAdminMarkAt = Date.now();
  } catch (err) {
    console.warn(`[video-worker-poll] 管理画面の使用状況を記録できませんでした: ${String(err)}`);
  }
}

/** 管理画面が直近に使われたか。判定できない（Redis 未設定・失敗）ときは従来どおり使用中として扱う */
export async function isVideoAdminActive(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    return (await redis.get(ADMIN_ACTIVE_KEY)) !== null;
  } catch {
    return true;
  }
}

export interface WorkerPollRecord {
  hasActiveJobs: boolean;
  /** 依頼の状態の要約（短いハッシュ） */
  requestSignal: string;
  hasPendingRequests: boolean;
}

/**
 * Worker の最終確認時刻を更新し、確認間隔と依頼の合図に必要な状態を1回の問い合わせで読む。
 * 失敗した場合は従来どおりの動き（15秒間隔・生存報告を送る）になる値を返し、claim 自体は止めない。
 */
export async function recordWorkerPoll(workerId: string): Promise<WorkerPollRecord> {
  try {
    const result = await db.execute(sql`
      WITH touched AS (
        UPDATE video_workers SET last_seen_at = now() WHERE worker_id = ${workerId}
        RETURNING capcut_prepare_requests
      )
      SELECT
        (SELECT capcut_prepare_requests FROM touched) AS capcut_prepare_requests,
        EXISTS (SELECT 1 FROM video_generation_jobs WHERE status IN ('queued', 'processing')) AS has_active_jobs,
        (SELECT count(*) FROM video_script_requests WHERE handled_at IS NULL) AS pending_script_count,
        (SELECT max(id) FROM video_script_requests WHERE handled_at IS NULL) AS pending_script_max_id,
        (SELECT count(*) FROM pronunciation_readings) AS readings_count,
        (SELECT floor(extract(epoch FROM max(updated_at)) * 1000)::bigint FROM pronunciation_readings) AS readings_latest_ms
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const state: WorkerRequestState = {
      capcutPrepareRequests: Array.isArray(row.capcut_prepare_requests) ? row.capcut_prepare_requests as WorkerRequestState['capcutPrepareRequests'] : [],
      pendingScriptRequestCount: Number(row.pending_script_count ?? 0),
      pendingScriptRequestMaxId: row.pending_script_max_id == null ? null : Number(row.pending_script_max_id),
      readingsVersion: pronunciationReadingsVersion(row.readings_latest_ms == null ? null : Number(row.readings_latest_ms), Number(row.readings_count ?? 0)),
    };
    return {
      hasActiveJobs: row.has_active_jobs === true,
      requestSignal: createHash('sha1').update(workerRequestSignal(state)).digest('hex').slice(0, 16),
      hasPendingRequests: hasPendingWorkerRequests(state),
    };
  } catch (err) {
    console.warn(`[video-worker-poll] 状態を読めませんでした（従来どおりの間隔で続行）: ${String(err)}`);
    // 最終確認時刻だけは更新しておく（オンライン表示を保つ）
    await db.update(videoWorkers).set({ lastSeenAt: new Date() }).where(eq(videoWorkers.workerId, workerId)).catch(() => {});
    return { hasActiveJobs: true, requestSignal: `error-${Date.now()}`, hasPendingRequests: true };
  }
}
