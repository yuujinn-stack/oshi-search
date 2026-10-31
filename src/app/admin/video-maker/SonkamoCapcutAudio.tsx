'use client';

import { useState } from 'react';
import { put } from '@vercel/blob/client';

// 動画「推し活で損してるかも？ V1」: 完了した音声なし動画に、CapCut で書き出した WAV（narration.wav）と SRT（narration.srt）を付けて、
// 「音声付き動画を生成」で音声付きの動画を別のジョブとして作る（元の音声なし動画はそのまま残る）。
// ファイルはこのジョブ専用のパスへ Vercel Blob に直接アップロードする（許可は /api/admin/video-jobs/{id}/capcut-upload）。
// 合成（字幕と台本の対応付け・読み上げに合わせたシーンの伸縮・音声の重ね合わせ）は動画生成Worker（oshi-video-maker）が行う。

type FileState = { status: 'none' } | { status: 'uploading'; name: string } | { status: 'ready'; name: string; url: string; size: number } | { status: 'error'; message: string };

export interface SonkamoVoicedJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressLabel: string | null;
  errorStep: string | null;
  errorMessage: string | null;
  qaStatus: 'PASS' | 'FAIL' | null;
  durationSec: number | null;
  createdAt: string;
}

const JOB_STATUS: Record<SonkamoVoicedJob['status'], { label: string; cls: string }> = {
  queued: { label: '生成待ち', cls: 'bg-gray-100 text-gray-700' },
  processing: { label: '生成中', cls: 'bg-violet-100 text-violet-700' },
  completed: { label: '生成完了', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'エラー', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'キャンセル', cls: 'bg-gray-100 text-gray-500' },
};

async function uploadFile(jobId: string, kind: 'wav' | 'srt', file: File): Promise<{ url: string }> {
  const res = await fetch(`/api/admin/video-jobs/${jobId}/capcut-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, fileSizeBytes: file.size }),
  });
  const data = (await res.json().catch(() => ({}))) as { pathname?: string; clientToken?: string; contentType?: string; error?: string };
  if (!res.ok || !data.pathname || !data.clientToken) throw new Error(data.error ?? `HTTP ${res.status}`);
  const blob = await put(data.pathname, file, { access: 'public', token: data.clientToken, contentType: data.contentType });
  return { url: blob.url };
}

export default function SonkamoCapcutAudio({
  job,
  voicedJobs,
  onCreated,
}: {
  job: { id: string; personName: string; templateId: string; templateInput?: { target?: 'person' | 'group' } | null };
  /** この音声なし動画から作った音声付きのジョブ（新しい順） */
  voicedJobs: SonkamoVoicedJob[];
  onCreated: () => void;
}) {
  const [wav, setWav] = useState<FileState>({ status: 'none' });
  const [srt, setSrt] = useState<FileState>({ status: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function pick(kind: 'wav' | 'srt', file: File | undefined) {
    const set = kind === 'wav' ? setWav : setSrt;
    setMessage(null);
    if (!file) return set({ status: 'none' });
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== kind) return set({ status: 'error', message: `${kind.toUpperCase()} ファイル（.${kind}）を選んでください` });
    set({ status: 'uploading', name: file.name });
    try {
      const { url } = await uploadFile(job.id, kind, file);
      set({ status: 'ready', name: file.name, url, size: file.size });
    } catch (err) {
      set({ status: 'error', message: String(err instanceof Error ? err.message : err) });
    }
  }

  async function generate() {
    if (wav.status !== 'ready' || srt.status !== 'ready') return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/video-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personNames: [job.personName],
          templateId: job.templateId,
          narrationMode: 'capcut',
          // 原稿・撮影データの場所はサーバーが元のジョブから付け直す
          templateInput: { version: 1, target: job.templateInput?.target ?? 'person', honorific: '', memberName: null, lines: null, audio: { sourceJobId: job.id, wavUrl: wav.url, srtUrl: srt.url } },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage({ kind: 'ok', text: '音声付き動画のジョブを登録しました。完成すると下の一覧と生成履歴に表示されます。' });
      setWav({ status: 'none' });
      setSrt({ status: 'none' });
      onCreated();
    } catch (err) {
      setMessage({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setSubmitting(false);
    }
  }

  const fileRow = (kind: 'wav' | 'srt', state: FileState, label: string) => (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="w-40 text-gray-600">{label}</span>
      <input
        type="file"
        accept={kind === 'wav' ? '.wav,audio/wav' : '.srt'}
        aria-label={label}
        disabled={state.status === 'uploading' || submitting}
        onChange={(e) => void pick(kind, e.target.files?.[0])}
        className="text-xs"
      />
      <span
        className={
          state.status === 'ready' ? 'text-emerald-700' : state.status === 'error' ? 'text-red-600' : state.status === 'uploading' ? 'text-violet-700' : 'text-gray-500'
        }
      >
        {state.status === 'none' && `${kind.toUpperCase()}未登録`}
        {state.status === 'uploading' && `取り込み中…（${state.name}）`}
        {state.status === 'ready' && `✓ 取り込み完了（${state.name}・${(state.size / 1024 / 1024).toFixed(1)}MB）`}
        {state.status === 'error' && `⚠ ${state.message}`}
      </span>
    </div>
  );

  return (
    <div className="mt-3 border border-violet-200 bg-violet-50/40 rounded-lg p-3 space-y-2 text-xs">
      <p className="font-bold text-violet-800">🎙 CapCut 音声を付けて、音声付き動画を作る</p>
      <p className="text-gray-600">
        CapCut に「音声用台本」を貼って好きなAI音声で読み上げ、速度を調整して、音声を WAV（narration.wav）、字幕を SRT（narration.srt）で書き出してから選んでください。
        字幕と台本を照合し、読み上げに合わせて各シーンを伸縮した動画を作ります（最後の読み上げの約1秒後にサイト紹介で終わります。21秒まで。この音声なし動画はそのまま残ります）。
      </p>
      {fileRow('wav', wav, '音声（narration.wav）')}
      {fileRow('srt', srt, '字幕（narration.srt）')}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={wav.status !== 'ready' || srt.status !== 'ready' || submitting}
          onClick={() => void generate()}
          className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:bg-gray-300"
        >
          {submitting ? '登録中...' : '音声付き動画を生成'}
        </button>
        {message && <span className={message.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}>{message.text}</span>}
      </div>
      {voicedJobs.length > 0 && (
        <div className="space-y-1">
          <p className="text-gray-600 font-bold">この動画から作った音声付き動画</p>
          {voicedJobs.map((v) => (
            <div key={v.id} className="flex items-center gap-2 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded ${JOB_STATUS[v.status].cls}`}>{JOB_STATUS[v.status].label}</span>
              <span className="text-gray-500">{new Date(v.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>
              {v.status === 'processing' && v.progressLabel && <span className="text-violet-700">{v.progressLabel}</span>}
              {v.status === 'completed' && (
                <span className="text-gray-600">
                  QA {v.qaStatus ?? '-'}・{v.durationSec != null ? `${v.durationSec.toFixed(1)}秒` : '-'}（生成履歴の同じ名前の新しい行の「詳細」から再生・ダウンロード）
                </span>
              )}
              {v.status === 'failed' && (
                <span className="text-red-600">
                  {v.errorStep ? `[${v.errorStep}] ` : ''}
                  {v.errorMessage}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
