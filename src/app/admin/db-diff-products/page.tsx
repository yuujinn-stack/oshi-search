'use client';

import { useState } from 'react';

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItems: string[];
  sampleShopName: string | null;
}

interface DbOnlyAnalysis {
  schemaNote: string;
  distinctPersons: string[];
  fetchedAtMin: string | null;
  fetchedAtMax: string | null;
  totalDbItemCount: number;
  originHint: string;
  verdict: 'real-data' | 'likely-real' | 'unknown' | 'test-data';
}

interface DiffSummary {
  dbTotal: number;
  redisTotal: number;
  dbOnlyCount: number;
  redisOnlyCount: number;
  bothDiffCount: number;
  malformedRedisCount: number;
  truncatedAt: number;
}

interface DiffResult {
  summary?: DiffSummary;
  dbOnlyAnalysis?: DbOnlyAnalysis;
  dbOnly?: DiffEntry[];
  redisOnly?: DiffEntry[];
  bothDiff?: DiffEntry[];
  error?: string;
}

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  'real-data':    { bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  label: '✓ 正当なデータ — 削除不要' },
  'likely-real':  { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-800',   label: '○ 正当データの可能性大 — 削除不要' },
  'unknown':      { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-800',  label: '? 判定不能 — 手動確認が必要' },
  'test-data':    { bg: 'bg-red-50 border-red-200',      text: 'text-red-800',    label: '✗ テスト/不要データの可能性あり — 削除候補' },
};

function fmtDate(v: string | null): string {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('ja-JP'); } catch { return v; }
}

function DbOnlyTable({ entries }: { entries: DiffEntry[] }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500">
            <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">person_name</th>
            <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">category</th>
            <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">DB件数</th>
            <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">fetched_at</th>
            <th className="text-left py-1.5 px-2 font-medium">商品名サンプル（先頭3件）</th>
            <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">ショップ</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
              <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
              <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>
              <td className="py-1 px-2 text-gray-400 whitespace-nowrap">{fmtDate(e.fetchedAt)}</td>
              <td className="py-1 px-2 text-gray-700">
                {e.sampleItems.length > 0
                  ? e.sampleItems.map((name, j) => (
                      <div key={j} className="truncate max-w-xs" title={name}>
                        {j + 1}. {name}
                      </div>
                    ))
                  : <span className="text-gray-300">商品なし</span>
                }
              </td>
              <td className="py-1 px-2 text-gray-500 whitespace-nowrap">
                {e.sampleShopName ?? <span className="text-gray-300">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ entries, type }: { entries: DiffEntry[]; type: 'redis-only' | 'both' }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;
  const showDb    = type === 'both';
  const showRedis = true;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500">
            <th className="text-left py-1.5 px-2 font-medium">person_name</th>
            <th className="text-left py-1.5 px-2 font-medium">category</th>
            {showDb    && <th className="text-right py-1.5 px-2 font-medium">DB件数</th>}
            {showRedis && <th className="text-right py-1.5 px-2 font-medium">Redis件数</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
              <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
              {showDb    && <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>}
              {showRedis && <td className="py-1 px-2 text-right">{e.redisItemCount ?? '-'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DbDiffProductsPage() {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  async function fetchDiff() {
    setLoading(true);
    setRawError(null);
    setResult(null);

    let res: Response;
    try {
      res = await fetch('/api/admin/db-diff-products');
    } catch (networkErr) {
      setRawError(`ネットワークエラー: ${String(networkErr)}`);
      setLoading(false);
      return;
    }

    let text = '';
    try { text = await res.text(); } catch (readErr) {
      setRawError(`レスポンス読み取りエラー: ${String(readErr)}`);
      setLoading(false);
      return;
    }

    if (!text || text.trim() === '') {
      setRawError(
        `APIが空レスポンスを返しました (HTTP ${res.status})。` +
        `タイムアウトの可能性があります。Vercel ログを確認してください。`,
      );
      setLoading(false);
      return;
    }

    let data: DiffResult;
    try {
      data = JSON.parse(text) as DiffResult;
    } catch (parseErr) {
      setRawError(
        `JSON パースエラー: ${String(parseErr)}\n` +
        `レスポンス先頭200文字: ${text.slice(0, 200)}`,
      );
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
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">products 差分詳細（読み取り専用）</h1>
      <p className="text-sm text-gray-500 mb-6">
        Redis ↔ DB の (person_name, category) の差分を調査します。<br />
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
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
            {[
              { label: 'DB 合計',       val: s.dbTotal,             color: 'text-gray-700' },
              { label: 'Redis 合計',    val: s.redisTotal,          color: 'text-gray-700' },
              { label: 'DB のみ',       val: s.dbOnlyCount,         color: s.dbOnlyCount    > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: 'Redis のみ',    val: s.redisOnlyCount,      color: s.redisOnlyCount > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: '件数不一致',    val: s.bothDiffCount,       color: s.bothDiffCount  > 0 ? 'text-orange-600' : 'text-green-600' },
              { label: 'Redis不正JSON', val: s.malformedRedisCount, color: s.malformedRedisCount > 0 ? 'text-red-500' : 'text-gray-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white border rounded p-2 text-center">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* DB のみ — 起源分析 */}
          {analysis && s.dbOnlyCount > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                DB にのみ存在（Redis に対応なし）— {s.dbOnlyCount} 件
                {s.dbOnlyCount > s.truncatedAt && (
                  <span className="text-xs text-gray-400">（表示は {s.truncatedAt} 件まで）</span>
                )}
              </h2>

              {/* 起源判定カード */}
              <div className={`border rounded p-4 mb-4 ${verdictStyle?.bg}`}>
                <p className={`text-sm font-bold mb-2 ${verdictStyle?.text}`}>
                  判定: {verdictStyle?.label}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-xs">
                  <div>
                    <p className="text-gray-500 mb-0.5">関係する人物数</p>
                    <p className="font-bold">{analysis.distinctPersons.length} 名</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">fetched_at 最古</p>
                    <p className="font-mono">{fmtDate(analysis.fetchedAtMin)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">fetched_at 最新</p>
                    <p className="font-mono">{fmtDate(analysis.fetchedAtMax)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">合計商品件数</p>
                    <p className="font-bold">{analysis.totalDbItemCount.toLocaleString()} 件</p>
                  </div>
                </div>

                <div className="text-xs mb-2">
                  <p className="text-gray-500 font-medium mb-0.5">起源の推定:</p>
                  <p className={verdictStyle?.text}>{analysis.originHint}</p>
                </div>

                <div className="text-xs">
                  <p className="text-gray-500 font-medium mb-0.5">関係する人物:</p>
                  <p className="text-gray-600">{analysis.distinctPersons.join(', ')}</p>
                </div>

                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">スキーマ補足</summary>
                  <p className="text-xs text-gray-500 mt-1">{analysis.schemaNote}</p>
                </details>
              </div>

              <DbOnlyTable entries={result.dbOnly ?? []} />
            </section>
          )}

          {s.dbOnlyCount === 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                DB のみ — 0 件
              </h2>
            </section>
          )}

          {/* Redis のみ */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              Redis にのみ存在（DB に対応なし）— {s.redisOnlyCount} 件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: dual-write 導入前の古い Redis データ / DB 書き込みが失敗した
            </p>
            <SimpleTable entries={result.redisOnly ?? []} type="redis-only" />
          </section>

          {/* 件数不一致 */}
          {s.bothDiffCount > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                両方に存在するが items 件数が異なる — {s.bothDiffCount} 件
              </h2>
              <SimpleTable entries={result.bothDiff ?? []} type="both" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
