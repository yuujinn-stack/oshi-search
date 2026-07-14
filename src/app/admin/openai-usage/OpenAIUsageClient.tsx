'use client';

import { useState, useEffect, useCallback } from 'react';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { USD_TO_JPY, FEATURE_LABELS } from '@/lib/openai-pricing';
import type { DayStat, FeatureStat, ModelStat } from '@/app/api/admin/openai-usage/route';
import type { UsageLogEntry } from '@/lib/openai-usage';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ApiResponse {
  period: { from: string; to: string };
  summary: {
    requestCount: number;
    successCount: number;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
    todayCostUsd: number;
    avgCostUsd: number;
  };
  byFeature: FeatureStat[];
  byModel: ModelStat[];
  byDay: DayStat[];
  logs: UsageLogEntry[];
  totalLogs: number;
  page: number;
  pageSize: number;
}

type Period = 'today' | 'week' | 'month' | 'last_month' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  today: '今日', week: '今週', month: '今月', last_month: '先月', custom: '期間指定',
};

// ── Formatters ─────────────────────────────────────────────────────────────────
function jpy(usd: number): string {
  return `¥${Math.round(usd * USD_TO_JPY).toLocaleString('ja-JP')}`;
}
function jpyFull(usd: number): string {
  return `¥${Math.round(usd * USD_TO_JPY).toLocaleString('ja-JP')} ($${usd.toFixed(4)})`;
}
function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Bar Chart ─────────────────────────────────────────────────────────────────
function DailyBarChart({ data }: { data: DayStat[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-8">データなし</p>;
  }
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.000001);

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-0.5 h-28">
        {data.map((d) => {
          const h = Math.max((d.costUsd / maxCost) * 100, d.costUsd > 0 ? 2 : 0);
          return (
            <div
              key={d.date}
              className="flex-1 relative group"
              style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
            >
              <div
                className="w-full rounded-t bg-indigo-500 group-hover:bg-indigo-400 transition-colors"
                style={{ height: `${h}%`, minHeight: d.costUsd > 0 ? '2px' : '0' }}
              />
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                {d.date.slice(5)}<br />{jpy(d.costUsd)}<br />{d.count}回
              </div>
            </div>
          );
        })}
      </div>
      {/* X-axis labels — show ~6 dates */}
      <div className="flex justify-between text-[9px] text-gray-400 px-0.5">
        {data.length > 0 && <span>{data[0].date.slice(5)}</span>}
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)].date.slice(5)}</span>}
        {data.length > 1 && <span>{data[data.length - 1].date.slice(5)}</span>}
      </div>
    </div>
  );
}

