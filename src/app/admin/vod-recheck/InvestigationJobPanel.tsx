'use client';

// 調査対象CSV（workId列のみ・vodService等は空欄）をアップロードした際の自動調査ジョブUI。
// 流れ: 件数・費用概算の確認画面 → 自動調査を開始 → バッチ処理をポーリング（進行状況・停止・再開・
// 失敗のみ再試行） → 調査結果の確認・承認（作品ごとに承認/却下/要再調査/手動編集） →
// 反映前プレビュー → 承認済みの結果を反映（既存CSV反映ロジックを再利用）。
// このコンポーネント自体はDBへ直接書き込まず、すべて /api/admin/vod-recheck/investigation-jobs
// 系のAPI（内部で既存のCSV反映ロジックを呼ぶ）経由でのみ変更を行う。
import { useState, useEffect, useRef, useCallback } from 'react';
import type { VodProvider, VodProviderType } from '@/types/vod';

const VOD_TYPE_LABEL: Record<VodProviderType, string> = {
  flatrate: '見放題', rent: 'レンタル', buy: '購入', free: '無料', ads: '広告付き無料', unknown: '不明',
};

interface EstimateResponse {
  estimate: {
    targetCount: number;
    estimatedSearchCalls: number;
    estimatedOpenAiCalls: number;
    estimatedCostUsd: number;
    estimatedCostJpy: number;
    maxItems: number;
  };
  unresolvedWorkIds: string[];
  targets: Array<{ workId: string; title: string; workType: string; releaseYear: number | null }>;
  historicalStats: { sampleSize: number; successRate: number; avgCostUsd: number } | null;
  usedFallbackCost: boolean;
}

interface JobItem {
  id: number;
  workId: string;
  personName: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  status: string;
  decision: string;
  retryCount: number;
  candidateProviders: VodProvider[];
  currentProvidersSnapshot: VodProvider[];
  manualProviders: VodProvider[];
  errorMessage?: string | null;
  investigatedAt?: string | null;
}

interface Progress {
  total: number; pending: number; investigating: number; needsReview: number; approved: number; rejected: number; failed: number;
}

interface JobResponse {
  job: { id: string; status: string };
  items: JobItem[];
  progress: Progress;
}

interface ApplyPreviewWork {
  workId: string;
  title: string | null;
  services: Array<{ providerName: string; availabilityType: string }>;
  currentVodCount: number;
  afterVodCount: number;
  currentUnknownCount: number;
  afterUnknownCount: number;
  warnings: string[];
  errors: string[];
}

const DECISION_LABEL: Record<string, string> = {
  pending: '未確認', approved: '承認済み', rejected: '却下', needs_review: '要再調査', manual: '手動編集で承認',
};

