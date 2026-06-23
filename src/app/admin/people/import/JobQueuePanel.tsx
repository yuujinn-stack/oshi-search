'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PersonJob, PersonJobStatus } from '@/lib/person-job-queue';

const STATUS_LABEL: Record<PersonJobStatus, string> = {
  queued:        'キュー待機',
  processing:    '処理中',
  completed:     '完了',
  partial_error: '一部失敗',
  failed:        '失敗',
  cancelled:     'キャンセル',
};
const STATUS_BADGE: Record<PersonJobStatus, string> = {
  queued:        'bg-sky-100 text-sky-700',
  processing:    'bg-blue-100 text-blue-700',
  completed:     'bg-green-100 text-green-700',
  partial_error: 'bg-amber-100 text-amber-700',
  failed:        'bg-red-100 text-red-700',
  cancelled:     'bg-gray-100 text-gray-500',
};
const STEP_LABEL = { pending: '待機', running: '実行中', done: '完了', failed: '失敗' };
const STEP_COLOR = { pending: 'text-gray-400', running: 'text-blue-500 animate-pulse', done: 'text-green-600', failed: 'text-red-500' };

const STUCK_MINUTES = 15;
function isStuck(job: PersonJob): boolean {
  return (
    job.status === 'processing' &&
    !!job.startedAt &&
    Date.now() - job.startedAt > STUCK_MINUTES * 60 * 1000
  );
}

const MAX_SELECTABLE = 3;

type FilterKey = 'all' | PersonJobStatus;

