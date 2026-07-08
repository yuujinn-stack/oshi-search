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

interface DiffResult {
  summary: {
    dbTotal: number;
    redisTotal: number;
    dbOnlyCount: number;
    redisOnlyCount: number;
    bothDiffCount: number;
  };
  dbOnly: DiffEntry[];
  redisOnly: DiffEntry[];
  bothDiff: DiffEntry[];
  error?: string;
}

function EntryTable({ entries, type }: { entries: DiffEntry[]; type: 'db-only' | 'redis-only' | 'both' }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500">
            <th className="text-left py-1.5 px-2 font-medium">person_name</th>
            <th className="text-left py-1.5 px-2 font-medium">category（product_id）</th>
            {(type === 'db-only' || type === 'both') && (
              <th className="text-right py-1.5 px-2 font-medium">DB件数</th>
            )}
            {(type === 'redis-only' || type === 'both') && (
              <th className="text-right py-1.5 px-2 font-medium">Redis件数</th>
            )}
            {type === 'db-only' && (
              <th className="text-left py-1.5 px-2 font-medium">fetched_at</th>
            )}
            <th className="text-left py-1.5 px-2 font-medium">サンプル商品名</th>
            <th className="text-left py-1.5 px-2 font-medium">ショップ</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
              <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
              {(type === 'db-only' || type === 'both') && (
                <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>
              )}
              {(type === 'redis-only' || type === 'both') && (
                <td className="py-1 px-2 text-right">{e.redisItemCount ?? '-'}</td>
              )}
              {type === 'db-only' && (
                <td className="py-1 px-2 text-gray-400 whitespace-nowrap">
                  {e.fetchedAt ? new Date(e.fetchedAt).toLocaleString('ja-JP') : '-'}
                </td>
              )}
              <td className="py-1 px-2 text-gray-600 max-w-xs truncate">
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

  async function fetchDiff() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/db-diff-products');
      setResult(await res.json());
    } catch (e) {
      setResult({ error: String(e) } as DiffResult);
    } finally {
      setLoading(false);
    }
  }

  const s = result?.summary;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">products 差分詳細（読み取り専用）</h1>
      <p className="text-sm text-gray-500 mb-6">
        Redis ↔ DB の (person_name, category) の差分を調査します。<br />
        DELETE / TRUNCATE / DROP は一切使いません。既存データは変更されません。
      </p>

      <button
        onClick={fetchDiff}
        disabled={loading}
        className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 mb-6"
      >
        {loading ? '取得中...' : '差分を取得'}
      </button>

      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">
          {result.error}
        </div>
      )}

      {s && (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
            {[
              { label: 'DB 合計',       val: s.dbTotal,        color: 'text-gray-700' },
              { label: 'Redis 合計',    val: s.redisTotal,     color: 'text-gray-700' },
              { label: 'DBのみ',        val: s.dbOnlyCount,    color: s.dbOnlyCount    > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: 'Redisのみ',     val: s.redisOnlyCount, color: s.redisOnlyCount > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: '件数不一致',    val: s.bothDiffCount,  color: s.bothDiffCount  > 0 ? 'text-amber-600' : 'text-green-600' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white border rounded p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* DB のみ（本来の差分） */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              DB にのみ存在（Redis に対応なし）— {s.dbOnlyCount}件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: 過去のテスト実行・dual-write で書いたが Redis から削除された・旧システムからの移行データ
            </p>
            <EntryTable entries={result.dbOnly} type="db-only" />
          </section>

          {/* Redis のみ */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              Redis にのみ存在（DB に対応なし）— {s.redisOnlyCount}件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: dual-write 導入前の古い Redis データ・DB 書き込みが失敗した
            </p>
            <EntryTable entries={result.redisOnly} type="redis-only" />
          </section>

          {/* 両方にあるが件数不一致 */}
          {result.bothDiff.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                両方に存在するが items 件数が異なる — {s.bothDiffCount}件
              </h2>
              <EntryTable entries={result.bothDiff} type="both" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