function fmtTs(ts: string | number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function InvestigationJobPanel({ csv, onApplied }: { csv: string; onApplied: () => void }) {
  const [phase, setPhase] = useState<'estimate' | 'processing' | 'review'>('estimate');
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [manualEdit, setManualEdit] = useState<Record<number, { providerName: string; type: VodProviderType; sourceUrl: string; note: string }>>({});
  const [applyPreview, setApplyPreview] = useState<{ preview: ApplyPreviewWork[]; unresolvedWorkIds: string[]; hasFatalErrors: boolean } | null>(null);
  const [applyMsg, setApplyMsg] = useState('');
  const loopStopRef = useRef(false);

  const fetchEstimate = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/vod-recheck/investigation-jobs/estimate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '見積もりに失敗しました');
      setEstimate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [csv]);

  useEffect(() => { fetchEstimate(); }, [fetchEstimate]);

  async function refreshJob(id: string): Promise<JobResponse | null> {
    const res = await fetch(`/api/admin/vod-recheck/investigation-jobs/${id}`);
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'ジョブの取得に失敗しました'); return null; }
    setJob(json);
    return json;
  }

  async function processLoop(id: string) {
    loopStopRef.current = false;
    while (!loopStopRef.current) {
      const res = await fetch(`/api/admin/vod-recheck/investigation-jobs/${id}/process`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        // paused（停止操作）はエラー扱いしない
        if (res.status !== 409) setError(json.error ?? '処理に失敗しました');
        break;
      }
      const current = await refreshJob(id);
      if (!current) break;
      if (current.job.status === 'completed' || current.job.status === 'paused') break;
      if (json.processed === 0) break; // 念のための安全弁（無限ループ防止）
    }
    if (!loopStopRef.current) {
      const current = await refreshJob(id);
      if (current?.job.status === 'completed') setPhase('review');
    }
  }

  async function startInvestigation() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/vod-recheck/investigation-jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'ジョブの作成に失敗しました');
      setJobId(json.jobId);
      setPhase('processing');
      await refreshJob(json.jobId);
      processLoop(json.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopJob() {
    if (!jobId) return;
    loopStopRef.current = true;
    await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }),
    });
    await refreshJob(jobId);
  }

  async function resumeJob() {
    if (!jobId) return;
    await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }),
    });
    processLoop(jobId);
  }

  async function retryFailed() {
    if (!jobId) return;
    await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry_failed' }),
    });
    setPhase('processing');
    processLoop(jobId);
  }

  async function decide(itemId: number, decision: string, manualProviders?: VodProvider[]) {
    if (!jobId) return;
    setError('');
    const res = await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}/items/${itemId}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, manualProviders }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? '判断の保存に失敗しました'); return; }
    const current = await refreshJob(jobId);
    if (current?.job.status === 'running' || (current && current.items.some((i) => i.status === 'pending'))) {
      // needs_review（要再調査）でpendingへ戻った項目がある場合は再度処理ループを回す
      setPhase('processing');
      processLoop(jobId);
    }
  }

  function submitManual(itemId: number) {
    const draft = manualEdit[itemId];
    if (!draft || !draft.providerName.trim()) return;
    const provider: VodProvider = {
      providerId: 0, providerName: draft.providerName.trim(), type: draft.type, countryCode: 'JP',
      source: 'manual_csv', sourceLabel: '手動編集', sourceUrl: draft.sourceUrl.trim() || undefined, note: draft.note.trim() || undefined,
      confidence: 'high', checkedDate: new Date().toISOString().slice(0, 10),
    };
    decide(itemId, 'manual', [provider]);
  }

  const canBulkApply = job ? job.items.length > 0 && job.items.every((i) => i.decision === 'approved' || i.decision === 'manual' || i.decision === 'rejected') : false;

  async function fetchApplyPreview() {
    if (!jobId) return;
    setBusy(true);
    setApplyMsg('');
    try {
      const res = await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}/apply-preview`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '反映プレビューに失敗しました');
      setApplyPreview(json);
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitApply() {
    if (!jobId) return;
    setBusy(true);
    setApplyMsg('');
    try {
      const res = await fetch(`/api/admin/vod-recheck/investigation-jobs/${jobId}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '反映に失敗しました');
      setApplyMsg(`${json.updatedWorks}件のVOD情報を反映しました。`);
      setApplyPreview(null);
      onApplied();
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'estimate') {
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-indigo-800">調査対象CSVを検出しました（自動調査）</h3>
        <p className="text-xs text-indigo-700">
          このCSVには配信サービス列（vodService）が入力されていません。AIが各作品の配信情報を自動調査し、候補を作成します。
          調査結果はDBへ自動保存されず、必ず管理者の承認後にのみ反映されます。
        </p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>}
        {busy && !estimate && <p className="text-xs text-gray-500">見積もりを取得中…</p>}
        {estimate && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
            <p>対象作品数: <b>{estimate.estimate.targetCount}件</b>（上限{estimate.estimate.maxItems}件）</p>
            <p>推定OpenAI呼び出し回数: {estimate.estimate.estimatedOpenAiCalls}回</p>
            <p>推定費用: 約${estimate.estimate.estimatedCostUsd.toFixed(3)}（約{estimate.estimate.estimatedCostJpy.toFixed(0)}円）
              {estimate.usedFallbackCost && <span className="text-amber-600"> ※実績データが無いため保守的な既定値で概算</span>}
            </p>
            {estimate.historicalStats && (
              <p className="text-gray-400">実績: 過去{estimate.historicalStats.sampleSize}回・成功率{(estimate.historicalStats.successRate * 100).toFixed(0)}%</p>
            )}
            {estimate.unresolvedWorkIds.length > 0 && (
              <p className="text-red-600">未解決のworkId（対象外）: {estimate.unresolvedWorkIds.join(', ')}</p>
            )}
            <button
              type="button"
              disabled={busy || estimate.estimate.targetCount === 0}
              onClick={startInvestigation}
              className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              自動調査を開始（{estimate.estimate.targetCount}件）
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === 'processing') {
    const p = job?.progress;
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-indigo-800">自動調査を実行中…</h3>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>}
        {p && (
          <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-1">
            <p>全{p.total}件中: 完了 {p.needsReview + p.approved + p.rejected}件 / 調査中 {p.investigating}件 / 待機中 {p.pending}件 / 失敗 {p.failed}件</p>
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div className="bg-indigo-500 h-2" style={{ width: `${p.total > 0 ? ((p.total - p.pending - p.investigating) / p.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {job?.job.status === 'paused' ? (
            <button type="button" onClick={resumeJob} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">再開</button>
          ) : (
            <button type="button" onClick={stopJob} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50">停止</button>
          )}
          {(p?.failed ?? 0) > 0 && (
            <button type="button" onClick={retryFailed} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50">失敗のみ再試行</button>
          )}
        </div>
      </div>
    );
  }

  // phase === 'review'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-700">自動調査結果の確認・承認</h3>
      <p className="text-xs text-gray-500">各作品ごとに承認・却下・要再調査・手動編集のいずれかを選択してください。1件でも未確認の候補が残っている場合は反映できません。</p>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-3">
        {job?.items.map((item) => (
          <div key={item.id} className="border border-gray-200 rounded-lg p-3 text-xs space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-slate-700">{item.title}（{item.workType} / {item.releaseYear ?? '年不明'}）</p>
                <p className="text-gray-400 font-mono">{item.workId} / {item.personName}</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">{DECISION_LABEL[item.decision] ?? item.decision}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-gray-400 mb-1">現在のVOD情報</p>
                {item.currentProvidersSnapshot.length === 0 && <p className="text-gray-400">なし</p>}
                {item.currentProvidersSnapshot.map((p, i) => (
                  <p key={i}>{p.providerName}（{VOD_TYPE_LABEL[p.type]}）</p>
                ))}
              </div>
              <div>
                <p className="text-gray-400 mb-1">調査結果の候補（{fmtTs(item.investigatedAt)}確認）</p>
                {item.errorMessage && <p className="text-red-600">調査エラー: {item.errorMessage}（リトライ{item.retryCount}回）</p>}
                {item.candidateProviders.map((p, i) => (
                  <div key={i} className="mb-1">
                    <p>
                      {p.providerName}（{VOD_TYPE_LABEL[p.type]} / confidence: {p.confidence ?? '—'}）
                    </p>
                    {(p.sourceUrl || p.officialUrl) && (
                      <a href={p.sourceUrl ?? p.officialUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">
                        {p.sourceUrl ?? p.officialUrl}
                      </a>
                    )}
                    {p.note && <p className="text-gray-400">{p.note}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-gray-100">
              <button type="button" onClick={() => decide(item.id, 'approved')} className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-semibold hover:bg-emerald-200">承認</button>
              <button type="button" onClick={() => decide(item.id, 'rejected')} className="px-2 py-1 rounded bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">却下</button>
              <button type="button" onClick={() => decide(item.id, 'needs_review')} className="px-2 py-1 rounded bg-amber-100 text-amber-700 font-semibold hover:bg-amber-200">要再調査</button>
            </div>

            <div className="flex flex-wrap gap-2 items-center pt-1">
              <input placeholder="サービス名" value={manualEdit[item.id]?.providerName ?? ''} onChange={(e) => setManualEdit((prev) => ({ ...prev, [item.id]: { providerName: e.target.value, type: prev[item.id]?.type ?? 'flatrate', sourceUrl: prev[item.id]?.sourceUrl ?? '', note: prev[item.id]?.note ?? '' } }))} className="border border-gray-300 rounded px-2 py-1 w-28" />
              <select value={manualEdit[item.id]?.type ?? 'flatrate'} onChange={(e) => setManualEdit((prev) => ({ ...prev, [item.id]: { providerName: prev[item.id]?.providerName ?? '', type: e.target.value as VodProviderType, sourceUrl: prev[item.id]?.sourceUrl ?? '', note: prev[item.id]?.note ?? '' } }))} className="border border-gray-300 rounded px-1 py-1">
                {(Object.keys(VOD_TYPE_LABEL) as VodProviderType[]).map((t) => <option key={t} value={t}>{VOD_TYPE_LABEL[t]}</option>)}
              </select>
              <input placeholder="sourceUrl" value={manualEdit[item.id]?.sourceUrl ?? ''} onChange={(e) => setManualEdit((prev) => ({ ...prev, [item.id]: { providerName: prev[item.id]?.providerName ?? '', type: prev[item.id]?.type ?? 'flatrate', sourceUrl: e.target.value, note: prev[item.id]?.note ?? '' } }))} className="border border-gray-300 rounded px-2 py-1 flex-1 min-w-[120px]" />
              <button type="button" onClick={() => submitManual(item.id)} className="px-2 py-1 rounded bg-indigo-100 text-indigo-700 font-semibold hover:bg-indigo-200">手動編集で承認</button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button type="button" disabled={!canBulkApply || busy} onClick={fetchApplyPreview} title={!canBulkApply ? '1件でも未確認（要再調査を含む）の候補があるため反映できません' : undefined}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40">
          反映前プレビュー
        </button>
        <button type="button" disabled={!canBulkApply || !applyPreview || applyPreview.hasFatalErrors || busy} onClick={commitApply}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
          承認済みの結果を反映
        </button>
      </div>
      {applyMsg && <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-lg px-3 py-2">{applyMsg}</div>}

      {applyPreview && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="p-2 text-left">workId</th>
                <th className="p-2 text-left">サービス</th>
                <th className="p-2">現在の有効VOD</th>
                <th className="p-2">反映後の有効VOD</th>
                <th className="p-2">現在のunknown</th>
                <th className="p-2">反映後のunknown</th>
                <th className="p-2 text-left">注意</th>
              </tr>
            </thead>
            <tbody>
              {applyPreview.preview.map((w) => (
                <tr key={w.workId} className="border-t border-gray-100">
                  <td className="p-2 font-mono max-w-[140px] truncate" title={w.workId}>{w.workId}</td>
                  <td className="p-2">{w.services.map((s, i) => <span key={i} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">{s.providerName}（{s.availabilityType}）</span>)}</td>
                  <td className="p-2 text-center">{w.currentVodCount}</td>
                  <td className="p-2 text-center font-semibold">{w.afterVodCount}</td>
                  <td className="p-2 text-center">{w.currentUnknownCount}</td>
                  <td className="p-2 text-center">{w.afterUnknownCount}</td>
                  <td className="p-2">{w.warnings.map((m, i) => <p key={i} className="text-amber-600">{m}</p>)}{w.errors.map((m, i) => <p key={i} className="text-red-600">{m}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
