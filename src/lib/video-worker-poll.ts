// 動画Worker（oshi-video-maker）のジョブ確認（claim）の間隔と、生存報告（heartbeat）を送り直す合図の決め方。
// DB・Redis には触れない純粋関数（src/server/video-jobs/worker-poll.ts が集めた状態を渡す）。
//
// - 管理画面を使っている間・待機中/生成中のジョブがある間は従来どおり15秒ごと、それ以外は60秒ごとに確認する
// - claim のたびに推しサーチ側で Worker の最終確認時刻を更新するため、30秒ごとの生存報告は不要になる
// - 管理画面からの依頼（CapCut台本の準備・まず見る3作の台本準備）と登録済みの読みは従来どおり生存報告の応答で届ける。
//   claim の応答では「依頼の状態の要約（signal）」だけを返し、Worker は値が変わったときにすぐ生存報告を送る

/** 管理画面使用中・ジョブがある間の確認間隔（従来の Worker の既定値と同じ） */
export const WORKER_POLL_ACTIVE_SECONDS = 15;
/** 管理画面を使っていない待機中の確認間隔 */
export const WORKER_POLL_IDLE_SECONDS = 60;
/** 管理画面の最後の操作から、この時間は「使用中」とみなす */
export const VIDEO_ADMIN_ACTIVE_WINDOW_SECONDS = 15 * 60;

export interface WorkerPollState {
  /** 今回の claim でジョブを取得した */
  claimed: boolean;
  /** queued / processing のジョブがある */
  hasActiveJobs: boolean;
  /** 管理画面が直近 VIDEO_ADMIN_ACTIVE_WINDOW_SECONDS 以内に使われた（判定できない場合は true） */
  adminActive: boolean;
}

export function decideWorkerPollSeconds(state: WorkerPollState): number {
  return state.claimed || state.hasActiveJobs || state.adminActive ? WORKER_POLL_ACTIVE_SECONDS : WORKER_POLL_IDLE_SECONDS;
}

export interface WorkerRequestState {
  /** video_workers.capcut_prepare_requests（このWorker宛てのCapCut台本の準備の依頼） */
  capcutPrepareRequests: Array<{ personName?: unknown; requestedAt?: unknown }>;
  /** 未処理の台本準備の依頼の件数と最大ID */
  pendingScriptRequestCount: number;
  pendingScriptRequestMaxId: number | null;
  /** 登録済みの読みの版（listPronunciationReadings と同じ「最終更新ms:件数」。テーブル未作成なら null） */
  readingsVersion: string | null;
}

/**
 * 生存報告で届ける依頼の状態の要約。依頼が増えた・処理された・読みが登録された、のいずれかで値が変わる。
 * Worker は前回の値と違えばすぐ生存報告を送る（同じ依頼が残っている間に何度も送り直さない）。
 */
export function workerRequestSignal(state: WorkerRequestState): string {
  const prepare = state.capcutPrepareRequests
    .map((r) => `${String(r.personName ?? '')}@${String(r.requestedAt ?? '')}`)
    .sort()
    .join(',');
  return JSON.stringify([prepare, state.pendingScriptRequestCount, state.pendingScriptRequestMaxId, state.readingsVersion]);
}

export function hasPendingWorkerRequests(state: WorkerRequestState): boolean {
  return state.capcutPrepareRequests.length > 0 || state.pendingScriptRequestCount > 0;
}

/** listPronunciationReadings() と同じ形式の版（最終更新ms:件数。0件なら "0:0"） */
export function pronunciationReadingsVersion(latestMs: number | null, count: number): string {
  return `${latestMs ?? 0}:${count}`;
}