// ── Relative bar ──────────────────────────────────────────────────────────────
function RelBar({ value, max, color = 'bg-indigo-400' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-0.5">
      <div className={`${color} h-1.5 rounded-full`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function OpenAIUsageClient() {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period, page: String(page) });
      if (period === 'custom') {
        if (!customFrom || !customTo) { setLoading(false); return; }
        params.set('from', customFrom);
        params.set('to', customTo);
      }
      if (featureFilter) params.set('feature', featureFilter);
      if (modelFilter) params.set('model', modelFilter);
      if (personFilter) params.set('person', personFilter);
      const res = await fetch(`/api/admin/openai-usage?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo, featureFilter, modelFilter, personFilter, page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function downloadCsv() {
    const params = new URLSearchParams({ period, format: 'csv' });
    if (period === 'custom') { params.set('from', customFrom); params.set('to', customTo); }
    if (featureFilter) params.set('feature', featureFilter);
    if (modelFilter) params.set('model', modelFilter);
    if (personFilter) params.set('person', personFilter);
    window.open(`/api/admin/openai-usage?${params}`, '_blank');
  }

  const s = data?.summary;
  const maxFeatureCost = Math.max(...(data?.byFeature.map((f) => f.costUsd) ?? [0]));
  const maxModelCost = Math.max(...(data?.byModel.map((m) => m.costUsd) ?? [0]));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">OpenAI 利用状況</h1>
          <p className="text-sm text-gray-500 mt-1">
            API コスト・トークン数・機能別集計（1USD≒{USD_TO_JPY}JPY換算）
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">作品管理 →</a>
          <a href="/admin/product-check" className="text-indigo-600 hover:underline">商品管理 →</a>
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2 items-center mb-6">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setPeriod(p); setPage(1); }}
              className={`px-3 py-1.5 transition-colors ${
                period === p ? 'bg-slate-700 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center text-xs">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-xs" />
            <span className="text-gray-400">〜</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-xs" />
          </div>
        )}
        <button type="button" onClick={() => void fetchData()}
          className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
          更新
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-600 mb-4">
          取得エラー: {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          { label: '期間合計コスト', value: s ? jpy(s.totalCostUsd) : '—', sub: s ? `$${s.totalCostUsd.toFixed(4)}` : '', color: 'text-indigo-600' },
          { label: '今日のコスト', value: s ? jpy(s.todayCostUsd) : '—', sub: s ? `$${s.todayCostUsd.toFixed(4)}` : '', color: 'text-emerald-600' },
          { label: 'リクエスト数', value: s ? s.requestCount.toLocaleString() : '—', sub: s ? `成功 ${s.successCount}件` : '', color: 'text-slate-700' },
          { label: '入力トークン', value: s ? tokens(s.inputTokens) : '—', sub: '', color: 'text-blue-600' },
          { label: '出力トークン', value: s ? tokens(s.outputTokens) : '—', sub: '', color: 'text-violet-600' },
          { label: '平均コスト/回', value: s ? jpy(s.avgCostUsd) : '—', sub: s ? `$${s.avgCostUsd.toFixed(5)}` : '', color: 'text-amber-600' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-xl font-black mt-1 ${color} ${loading ? 'opacity-40' : ''}`}>{value}</p>
            {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Daily bar chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-slate-700 mb-3">日別コスト</h2>
          {loading ? (
            <div className="h-28 bg-gray-50 rounded animate-pulse" />
          ) : (
            <DailyBarChart data={data?.byDay ?? []} />
          )}
        </div>

        {/* Feature breakdown mini */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-slate-700 mb-3">機能別割合</h2>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map((i) => <div key={i} className="h-6 bg-gray-50 rounded animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2.5">
              {(data?.byFeature ?? []).map((f) => (
                <div key={f.feature}>
                  <div className="flex justify-between text-[10px] text-gray-500">
                    <span>{f.label}</span>
                    <span className="font-medium">{pct(f.costUsd, s?.totalCostUsd ?? 1)}</span>
                  </div>
                  <RelBar value={f.costUsd} max={maxFeatureCost} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feature table */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-700">機能別集計</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400 font-medium">
                <th className="text-left px-4 py-2">機能</th>
                <th className="text-right px-3 py-2">呼出数</th>
                <th className="text-right px-3 py-2">成功率</th>
                <th className="text-right px-3 py-2">入力</th>
                <th className="text-right px-3 py-2">出力</th>
                <th className="text-right px-4 py-2">コスト(USD)</th>
                <th className="text-right px-4 py-2">コスト(JPY)</th>
                <th className="px-4 py-2 w-24">割合</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-300">読み込み中…</td></tr>
              ) : (data?.byFeature ?? []).length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-300">データなし</td></tr>
              ) : (data?.byFeature ?? []).map((f) => (
                <tr key={f.feature} className="border-b border-gray-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-700">
                    <button type="button" onClick={() => setFeatureFilter(featureFilter === f.feature ? '' : f.feature)}
                      className={`hover:text-indigo-600 transition-colors ${featureFilter === f.feature ? 'text-indigo-600 underline' : ''}`}>
                      {f.label}
                    </button>
                  </td>
                  <td className="text-right px-3 py-2.5 text-gray-600">{f.count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2.5 text-gray-500">
                    {f.count > 0 ? `${Math.round((f.successCount / f.count) * 100)}%` : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5 text-blue-600">{tokens(f.inputTokens)}</td>
                  <td className="text-right px-3 py-2.5 text-violet-600">{tokens(f.outputTokens)}</td>
                  <td className="text-right px-4 py-2.5 font-mono text-gray-600">${f.costUsd.toFixed(4)}</td>
                  <td className="text-right px-4 py-2.5 font-medium text-indigo-600">{jpy(f.costUsd)}</td>
                  <td className="px-4 py-2.5">
                    <RelBar value={f.costUsd} max={maxFeatureCost} />
                    <p className="text-[9px] text-gray-400 text-right">{pct(f.costUsd, s?.totalCostUsd ?? 1)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model table */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-slate-700">モデル別集計</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400 font-medium">
                <th className="text-left px-4 py-2">モデル</th>
                <th className="text-right px-3 py-2">呼出数</th>
                <th className="text-right px-3 py-2">入力</th>
                <th className="text-right px-3 py-2">出力</th>
                <th className="text-right px-4 py-2">コスト(USD)</th>
                <th className="text-right px-4 py-2">コスト(JPY)</th>
                <th className="px-4 py-2 w-24">割合</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-300">読み込み中…</td></tr>
              ) : (data?.byModel ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-300">データなし</td></tr>
              ) : (data?.byModel ?? []).map((m) => (
                <tr key={m.model} className="border-b border-gray-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-700">{m.label}</p>
                    <p className="text-[9px] text-gray-400 font-mono">{m.model}</p>
                  </td>
                  <td className="text-right px-3 py-2.5 text-gray-600">{m.count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2.5 text-blue-600">{tokens(m.inputTokens)}</td>
                  <td className="text-right px-3 py-2.5 text-violet-600">{tokens(m.outputTokens)}</td>
                  <td className="text-right px-4 py-2.5 font-mono text-gray-600">${m.costUsd.toFixed(4)}</td>
                  <td className="text-right px-4 py-2.5 font-medium text-indigo-600">{jpy(m.costUsd)}</td>
                  <td className="px-4 py-2.5">
                    <RelBar value={m.costUsd} max={maxModelCost} color="bg-violet-400" />
                    <p className="text-[9px] text-gray-400 text-right">{pct(m.costUsd, s?.totalCostUsd ?? 1)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xs font-semibold text-slate-700">
            利用ログ
            {data && <span className="ml-2 text-gray-400 font-normal">{data.totalLogs.toLocaleString()}件</span>}
          </h2>
          <div className="flex gap-2 items-center flex-wrap">
            {/* Filters */}
            <select value={featureFilter} onChange={(e) => { setFeatureFilter(e.target.value); setPage(1); }}
              className="text-[10px] border border-gray-200 rounded px-2 py-1 text-gray-600">
              <option value="">全機能</option>
              {Object.entries(FEATURE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input type="text" value={personFilter} onChange={(e) => { setPersonFilter(e.target.value); setPage(1); }}
              placeholder="人物名..."
              className="text-[10px] border border-gray-200 rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-slate-300" />
            {(featureFilter || modelFilter || personFilter) && (
              <button type="button" onClick={() => { setFeatureFilter(''); setModelFilter(''); setPersonFilter(''); setPage(1); }}
                className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">✕ クリア</button>
            )}
            <button type="button" onClick={downloadCsv}
              className="text-[10px] px-2.5 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
              CSV DL
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] text-gray-400 font-medium">
                <th className="text-left px-4 py-2">日時</th>
                <th className="text-left px-3 py-2">機能</th>
                <th className="text-left px-3 py-2">モデル</th>
                <th className="text-left px-3 py-2">人物</th>
                <th className="text-right px-3 py-2">入力</th>
                <th className="text-right px-3 py-2">出力</th>
                <th className="text-right px-3 py-2">コスト</th>
                <th className="text-right px-3 py-2">時間</th>
                <th className="text-center px-3 py-2">状態</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-300">読み込み中…</td></tr>
              ) : (data?.logs ?? []).length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-300">ログなし（まだAPIが呼ばれていません）</td></tr>
              ) : (data?.logs ?? []).map((e, i) => (
                <tr key={`${e.ts}-${i}`} className={`border-b border-gray-50 hover:bg-slate-50 transition-colors ${!e.success ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-2 text-gray-500 font-mono whitespace-nowrap">{fmtDate(e.ts)}</td>
                  <td className="px-3 py-2 text-slate-600">{FEATURE_LABELS[e.feature] ?? e.feature}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{e.model}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[8rem] truncate">{e.personName ?? '—'}</td>
                  <td className="text-right px-3 py-2 text-blue-600">{tokens(e.inputTokens)}</td>
                  <td className="text-right px-3 py-2 text-violet-600">{tokens(e.outputTokens)}</td>
                  <td className="text-right px-3 py-2 text-indigo-600 font-medium">{jpyFull(e.estimatedCostUsd)}</td>
                  <td className="text-right px-3 py-2 text-gray-400">{e.durationMs != null ? `${e.durationMs}ms` : '—'}</td>
                  <td className="text-center px-3 py-2">
                    {e.success ? (
                      <span className="text-emerald-500 text-[10px]">✓</span>
                    ) : (
                      <span className="text-red-500 text-[10px]" title={e.errorMessage}>✗</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalLogs > data.pageSize && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>{(data.page - 1) * data.pageSize + 1}〜{Math.min(data.page * data.pageSize, data.totalLogs)}件 / 全{data.totalLogs}件</span>
            <div className="flex gap-1">
              <button type="button" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                ← 前
              </button>
              <button type="button" disabled={data.page * data.pageSize >= data.totalLogs} onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                次 →
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 text-center mt-4">
        コストはトークン数から推定（1USD≒{USD_TO_JPY}JPY換算）。実際の請求額はOpenAIダッシュボードで確認してください。
      </p>
    </div>
  );
}
