'use client';

import CopyButton from './CopyButton';
import { CAPCUT_AUTO_STAGE_LABEL, capcutAutoFileBase, capcutAutoState, type CapcutAutoEvent, type CapcutAutoStage, type CapcutAutoVoicedJob } from '@/lib/video-capcut-auto-status';

// フォロー獲得リール: 完了した音声なし動画の「詳細」に、CapCut 音声の自動取り込みの書き出し先・ファイル名・進み具合を出す。
// CapCut で WAV・SRT をこのファイル名で Mac の受信フォルダへ書き出すと、Worker が見つけて音声付き動画のジョブを作り、
// そのまま生成する（手動の「音声付き動画を生成」と同じジョブ。手動の取り込みは下に予備として残す）。

const STEPS: Array<{ stage: CapcutAutoStage | 'silent'; label: string }> = [
  { stage: 'silent', label: '仮動画生成完了' },
  { stage: 'waiting', label: 'CapCut音声待ち' },
  { stage: 'detected', label: 'WAV・SRT検知済み' },
  { stage: 'applying', label: '音声・字幕を反映中' },
  { stage: 'done', label: '完成MP4生成完了' },
];
const STEP_INDEX: Record<CapcutAutoStage, number> = { waiting: 1, detected: 2, queued: 2, applying: 3, done: 4, error: -1 };

export default function FollowCapcutAutoStatus({
  job,
  voicedJobs,
  events,
  inboxDir,
  workerOnline,
}: {
  job: { id: string; personSlug: string | null; templateId: string };
  voicedJobs: CapcutAutoVoicedJob[];
  /** Worker が報告した、このジョブの受信フォルダの出来事 */
  events: CapcutAutoEvent[];
  /** 受信フォルダ（Worker が報告した絶対パス。古い Worker は oshi-video-maker からの相対パス） */
  inboxDir: string | null;
  workerOnline: boolean;
}) {
  const base = capcutAutoFileBase(job);
  const state = capcutAutoState(voicedJobs, events);
  const current = STEP_INDEX[state.stage];
  const folder = inboxDir ?? 'oshi-video-maker/assets/audio-capcut/_inbox';
  return (
    <div className="mt-3 border border-emerald-200 bg-emerald-50/40 rounded-lg p-3 space-y-2 text-xs">
      <p className="font-bold text-emerald-800">🎙 CapCut 音声の自動取り込み</p>
      <ol className="flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => {
          const done = state.stage !== 'error' && i < (current < 0 ? 1 : current);
          const active = state.stage !== 'error' && i === current;
          return (
            <li
              key={s.stage}
              className={`px-2 py-0.5 rounded-full border ${active ? 'bg-emerald-600 border-emerald-600 text-white font-bold' : done || i === 0 ? 'border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-400'}`}
            >
              {(done || (i === 0 && !active)) && '✓ '}
              {i === current ? CAPCUT_AUTO_STAGE_LABEL[state.stage] : s.label}
            </li>
          );
        })}
        {state.stage === 'error' && <li className="px-2 py-0.5 rounded-full bg-red-600 text-white font-bold">エラー</li>}
      </ol>
      {state.stage === 'error' && <p className="text-red-600 whitespace-pre-wrap break-words">⚠ {state.message}（書き出し直すと、もう一度取り込みます）</p>}
      {state.stage === 'applying' && state.message && <p className="text-violet-700">{state.message}</p>}
      {state.stage === 'done' && <p className="text-emerald-700">生成履歴のこの人物・グループの新しい行（CapCut）の「詳細」から再生・ダウンロードできます。</p>}
      {base ? (
        <div className="space-y-1 text-gray-700">
          <p>
            CapCut の書き出しで、名前に下のファイル名を貼り、保存先を受信フォルダにして、音声（WAV）と字幕（SRT）を書き出してください（他のテンプレートの CapCut 音声と同じ手順。名前の末尾8桁でこの動画を特定します）。
            両方そろって書き込みが終わると、Worker が自動で音声付きの動画を作ります（アップロード・ボタン操作は不要）。
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-16 text-gray-500">名前</span>
            <code className="bg-white border border-gray-200 rounded px-2 py-1 text-slate-800 break-all">{base}</code>
            <CopyButton text={base} label="ファイル名をコピー" primary />
            <span className="text-gray-500">→ {base}.wav ／ {base}.srt</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-16 text-gray-500">保存先</span>
            <code className="bg-white border border-gray-200 rounded px-2 py-1 text-slate-800 break-all">{folder}</code>
            <CopyButton text={folder} label="保存先をコピー" />
            <span className="text-gray-500">（CapCut の保存先で Finder を開き ⌘⇧G で貼り付け。一度選べば次回から同じ場所）</span>
          </div>
          {!workerOnline && <p className="text-amber-700">⚠ 動画生成Worker が接続していません（Mac の Worker が動いているときだけ取り込みます）。</p>}
        </div>
      ) : (
        <p className="text-amber-700">このジョブには人物の識別子が無いため自動取り込みできません。下の手動の取り込みを使ってください。</p>
      )}
    </div>
  );
}
