'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import PersonMultiSelect from '../instagram-schedule/PersonMultiSelect';

/**
 * /admin/video-maker のクライアント部分。
 * テンプレート・対応ナレーション方式はWorkerが報告した内容（正本はoshi-video-makerのVIDEO_TEMPLATE_REGISTRY）
 * だけを表示し、ここには定義を持たない。待機中・実行中のジョブがある間だけ5秒ごとに状態を更新する。
 */

type NarrationMode = 'none' | 'auto' | 'capcut';

interface WorkerTemplate {
  templateId: string;
  name: string;
  description: string;
  version: number;
  narrationModes: string[];
}

interface WorkerInfo {
  workerId: string;
  lastSeenAt: string;
  online: boolean;
  version: string | null;
  templates: WorkerTemplate[];
  persons: string[];
  capcutStore: CapcutStoreReport | null;
}

type CapcutStatus = 'ready' | 'stale' | 'missing' | 'check_failed';

interface CapcutEntry {
  personName: string;
  personSlug: string;
  templateId: string;
  status: CapcutStatus;
  message: string;
  scriptText: string | null;
  scriptHash: string | null;
  savedScriptHash: string | null;
  duration: number | null;
  updatedAt: string | null;
  fileBaseName: string;
}

interface CapcutStoreReport {
  inboxDir: string;
  reportedAt: string;
  entries: CapcutEntry[];
}

interface VideoJob {
  id: string;
  batchId: string | null;
  retryOfJobId: string | null;
  personName: string;
  personSlug: string | null;
  templateId: string;
  narrationMode: NarrationMode;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  progressStep: number | null;
  progressTotal: number | null;
  progressLabel: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorStep: string | null;
  errorMessage: string | null;
  videoUrl: string | null;
  videoSizeBytes: number | null;
  durationSec: number | null;
  qaStatus: 'PASS' | 'FAIL' | null;
  qaWarnings: string[] | null;
  postTexts: Record<string, string | null> | null;
  narrationScript: string | null;
  result: Record<string, unknown> | null;
}

const NARRATION_LABELS: Record<NarrationMode, string> = {
  auto: '自動ナレーション',
  capcut: 'CapCut保存済み音声',
  none: '音声なし（あとから追加）',
};
const NARRATION_ORDER: NarrationMode[] = ['auto', 'capcut', 'none'];

const CAPCUT_STATUS_VIEW: Record<CapcutStatus, { icon: string; label: string; cls: string }> = {
  ready: { icon: '🟢', label: '使用可能', cls: 'bg-emerald-50 text-emerald-700' },
  stale: { icon: '🟡', label: '台本変更あり・再作成必要', cls: 'bg-amber-50 text-amber-700' },
  missing: { icon: '🔴', label: '音声なし', cls: 'bg-red-50 text-red-700' },
  check_failed: { icon: '⚠️', label: '取り込みチェック失敗', cls: 'bg-orange-50 text-orange-700' },
};

type CapcutFilter = 'all' | 'todo' | 'redo' | 'ready';
const CAPCUT_FILTERS: Array<{ key: CapcutFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'todo', label: '作成待ち' },
  { key: 'redo', label: '録り直し' },
  { key: 'ready', label: '準備済み' },
];
function capcutFilterOf(status: CapcutStatus): CapcutFilter {
  if (status === 'ready') return 'ready';
  return status === 'missing' ? 'todo' : 'redo';
}

const STATUS_VIEW: Record<VideoJob['status'], { label: string; cls: string }> = {
  queued: { label: '待機中', cls: 'bg-gray-100 text-gray-600' },
  processing: { label: '生成中', cls: 'bg-violet-100 text-violet-700' },
  completed: { label: '完了', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '失敗', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'キャンセル', cls: 'bg-gray-100 text-gray-400' },
};

const POST_TEXT_TABS: Array<{ key: string; label: string }> = [
  { key: 'default', label: '投稿文' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'threads', label: 'Threads' },
  { key: 'x', label: 'X' },
];

