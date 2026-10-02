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
  capcut: 'CapCutナレーション',
  none: '音声なし（あとから追加）',
};
const NARRATION_ORDER: NarrationMode[] = ['auto', 'capcut', 'none'];

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

  async function submit() {
    if (!template || !narrationMode || selectedNames.length === 0) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const data = await fetchJson<{ jobs: VideoJob[] }>('/api/admin/video-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personNames: selectedNames, templateId: template.templateId, narrationMode }),
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
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={submitting || !template || !narrationMode || selectedNames.length === 0}
            onClick={() => void submit()}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:bg-gray-300"
          >
            {submitting ? '登録中...' : `生成する（${selectedNames.length}件）`}
          </button>
          {message && <span className={`text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</span>}
        </div>
      </div>

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
