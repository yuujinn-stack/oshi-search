'use client';

import { useState } from 'react';

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItemName: string | null;
  sampleShopName: string | null;
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
  dbOnly?: DiffEntry[];
  redisOnly?: DiffEntry[];
  bothDiff?: DiffEntry[];
  error?: string;
}

function EntryTable({ entries, type }: { entries: DiffEntry[]; type: 'db-only' | 'redis-only' | 'both' }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;

  const showDb    = type === 'db-only'    || type === 'both';
  const showRedis = type === 'redis-only' || type === 'both';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500">
            <th className="text-left py-1.5 px-2 font-medium">person_name</th>
            <th className="text-left py-1.5 px-2 font-medium">category</th>
            {showDb    && <th className="text-right py-1.5 px-2 font-medium">DB件数</th>}
            {showRedis && <th className="text-right py-1.5 px-2 font-medium">Redis件数</th>}
            {type === 'db-only' && <th className="text-left py-1.5 px-2 font-medium">fetched_at</th>}
            <th className="text-left py-1.5 px-2 font-medium">商品サンプル</th>
            <th className="text-left py-1.5 px-2 font-medium">ショップ</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
              <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
              {showDb    && <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>}
              {showRedis && <td className="py-1 px-2 text-right">{e.redisItemCount ?? '-'}</td>}
              {type === 'db-only' && (
                <td className="py-1 px-2 text-gray-400 whitespace-nowrap">
                  {e.fetchedAt ? new Date(e.fetchedAt).toLocaleString('ja-JP') : '-'}
                </td>
              )}
              <td className="py-1 px-2 text-gray-600 max-w-xs truncate" title={e.sampleItemName ?? ''}>
                {e.sampleItemName ?? <span className="text-gray-300">-</span>}
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

    // レスポンスのテキストを先に取得し、JSON パースを安全に行う
    let text = '';
    try {
      text = await res.text();
    } catch (readErr) {
      setRawError(`レスポンス読み取りエラー: ${String(readErr)}`);
      setLoading(false);
      return;
    }

    if (!text || text.trim() === '') {
      setRawError(`APIが空レスポンスを返しました (HTTP ${res.status})。タイムアウトの可能性があります。Vercel ログを確認してください。`);
      setLoading(false);
      return;
    }

    let data: DiffResult;
    try {
      data = JSON.parse(text) as DiffResult;
    } catch (parseErr) {
      setRawError(`JSON パースエラー: ${String(parseErr)}\nレスポンス先頭200文字: ${text.slice(0, 200)}`);
      setLoading(false);
      return;
    }

    setResult(data);
    setLoading(false);
  }

  const s = result?.summary;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">products 差分詳細（読み取り専用）</h1>
      <p className="text-sm text-gray-500 mb-6">
        Redis ↔ DB の (person_name, category) の差分を調査します。<br />
        DELETE / TRUNCATE / DROP は一切使いません。既存データは変更されません。<br />
        各セクション最大 100 件まで表示します（全件数はサマリーで確認）。
      </p>

      <button
        onClick={fetchDiff}
        disabled={loading}
        className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 mb-6"
      >
        {loading ? '取得中（数秒かかります）...' : '差分を取得'}
      </button>

      {/* ネットワーク・パースエラー */}
      {rawError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">取得エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{rawError}</pre>
        </div>
      )}

      {/* API から返ったエラー（JSON で受け取れた場合） */}
      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">API エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{result.error}</pre>
        </div>
      )}

      {s && (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            {[
              { label: 'DB 合計',          val: s.dbTotal,              color: 'text-gray-700' },
              { label: 'Redis 合計',        val: s.redisTotal,           color: 'text-gray-700' },
              { label: 'DB のみ',           val: s.dbOnlyCount,          color: s.dbOnlyCount    > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: 'Redis のみ',        val: s.redisOnlyCount,       color: s.redisOnlyCount > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: '件数不一致',         val: s.bothDiffCount,        color: s.bothDiffCount  > 0 ? 'text-orange-600' : 'text-green-600' },
              { label: 'Redis 不正JSON',    val: s.malformedRedisCount,  color: s.malformedRedisCount > 0 ? 'text-red-500' : 'text-gray-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white border rounded p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {s.truncatedAt < Math.max(s.dbOnlyCount, s.redisOnlyCount, s.bothDiffCount) && (
            <p className="text-xs text-amber-600 mb-4">
              ※ 表示は各セクション {s.truncatedAt} 件に制限しています。全件数はサマリーを参照してください。
            </p>
          )}

          {/* DB のみ */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              DB にのみ存在（Redis に対応なし）— {s.dbOnlyCount} 件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: 過去のテスト実行 / dual-write で書いたが Redis から削除された / 旧データ移行の残存
            </p>
            <EntryTable entries={result.dbOnly ?? []} type="db-only" />
          </section>

          {/* Redis のみ */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              Redis にのみ存在（DB に対応なし）— {s.redisOnlyCount} 件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: dual-write 導入前の古い Redis データ / DB 書き込みが失敗した
            </p>
            <EntryTable entries={result.redisOnly ?? []} type="redis-only" />
          </section>

          {/* 件数不一致 */}
          {s.bothDiffCount > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                両方に存在するが items 件数が異なる — {s.bothDiffCount} 件
              </h2>
              <EntryTable entries={result.bothDiff ?? []} type="both" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