function formatJst(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export default function VideoMakerClient({ persons }: { persons: PersonOption[] }) {
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [narrationMode, setNarrationMode] = useState<NarrationMode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [capcutFilter, setCapcutFilter] = useState<CapcutFilter>('all');

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ jobs: VideoJob[]; worker: WorkerInfo | null }>('/api/admin/video-jobs');
      setJobs(data.jobs);
      setWorker(data.worker);
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 待機中・生成中のジョブがある間だけ定期更新する
  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'processing');
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const templates = useMemo(() => worker?.templates ?? [], [worker]);
  const template = templates.find((t) => t.templateId === templateId) ?? null;

  // CapCut保存済み音声: Workerが報告した状態（正本はMac上の保存音声と台本）。CapCut対応テンプレートでだけ表示する
  const capcutSupported = !!template?.narrationModes.includes('capcut');
  const capcutEntries = useMemo(
    () => (capcutSupported && template ? (worker?.capcutStore?.entries ?? []).filter((e) => e.templateId === template.templateId) : []),
    [capcutSupported, template, worker],
  );
  const capcutByName = useMemo(() => new Map(capcutEntries.map((e) => [e.personName, e])), [capcutEntries]);
  const capcutCounts = useMemo(() => {
    const c: Record<CapcutFilter, number> = { all: capcutEntries.length, todo: 0, redo: 0, ready: 0 };
    for (const e of capcutEntries) c[capcutFilterOf(e.status)]++;
    return c;
  }, [capcutEntries]);
  // 次に作る1件: 録り直し（台本変更・チェック失敗）を優先し、次に音声なし
  const nextCapcut = capcutEntries.find((e) => capcutFilterOf(e.status) === 'redo') ?? capcutEntries.find((e) => e.status === 'missing') ?? null;
  const visibleCapcut = capcutEntries.filter((e) => capcutFilter === 'all' || capcutFilterOf(e.status) === capcutFilter);

  // CapCut対応テンプレートを開いている間は、MacでCapCut音声を受信フォルダに置いた結果が反映されるよう10秒ごとに更新する
  useEffect(() => {
    if (!capcutSupported || hasActive) return;
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [capcutSupported, hasActive, load]);

  // テンプレートが決まったら、対応している方式だけを選べるようにする（非対応の選択は自動で外す）
  useEffect(() => {
    if (!templateId && templates.length > 0) setTemplateId(templates[0].templateId);
  }, [templateId, templates]);
  useEffect(() => {
    if (!template) return;
    if (!narrationMode || !template.narrationModes.includes(narrationMode)) {
      setNarrationMode((NARRATION_ORDER.find((m) => template.narrationModes.includes(m)) as NarrationMode) ?? null);
    }
  }, [template, narrationMode]);

  const workerPersons = useMemo(() => new Set(worker?.persons ?? []), [worker]);
  const unsupportedSelected = selectedNames.filter((n) => worker && !workerPersons.has(n));
  const templateName = (id: string) => templates.find((t) => t.templateId === id)?.name ?? id;

  // CapCut保存済み音声で生成するとき: 対象（選択中の人物。未選択ならこのテンプレートの全人物）のうちreadyだけを生成し、残りは理由付きで除外
  const capcutTargets = selectedNames.length > 0 ? selectedNames : capcutEntries.map((e) => e.personName);
  const capcutReadyTargets = capcutTargets.filter((n) => capcutByName.get(n)?.status === 'ready');
  const capcutExcluded = capcutTargets
    .filter((n) => capcutByName.get(n)?.status !== 'ready')
    .map((n) => {
      const e = capcutByName.get(n);
      return { name: n, reason: e ? `${CAPCUT_STATUS_VIEW[e.status].icon} ${CAPCUT_STATUS_VIEW[e.status].label}` : 'Workerの対応表に未登録（状態不明）' };
    });
  const capcutMode = narrationMode === 'capcut';
  const selectedNotReady = capcutMode ? selectedNames.filter((n) => capcutByName.get(n)?.status !== 'ready') : [];

  async function submit(names: string[] = selectedNames) {
    if (!template || !narrationMode || names.length === 0) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const data = await fetchJson<{ jobs: VideoJob[] }>('/api/admin/video-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personNames: names, templateId: template.templateId, narrationMode }),
      });
      setMessage({ kind: 'ok', text: `${data.jobs.length}件のジョブを登録しました。Workerが順番に生成します。` });
      setSelectedNames([]);
      await load();
    } catch (err) {
      setMessage({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function jobAction(id: string, action: 'cancel' | 'retry') {
    try {
      await fetchJson(`/api/admin/video-jobs/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    }
  }

  return (
    <div className="space-y-6">
      {/* Workerの状態 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm">
          <span className="font-bold text-slate-700 mr-2">動画生成Worker</span>
          {worker ? (
            worker.online ? (
              <span className="text-emerald-700">🟢 オンライン</span>
            ) : (
              <span className="text-red-600">🔴 オフライン（最終確認 {formatJst(worker.lastSeenAt)}）</span>
            )
          ) : (
            <span className="text-gray-500">未接続（Mac上で npm run worker を起動してください）</span>
          )}
          {worker?.version && <span className="ml-2 text-xs text-gray-400">v{worker.version}</span>}
        </div>
        <button type="button" onClick={() => void load()} className="text-xs text-gray-500 hover:text-violet-600">
          ↻ 更新
        </button>
      </div>
      {loadError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">読み込みに失敗しました: {loadError}</div>}

      {/* 作成フォーム */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <section>
          <h2 className="text-sm font-bold text-slate-700 mb-2">1. テンプレート</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">Workerからテンプレート情報がまだ届いていません。</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <label
                  key={t.templateId}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    templateId === t.templateId ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300'
                  }`}
                >
                  <input type="radio" name="vm-template" className="mr-2" checked={templateId === t.templateId} onChange={() => setTemplateId(t.templateId)} />
                  <span className="font-bold text-slate-800">{t.name}</span>
                  <span className="block text-xs text-gray-500 mt-1">{t.description}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-700 mb-2">2. ナレーション方式</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {NARRATION_ORDER.map((m) => {
              const supported = !!template?.narrationModes.includes(m);
              return (
                <label key={m} className={supported ? 'cursor-pointer' : 'text-gray-300 cursor-not-allowed'} title={supported ? '' : 'このテンプレート・Workerでは選択できません'}>
                  <input type="radio" name="vm-narration" className="mr-1" disabled={!supported} checked={narrationMode === m} onChange={() => setNarrationMode(m)} />
                  {NARRATION_LABELS[m]}
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-700 mb-2">3. 人物（複数選択可）</h2>
          <PersonMultiSelect
            persons={persons}
            postedPersonNames={new Set()}
            selected={selectedNames}
            onChange={setSelectedNames}
            showPersonPostedBadge={false}
            selectionOrderNote="この順番で1本ずつ生成されます"
          />
          {unsupportedSelected.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 mt-2">
              ⚠ Workerの人物対応表に未登録のため、生成時に失敗します: {unsupportedSelected.join('、')}
            </p>
          )}
          {selectedNotReady.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 mt-2">
              ⚠ CapCut保存済み音声がreadyではない人物が含まれているため、このままでは生成できません:{' '}
              {selectedNotReady.join('、')}（「readyの人物だけまとめて生成」を使うと除外して生成できます）
            </p>
          )}
        </section>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={submitting || !template || !narrationMode || selectedNames.length === 0 || selectedNotReady.length > 0}
            onClick={() => void submit()}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:bg-gray-300"
          >
            {submitting ? '登録中...' : `生成する（${selectedNames.length}件）`}
          </button>
          {capcutMode && (
            <button
              type="button"
              disabled={submitting || capcutReadyTargets.length === 0}
              onClick={() => void submit(capcutReadyTargets)}
              className="px-5 py-2 rounded-lg border border-violet-600 text-violet-700 text-sm font-bold disabled:border-gray-300 disabled:text-gray-400"
            >
              {`readyの人物だけまとめて生成（${capcutReadyTargets.length}件）`}
            </button>
          )}
          {message && <span className={`text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</span>}
        </div>
        {capcutMode && (
          <div className="text-xs text-gray-600 space-y-1">
            <p>
              対象: {selectedNames.length > 0 ? '選択中の人物' : 'このテンプレートの全人物'}
              {capcutReadyTargets.length > 0 && <>／生成する人物: {capcutReadyTargets.join('、')}</>}
            </p>
            {capcutExcluded.length > 0 && (
              <div>
                <p className="font-bold text-gray-700">除外される人物（{capcutExcluded.length}人）</p>
                <ul className="list-disc ml-5">
                  {capcutExcluded.map((x) => (
                    <li key={x.name}>
                      {x.name}: {x.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CapCut音声作成待ち（CapCut対応テンプレートのみ） */}
      {capcutSupported && template && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-700">CapCut音声作成待ち（{template.name}）</h2>
            <span className="text-xs text-gray-400">
              {worker?.capcutStore ? `Worker報告 ${formatJst(worker.capcutStore.reportedAt)}・10秒ごとに自動更新` : 'Workerからの報告待ち'}
            </span>
          </div>
          <div className="flex gap-3 text-sm flex-wrap">
            <span className="rounded-lg bg-red-50 text-red-700 px-3 py-1">作成待ち {capcutCounts.todo}</span>
            <span className="rounded-lg bg-amber-50 text-amber-700 px-3 py-1">録り直し {capcutCounts.redo}</span>
            <span className="rounded-lg bg-emerald-50 text-emerald-700 px-3 py-1">準備済み {capcutCounts.ready}</span>
          </div>
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer">作り方（CapCutでの作業は手動です）</summary>
            <ol className="list-decimal ml-5 mt-1 space-y-0.5">
              <li>カードの台本をコピーし、CapCutでナレーション音声と字幕を作成する</li>
              <li>音声（WAV）と字幕（SRT）を、カードのファイル名で書き出す（例: ファイル名.wav / ファイル名.srt）</li>
              <li>
                Macの受信フォルダ（{worker?.capcutStore?.inboxDir ?? 'assets/audio-capcut/_inbox'}）に2つのファイルを置く
              </li>
              <li>Workerが自動で取り込み・チェックし、数十秒後にこの画面が 🟢 使用可能 になります</li>
            </ol>
          </details>
          <div className="flex gap-2 text-xs flex-wrap">
            {CAPCUT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setCapcutFilter(f.key)}
                className={`px-3 py-1 rounded-full border ${capcutFilter === f.key ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600'}`}
              >
                {f.label}（{capcutCounts[f.key]}）
              </button>
            ))}
          </div>
          {capcutEntries.length === 0 ? (
            <p className="text-sm text-gray-500">Workerからこのテンプレートの音声状態がまだ届いていません。</p>
          ) : visibleCapcut.length === 0 ? (
            <p className="text-sm text-gray-500">該当する人物はいません。</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visibleCapcut.map((e) => (
                <CapcutCard key={`${e.personSlug}-${e.templateId}`} entry={e} templateName={template.name} isNext={nextCapcut === e} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 生成履歴 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">生成履歴</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-500">まだジョブはありません。</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {jobs.map((job) => {
              const view = STATUS_VIEW[job.status];
              const open = openJobId === job.id;
              return (
                <div key={job.id} className="py-3">
                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${view.cls}`}>{view.label}</span>
                    <span className="font-bold text-slate-800">{job.personName}</span>
                    <span className="text-gray-600">{templateName(job.templateId)}</span>
                    <span className="text-xs text-gray-500">{NARRATION_LABELS[job.narrationMode] ?? job.narrationMode}</span>
                    {job.status === 'processing' && (
                      <span className="text-xs text-violet-700">
                        {job.progressStep && job.progressTotal ? `STEP ${job.progressStep}/${job.progressTotal} ` : ''}
                        {job.progressLabel ?? ''}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{formatJst(job.createdAt)}</span>
                    {job.status === 'queued' && (
                      <button type="button" onClick={() => void jobAction(job.id, 'cancel')} className="text-xs text-gray-500 hover:text-red-600">
                        キャンセル
                      </button>
                    )}
                    {(job.status === 'completed' || job.status === 'failed') && (
                      <button type="button" onClick={() => setOpenJobId(open ? null : job.id)} className="text-xs text-violet-600 hover:underline">
                        {open ? '閉じる' : '詳細'}
                      </button>
                    )}
                  </div>
                  {open && job.status === 'completed' && <CompletedDetail job={job} onRetry={() => void jobAction(job.id, 'retry')} />}
                  {open && job.status === 'failed' && (
                    <div className="mt-3 text-sm bg-red-50 rounded-lg p-3 space-y-2">
                      <div>
                        <span className="font-bold text-red-700">失敗STEP：</span>
                        {job.errorStep ?? '(不明)'}
                      </div>
                      <div className="text-red-700 whitespace-pre-wrap break-words">{job.errorMessage}</div>
                      <button type="button" onClick={() => void jobAction(job.id, 'retry')} className="px-3 py-1 rounded bg-violet-600 text-white text-xs font-bold">
                        再生成
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-violet-400 hover:text-violet-700"
    >
      {copied ? 'コピーしました' : label}
    </button>
  );
}

function CapcutCard({ entry, templateName, isNext }: { entry: CapcutEntry; templateName: string; isNext: boolean }) {
  const view = CAPCUT_STATUS_VIEW[entry.status];
  return (
    <div className={`rounded-lg border p-3 space-y-2 text-sm ${isNext ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span className="font-bold text-slate-800">{entry.personName}</span>
          <span className="ml-2 text-xs text-gray-500">{templateName}</span>
          {isNext && <span className="ml-2 text-xs font-bold text-violet-700">← 次に作成</span>}
        </div>
        <span className={`text-xs rounded px-2 py-0.5 ${view.cls}`}>
          {view.icon} {view.label}
        </span>
      </div>
      {entry.status !== 'ready' && entry.status !== 'missing' && <p className="text-xs text-gray-600">{entry.message}</p>}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-gray-600">台本</span>
          {entry.scriptText && <CopyButton text={entry.scriptText} label="台本をコピー" />}
        </div>
        <pre className="whitespace-pre-wrap text-xs bg-gray-50 rounded p-2 text-slate-700">{entry.scriptText ?? '（台本を作成できませんでした）'}</pre>
      </div>
      <div className="flex items-center justify-between gap-2">
        <code className="text-xs bg-gray-50 rounded px-2 py-0.5 break-all">{entry.fileBaseName}</code>
        <CopyButton text={entry.fileBaseName} label="ファイル名をコピー" />
      </div>
      <p className="text-xs text-gray-500">
        更新 {formatJst(entry.updatedAt)}
        {entry.status === 'ready' && entry.duration != null && <>／長さ {entry.duration.toFixed(1)}秒</>}
      </p>
    </div>
  );
}

function CompletedDetail({ job, onRetry }: { job: VideoJob; onRetry: () => void }) {
  const [tab, setTab] = useState('default');
  const text = job.postTexts?.[tab] ?? '';
  const result = job.result ?? {};
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-[240px_1fr]">
      <div>
        {job.videoUrl && <video src={job.videoUrl} controls playsInline className="w-full rounded-lg bg-black aspect-[9/16]" />}
        <div className="flex gap-3 mt-2 text-xs">
          {job.videoUrl && (
            <a href={`${job.videoUrl}?download=1`} className="text-violet-600 hover:underline">
              ⬇ ダウンロード
            </a>
          )}
          <button type="button" onClick={onRetry} className="text-gray-500 hover:text-violet-600">
            再生成
          </button>
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-gray-500">QA</span>
          <span className={job.qaStatus === 'PASS' ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
            {job.qaStatus ?? '-'}
            {job.qaWarnings && job.qaWarnings.length > 0 ? `（警告${job.qaWarnings.length}件）` : ''}
          </span>
          <span className="text-gray-500">動画尺</span>
          <span>{job.durationSec != null ? `${job.durationSec.toFixed(1)}秒` : '-'}</span>
          <span className="text-gray-500">サイズ</span>
          <span>{job.videoSizeBytes != null ? `${(job.videoSizeBytes / 1024 / 1024).toFixed(1)}MB` : '-'}</span>
          <span className="text-gray-500">作品数 / 代表作品</span>
          <span>
            {String(result.workCount ?? '-')} / {String(result.representativeWorkTitle ?? '-')}
          </span>
          <span className="text-gray-500">配信サービス</span>
          <span>{Array.isArray(result.vodServicesUsed) ? (result.vodServicesUsed as string[]).join(' / ') : '-'}</span>
        </div>
        {job.qaWarnings && job.qaWarnings.length > 0 && (
          <ul className="text-xs text-amber-700 bg-amber-50 rounded p-2 list-disc pl-5">
            {job.qaWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div>
          <div className="flex gap-2 mb-1">
            {POST_TEXT_TABS.filter((t) => job.postTexts?.[t.key]).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`text-xs px-2 py-0.5 rounded ${tab === t.key ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea readOnly value={text} className="w-full h-32 text-xs border border-gray-200 rounded p-2" />
          <button type="button" onClick={() => void navigator.clipboard.writeText(text)} className="text-xs text-violet-600 hover:underline">
            コピー
          </button>
        </div>
      </div>
    </div>
  );
}
