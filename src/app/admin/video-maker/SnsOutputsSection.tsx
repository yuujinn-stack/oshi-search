'use client';

// 完了したジョブの SNS別の完成動画（Instagram版・TikTok版）。プレビュー・MP4/SRT の個別ダウンロード・まとめてダウンロード。
// 片方が失敗していても、成功した方はそのまま使える（失敗した方は理由を表示する）。
// 結果は Worker の完了報告（result.snsOutputs）。出力先SNSを指定していない従来のジョブには表示しない。

import { useState } from 'react';
import { SNS_TARGET_LABELS, readSnsOutputsResult, type SnsOutputResult, type SnsTarget } from '@/lib/video-sns-output';

type JobLike = { id: string; personName: string; templateId: string; result: Record<string, unknown> | null };

function baseName(job: JobLike): string {
  return `${job.personName}_${job.templateId}`.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 名前を付けて保存する（取得できない環境では Blob のダウンロード用URLを開く。ファイル名は保存先の名前になる） */
async function downloadVideo(url: string, fileName: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    saveBlob(await res.blob(), fileName);
  } catch {
    const a = document.createElement('a');
    a.href = `${url}?download=1`;
    a.click();
  }
}

function downloadSrt(text: string, fileName: string) {
  saveBlob(new Blob([text], { type: 'application/x-subrip;charset=utf-8' }), fileName);
}

const AUDIO_LABELS: Record<string, string> = { capcut: 'CapCut 音声', none: '音声なし', template: 'テンプレートのまま' };

function SnsCard({ target, r, job }: { target: SnsTarget; r: SnsOutputResult; job: JobLike }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${baseName(job)}_${target}`;
  return (
    <div className="border border-gray-200 rounded-lg p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-bold text-slate-700">{SNS_TARGET_LABELS[target]}版</span>
        <span className={`px-1.5 py-0.5 rounded ${r.status === 'PASS' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.status === 'PASS' ? '作成済み' : '失敗'}</span>
      </div>
      {r.status === 'PASS' && r.url ? (
        <>
          <video src={r.url} controls playsInline preload="metadata" className="w-full rounded bg-black aspect-[9/16]" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-gray-600">
            <dt>CTA</dt>
            <dd>{r.ctaMode === 'search' ? `検索窓CTA「${r.narration ?? ''}」` : 'テンプレートのCTAのまま'}</dd>
            <dt>動画尺</dt>
            <dd>
              {r.durationSec != null ? `${r.durationSec.toFixed(1)}秒` : '-'}
              {r.ctaStartSec != null && r.ctaDurationSec != null ? `（${r.ctaStartSec.toFixed(1)}秒からCTA ${r.ctaDurationSec.toFixed(1)}秒）` : ''}
            </dd>
            <dt>CTAの音声</dt>
            <dd>{r.ctaAudio ? AUDIO_LABELS[r.ctaAudio] ?? r.ctaAudio : '-'}</dd>
          </dl>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                downloadVideo(r.url!, `${name}.mp4`)
                  .catch((e) => setError(String(e instanceof Error ? e.message : e)))
                  .finally(() => setBusy(false));
              }}
              className="text-violet-600 hover:underline disabled:opacity-40"
            >
              {busy ? '準備中…' : `⬇ ${SNS_TARGET_LABELS[target]}版をダウンロード`}
            </button>
            {r.srt ? (
              <button type="button" onClick={() => downloadSrt(r.srt!, `${name}.srt`)} className="text-violet-600 hover:underline">
                ⬇ SRT
              </button>
            ) : (
              <span className="text-gray-400">SRTなし（このテンプレートは字幕を出力しません）</span>
            )}
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </>
      ) : (
        <p className="text-red-700 bg-red-50 rounded p-2 whitespace-pre-wrap break-words">{r.error ?? '作成できませんでした。'}</p>
      )}
    </div>
  );
}

export default function SnsOutputsSection({ job }: { job: JobLike }) {
  const outputs = readSnsOutputsResult(job.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!outputs || outputs.targets.length === 0) return null;
  const ready = outputs.targets.filter((t) => outputs.results[t]?.status === 'PASS' && outputs.results[t]?.url);

  async function downloadAll() {
    setBusy(true);
    setError(null);
    try {
      for (const t of ready) {
        const r = outputs!.results[t]!;
        await downloadVideo(r.url!, `${baseName(job)}_${t}.mp4`);
        if (r.srt) downloadSrt(r.srt, `${baseName(job)}_${t}.srt`);
        await new Promise((res) => setTimeout(res, 400)); // ブラウザが連続したダウンロードを止めないよう少し待つ
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-700 text-sm">SNS別の動画</span>
        {ready.length > 1 && (
          <button type="button" disabled={busy} onClick={() => void downloadAll()} className="px-2 py-1 rounded bg-violet-600 text-white disabled:opacity-40">
            {busy ? 'ダウンロード中…' : '⬇ 両方をまとめてダウンロード（MP4・SRT）'}
          </button>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
        {outputs.targets.map((t) => {
          const r = outputs.results[t];
          return r ? <SnsCard key={t} target={t} r={r} job={job} /> : null;
        })}
      </div>
    </div>
  );
}
