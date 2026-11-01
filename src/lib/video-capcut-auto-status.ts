// フォロー獲得リールの CapCut 音声の自動取り込み（Worker の受信フォルダ）の状況を、管理画面に出す1つの段階にまとめる純粋関数。
// 材料は「この音声なし動画から作った音声付きのジョブ」（生成履歴）と「Worker が報告した受信フォルダの出来事」だけ。

export type CapcutAutoStage = 'waiting' | 'detected' | 'queued' | 'applying' | 'done' | 'error';

export const CAPCUT_AUTO_STAGE_LABEL: Record<CapcutAutoStage, string> = {
  waiting: 'CapCut音声待ち',
  detected: 'WAV・SRT検知済み（アップロード中）',
  queued: 'WAV・SRT検知済み（反映の順番待ち）',
  applying: '音声・字幕を反映中',
  done: '完成MP4生成完了',
  error: 'エラー',
};

export interface CapcutAutoVoicedJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  errorStep: string | null;
  errorMessage: string | null;
  progressLabel: string | null;
}

export interface CapcutAutoEvent {
  status: 'detected' | 'attached' | 'error';
  message: string;
  at: string;
  voicedJobId: string | null;
}

export interface CapcutAutoState {
  stage: CapcutAutoStage;
  message: string | null;
  /** いちばん新しい音声付きのジョブ（あれば） */
  voicedJobId: string | null;
}

/** 受信フォルダに置くファイルのベース名（+ .wav と .srt）。Worker の判定規則（{人物slug}__{templateId}__{ジョブIDの先頭8桁}）と同じ */
export function capcutAutoFileBase(job: { id: string; personSlug: string | null; templateId: string }): string | null {
  return job.personSlug ? `${job.personSlug}__${job.templateId}__${job.id.slice(0, 8)}` : null;
}

const time = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
};

/**
 * いちばん新しい出来事で段階を決める。受信フォルダの出来事（見つけた・取り込めなかった）が、いちばん新しい音声付きのジョブより
 * 後なら出来事の方を、そうでなければジョブの状態を使う（音声付きのジョブを作った後の進み具合は生成履歴が正本）
 */
export function capcutAutoState(voicedJobs: CapcutAutoVoicedJob[], events: CapcutAutoEvent[]): CapcutAutoState {
  const job = [...voicedJobs].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0] ?? null;
  const event = [...events].filter((e) => e.status !== 'attached').sort((a, b) => time(b.at) - time(a.at))[0] ?? null;
  if (event && (!job || time(event.at) > time(job.createdAt))) {
    return event.status === 'error'
      ? { stage: 'error', message: event.message || '取り込めませんでした', voicedJobId: job?.id ?? null }
      : { stage: 'detected', message: event.message || null, voicedJobId: job?.id ?? null };
  }
  if (!job) return { stage: 'waiting', message: null, voicedJobId: null };
  switch (job.status) {
    case 'queued':
      return { stage: 'queued', message: null, voicedJobId: job.id };
    case 'processing':
      return { stage: 'applying', message: job.progressLabel, voicedJobId: job.id };
    case 'completed':
      return { stage: 'done', message: null, voicedJobId: job.id };
    case 'failed':
      return { stage: 'error', message: `${job.errorStep ? `[${job.errorStep}] ` : ''}${job.errorMessage ?? '音声付き動画の生成に失敗しました'}`, voicedJobId: job.id };
    default:
      return { stage: 'waiting', message: null, voicedJobId: job.id };
  }
}
