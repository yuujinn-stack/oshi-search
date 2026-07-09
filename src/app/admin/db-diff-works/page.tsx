'use client';

import { useState } from 'react';

interface WorkEntry {
  personName: string;
  workId: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  source: string;
  status: string;
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PersonCount { personName: string; count: number; }

interface DbOnlyAnalysis {
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  byPerson: PersonCount[];
  deletedCount: number;
  totalCount: number;
  verdict: 'normal' | 'likely-normal' | 'suspicious' | 'unknown';
  verdictNote: string;
}

interface DiffSummary {
  dbTotal: number;
  redisTotal: number;
  dbOnlyCount: number;
  redisOnlyCount: number;
  truncatedAt: number;
}

interface DiffResult {
  summary?: DiffSummary;
  dbOnlyAnalysis?: DbOnlyAnalysis;
  dbOnly?: WorkEntry[];
  redisOnly?: Array<{ personName: string; workId: string }>;
  error?: string;
}

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  'normal':        { bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  label: '✓ 正常データ — 削除不要' },
  'likely-normal': { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-800',   label: '○ 正常データの可能性大 — 削除不要' },
  'unknown':       { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-800',  label: '? 判定不能 — 手動確認が必要' },
  'suspicious':    { bg: 'bg-red-50 border-red-200',      text: 'text-red-800',    label: '⚠ 要確認 — テスト/削除済みデータの可能性あり' },
};

function fmtDate(v: string | null): string {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('ja-JP'); } catch { return v; }
}

function StatusBadge({ status, deleted }: { status: string; deleted: boolean }) {
  if (deleted) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700">deleted</span>;
  const cls =
    status === 'auto_published' ? 'bg-green-100 text-green-700' :
    status === 'excluded'       ? 'bg-gray-100 text-gray-500'   :
    status === 'needs_review'   ? 'bg-amber-100 text-amber-700' :
    'bg-blue-100 text-blue-700';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${cls}`}>{status}</span>;
}

function KvTable({ data, label }: { data: Record<string, number>; label: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <div className="flex gap-1.5 flex-wrap">
        {entries.map(([k, v]) => (
          <span key={k} className="text-xs px-2 py-0.5 rounded bg-white border text-gray-700 font-mono">
            {k}: <strong>{v}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function DbOnlyTable({ entries, truncatedAt }: { entries: WorkEntry[]; truncatedAt: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, 30);

  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-gray-500">
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">person_name</th>
              <th className="text-left py-1.5 px-2 font-medium">title</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">type</th>
              <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">year</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">source</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">status</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">created_at</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">updated_at</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">work_id</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i} className={`border-b hover:bg-gray-50 ${e.deleted ? 'opacity-50' : ''}`}>
                <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
                <td className="py-1 px-2 max-w-xs">
                  <span className="block truncate" title={e.title}>{e.title}</span>
                </td>
                <td className="py-1 px-2 text-gray-500 whitespace-nowrap">{e.workType}</td>
                <td className="py-1 px-2 text-right text-gray-500">{e.releaseYear ?? '-'}</td>
                <td className="py-1 px-2 font-mono text-gray-500 whitespace-nowrap">{e.source}</td>
                <td className="py-1 px-2 whitespace-nowrap">
                  <StatusBadge status={e.status} deleted={e.deleted} />
                </td>
                <td className="py-1 px-2 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(e.createdAt)}</td>
                <td className="py-1 px-2 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(e.updatedAt)}</td>
                <td className="py-1 px-2 font-mono text-gray-300 whitespace-nowrap text-[10px]">{e.workId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > 30 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          {expanded ? `▲ 折り畳む` : `▼ 残り ${entries.length - 30} 件を表示`}
          {entries.length >= truncatedAt && ` （${truncatedAt}件で打ち切り）`}
        </button>
      )}
    </div>
  );
}

export default function DbDiffWorksPage() {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  async function fetchDiff() {
    setLoading(true);
    setRawError(null);
    setResult(null);

    let res: Response;
    try {
      res = await fetch('/api/admin/db-diff-works');
    } catch (e) {
      setRawError(`ネットワークエラー: ${String(e)}`);
      setLoading(false);
      return;
    }

    let text = '';
    try { text = await res.text(); } catch (e) {
      setRawError(`レスポンス読み取りエラー: ${String(e)}`);
      setLoading(false);
      return;
    }

    if (!text || text.trim() === '') {
      setRawError(`APIが空レスポンスを返しました (HTTP ${res.status})。タイムアウトの可能性があります。`);
      setLoading(false);
      return;
    }

    let data: DiffResult;
    try {
      data = JSON.parse(text) as DiffResult;
    } catch (e) {
      setRawError(`JSON パースエラー: ${String(e)}\n先頭200文字: ${text.slice(0, 200)}`);
      setLoading(false);
      return;
    }

    setResult(data);
    setLoading(false);
  }

  const s = result?.summary;
  const analysis = result?.dbOnlyAnalysis;
  const verdictStyle = analysis ? (VERDICT_STYLE[analysis.verdict] ?? VERDICT_STYLE['unknown']) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">works 差分詳細（読み取り専用）</h1>
      <p className="text-sm text-gray-500 mb-6">
        Redis works:* ↔ DB works の (person_name, id) 差分を調査します。<br />
        DELETE / TRUNCATE / DROP は使いません。既存データは変更されません。
      </p>

      <button
        onClick={fetchDiff}
        disabled={loading}
        className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 mb-6"
      >
        {loading ? '取得中（数秒かかります）...' : '差分を取得'}
      </button>

      {rawError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">取得エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{rawError}</pre>
        </div>
      )}

      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">API エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{result.error}</pre>
        </div>
      )}

      {s && (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            {[
              { label: 'DB 合計',    val: s.dbTotal,       color: 'text-gray-700' },
              { label: 'Redis 合計', val: s.redisTotal,    color: 'text-gray-700' },
              { label: 'DB のみ',    val: s.dbOnlyCount,   color: s.dbOnlyCount   > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: 'Redis のみ', val: s.redisOnlyCount, color: s.redisOnlyCount > 0 ? 'text-amber-600' : 'text-green-600' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white border rounded p-3 text-center">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{val.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* DB のみ */}
          {s.dbOnlyCount > 0 && analysis && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                DB にのみ存在 — {s.dbOnlyCount} 件
                {s.dbOnlyCount > s.truncatedAt && (
                  <span className="text-xs text-gray-400">（表示は {s.truncatedAt} 件まで）</span>
                )}
              </h2>

              {/* 判定カード */}
              <div className={`border rounded p-4 mb-4 ${verdictStyle?.bg}`}>
                <p className={`text-sm font-bold mb-3 ${verdictStyle?.text}`}>
                  判定: {verdictStyle?.label}
                </p>

                <div className="space-y-3 text-xs">
                  <KvTable data={analysis.bySource} label="source 分布" />
                  <KvTable data={analysis.byStatus} label="status 分布" />

                  {analysis.deletedCount > 0 && (
                    <p className="text-red-600">⚠ deleted=true: {analysis.deletedCount} 件</p>
                  )}

                  <div>
                    <p className="text-gray-500 font-medium mb-1">人物別内訳（多い順）</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {analysis.byPerson.slice(0, 20).map((p) => (
                        <span key={p.personName} className="text-xs px-2 py-0.5 rounded bg-white border text-gray-700">
                          {p.personName}: {p.count}
                        </span>
                      ))}
                      {analysis.byPerson.length > 20 && (
                        <span className="text-xs text-gray-400">他 {analysis.byPerson.length - 20} 名</span>
                      )}
                    </div>
                  </div>

                  <div className={`mt-2 p-2 rounded ${verdictStyle?.bg}`}>
                    <p className={`text-xs ${verdictStyle?.text}`}>{analysis.verdictNote}</p>
                  </div>
                </div>
              </div>

              <DbOnlyTable entries={result.dbOnly ?? []} truncatedAt={s.truncatedAt} />
            </section>
          )}

          {s.dbOnlyCount === 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                DB のみ — 0 件（完全一致）
              </h2>
            </section>
          )}

          {/* Redis のみ */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              Redis にのみ存在 — {s.redisOnlyCount} 件
            </h2>
            {s.redisOnlyCount === 0 ? (
              <p className="text-xs text-gray-400">なし</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b text-gray-500">
                      <th className="text-left py-1.5 px-2 font-medium">person_name</th>
                      <th className="text-left py-1.5 px-2 font-medium">work_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.redisOnly ?? []).map((e, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
                        <td className="py-1 px-2 font-mono text-gray-500">{e.workId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