export default function JobQueuePanel() {
  const [jobs, setJobs] = useState<PersonJob[]>([]);
  const [queueLength, setQueueLength] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [processNowLoading, setProcessNowLoading] = useState(false);
  const [processNowError, setProcessNowError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/people/jobs');
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setQueueLength(data.queueLength ?? 0);
      // 選択中のジョブが処理済みになっていたら選択解除
      setSelectedJobIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          const job = (data.jobs ?? []).find((j: PersonJob) => j.jobId === id);
          if (job?.status === 'queued') next.add(id);
        }
        return next;
      });
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleAction(jobId: string, action: 'requeue' | 'cancel') {
    setActionLoading(jobId);
    try {
      await fetch('/api/admin/people/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId }),
      });
      await refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleProcessNow(jobIds?: string[]) {
    setProcessNowLoading(true);
    setProcessNowError(null);
    try {
      const res = await fetch('/api/admin/person-jobs/process-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobIds && jobIds.length > 0 ? { jobIds } : {}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setProcessNowError(data.error ?? '処理に失敗しました');
      } else if (data.processed === 0) {
        setProcessNowError('処理できるキュー待機ジョブがありませんでした');
      }
      setSelectedJobIds(new Set());
      await refresh();
    } catch (err) {
      setProcessNowError(String(err));
    } finally {
      setProcessNowLoading(false);
    }
  }

  function toggleSelect(jobId: string) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else if (next.size < MAX_SELECTABLE) {
        next.add(jobId);
      }
      return next;
    });
  }

  const counts: Partial<Record<FilterKey, number>> = { all: jobs.length };
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
  }

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  const activeJobs = (counts.queued ?? 0) + (counts.processing ?? 0);
  const failedJobs = (counts.failed ?? 0) + (counts.partial_error ?? 0);
  const queuedJobs = counts.queued ?? 0;

  if (loading) {
    return (
      <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-5 text-sm text-gray-400 text-center">
        ジョブ状況を読み込み中…
      </div>
    );
  }

  if (jobs.length === 0) return null;

  return (
    <div className="mt-6">
      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'キュー待機', value: queueLength, color: 'text-sky-700', bg: 'bg-sky-50 border-sky-100' },
          { label: '処理中', value: counts.processing ?? 0, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100' },
          { label: '完了', value: counts.completed ?? 0, color: 'text-green-700', bg: 'bg-green-50 border-green-100' },
          { label: '失敗', value: failedJobs, color: 'text-red-700', bg: 'bg-red-50 border-red-100' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-xl border p-3 text-center ${bg}`}>
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* 今すぐ処理バナー */}
      {queuedJobs > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-3 flex-wrap text-sm text-amber-800">
          <span className="font-medium">
            {queuedJobs}件がキュー待機中（次回Cron: 09:00 UTC）
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {selectedJobIds.size > 0 && (
              <button
                onClick={() => handleProcessNow([...selectedJobIds])}
                disabled={processNowLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {processNowLoading ? '処理中...' : `選択した${selectedJobIds.size}件を処理`}
              </button>
            )}
            <button
              onClick={() => handleProcessNow()}
              disabled={processNowLoading || queuedJobs === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {processNowLoading ? '処理中...' : '今すぐ処理'}
            </button>
          </div>
        </div>
      )}

      {/* 処理中バナー（Cronまたは手動実行中） */}
      {processNowLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-sm text-blue-700">
          <span className="animate-spin">⟳</span>
          <span>処理中です。完了まで数十秒かかります...</span>
        </div>
      )}

      {/* エラー表示 */}
      {processNowError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3 flex items-center justify-between text-sm text-red-700">
          <span>{processNowError}</span>
          <button onClick={() => setProcessNowError(null)} className="text-red-400 hover:text-red-600 ml-4 text-xs">✕</button>
        </div>
      )}

      {/* 処理中Cron実行バナー */}
      {!processNowLoading && activeJobs > 0 && (counts.processing ?? 0) > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-sm text-blue-700">
          <span className="animate-pulse">●</span>
          <span>処理実行中（{activeJobs}件待機）。完了までしばらくお待ちください。</span>
          <button onClick={refresh} className="ml-auto text-xs text-blue-500 hover:underline">更新</button>
        </div>
      )}

      {/* スタックジョブ警告バナー */}
      {jobs.some(isStuck) && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-sm text-amber-800">
          <span>⚠️</span>
          <span>
            {STUCK_MINUTES}分以上 processing のジョブがあります。
            Vercel Functionタイムアウトの可能性があります。
            一覧の「再キュー投入」ボタンで手動復旧できます。
          </span>
          <button onClick={refresh} className="ml-auto text-xs text-amber-600 hover:underline">更新</button>
        </div>
      )}

      {/* テーブル */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-sm text-slate-700">
            ジョブキュー
            <span className="ml-1.5 text-gray-400 font-normal text-xs">{jobs.length}件</span>
          </h3>
          <div className="flex items-center gap-2">
            {selectedJobIds.size > 0 && (
              <span className="text-xs text-indigo-600 font-medium">
                {selectedJobIds.size}件選択中（最大{MAX_SELECTABLE}件）
              </span>
            )}
            <button onClick={refresh} className="text-xs text-indigo-500 hover:underline">
              更新
            </button>
          </div>
        </div>

        {/* フィルタータブ */}
        <div className="flex overflow-x-auto border-b border-gray-100 text-xs">
          {(
            [
              { key: 'all' as FilterKey,           label: 'すべて' },
              { key: 'queued' as FilterKey,         label: 'キュー待機' },
              { key: 'processing' as FilterKey,     label: '処理中' },
              { key: 'completed' as FilterKey,      label: '完了' },
              { key: 'partial_error' as FilterKey,  label: '一部失敗' },
              { key: 'failed' as FilterKey,         label: '失敗' },
              { key: 'cancelled' as FilterKey,      label: 'キャンセル' },
            ] as { key: FilterKey; label: string }[]
          )
            .filter(({ key }) => key === 'all' || (counts[key] ?? 0) > 0)
            .map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-4 py-2.5 whitespace-nowrap font-medium transition-colors border-b-2 ${
                  filter === key
                    ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
                <span className="ml-1 text-gray-400">({counts[key] ?? 0})</span>
              </button>
            ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">該当するジョブがありません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="px-4 py-2 font-medium">人物名</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 font-medium">楽天</th>
                  <th className="px-4 py-2 font-medium">TMDb</th>
                  <th className="px-4 py-2 font-medium">登録日時</th>
                  <th className="px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((job) => {
                  const isActing = actionLoading === job.jobId;
                  const stuck = isStuck(job);
                  const canRequeue = ['failed', 'partial_error', 'cancelled'].includes(job.status) || stuck;
                  const canCancel = job.status === 'queued';
                  const isQueued = job.status === 'queued';
                  const isSelected = selectedJobIds.has(job.jobId);
                  const isMaxSelected = selectedJobIds.size >= MAX_SELECTABLE && !isSelected;

                  return (
                    <tr key={job.jobId} className={`hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''}`}>
                      <td className="px-3 py-2.5">
                        {isQueued && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(job.jobId)}
                            disabled={isMaxSelected || processNowLoading}
                            className="w-3.5 h-3.5 rounded accent-indigo-600 disabled:opacity-30"
                            title={isMaxSelected ? `最大${MAX_SELECTABLE}件まで選択できます` : '選択して今すぐ処理'}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{job.personName}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[job.status]}`}>
                          {STATUS_LABEL[job.status]}
                        </span>
                        {job.errorMessage && (
                          <p className="text-red-400 mt-0.5 max-w-[160px] truncate" title={job.errorMessage}>
                            {job.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={STEP_COLOR[job.steps.rakuten.status]}>
                          {STEP_LABEL[job.steps.rakuten.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={STEP_COLOR[job.steps.tmdb.status]}>
                          {STEP_LABEL[job.steps.tmdb.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">
                        {new Date(job.createdAt).toLocaleString('ja-JP', {
                          month: 'numeric', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          {canRequeue && (
                            <button
                              onClick={() => handleAction(job.jobId, 'requeue')}
                              disabled={isActing}
                              className={`px-2 py-1 rounded text-xs border disabled:opacity-40 ${
                                stuck
                                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-300'
                                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border-indigo-200'
                              }`}
                            >
                              {stuck ? '再キュー投入' : '再実行'}
                            </button>
                          )}
                          {canCancel && (
                            <button
                              onClick={() => handleAction(job.jobId, 'cancel')}
                              disabled={isActing || processNowLoading}
                              className="px-2 py-1 rounded text-xs bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200 disabled:opacity-40"
                            >
                              キャンセル
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 注意事項 */}
        <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
          ※「今すぐ処理」は1回の実行で最大{MAX_SELECTABLE}件処理します。Vercel Functionのタイムアウト（300秒）内で完了します。
        </div>
      </div>
    </div>
  );
}
