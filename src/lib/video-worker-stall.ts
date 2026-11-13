// 動画生成Workerが「待機中」のジョブを取得していない状態の検知（管理画面 /admin/video-maker の警告表示用）。
// DB・Redis に触れない純粋関数。
//
// Worker は生存報告を続けていても、生成ロックの取り残し等でジョブ取得を止めていることがある
// （2026-11-04: 再起動前のロックのPIDが別プロセスに再利用され、Worker が待機し続けた）。
// 生存報告だけでは「オンライン」に見えるため、待機中のジョブが一定時間取得されないことから停止を知らせる。

/** ジョブがある間の Worker の確認間隔は15秒。これだけ待っても取得されなければ停止とみなす */
export const VIDEO_QUEUED_STALL_MS = 3 * 60_000;

export interface StallJob {
  status: string;
  createdAt: string;
}

export type WorkerStall =
  | { kind: 'offline'; queuedCount: number; oldestQueuedAt: string }
  | { kind: 'not_claiming'; queuedCount: number; oldestQueuedAt: string; waitedMs: number };

/**
 * @param workerOnline Worker の生存報告が新しいか（Worker 未接続は null）
 */
export function detectWorkerStall(workerOnline: boolean | null, jobs: StallJob[], nowMs: number): WorkerStall | null {
  const queued = jobs.filter((j) => j.status === 'queued' && Number.isFinite(Date.parse(j.createdAt)));
  if (queued.length === 0) return null;
  const oldest = queued.reduce((a, b) => (Date.parse(a.createdAt) <= Date.parse(b.createdAt) ? a : b));
  if (!workerOnline) return { kind: 'offline', queuedCount: queued.length, oldestQueuedAt: oldest.createdAt };
  // 生成中のジョブがあれば、待機中のジョブはその完了を待っているだけ
  if (jobs.some((j) => j.status === 'processing')) return null;
  const waitedMs = nowMs - Date.parse(oldest.createdAt);
  if (waitedMs < VIDEO_QUEUED_STALL_MS) return null;
  return { kind: 'not_claiming', queuedCount: queued.length, oldestQueuedAt: oldest.createdAt, waitedMs };
}
