'use client';

import { useState } from 'react';

interface TableCounts {
  counts: Record<string, number | string>;
}

export default function DbInitPage() {
  const [status, setStatus] = useState<TableCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchStatus() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/db-init');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runInit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/db-init', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Unknown error');
      setStatus(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-2">DB スキーマ初期化</h1>
      <p className="text-sm text-gray-500 mb-6">
        Preview / Production の Neon DB にテーブルが存在しない場合に CREATE TABLE IF NOT EXISTS を実行します。
        既存テーブルには影響しません。
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
        >
          現在の状態を確認
        </button>
        <button
          onClick={runInit}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          スキーマを適用 (CREATE TABLE IF NOT EXISTS)
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">処理中...</p>}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {status && (
        <div className="bg-gray-50 border rounded p-4">
          <h2 className="text-sm font-semibold mb-3">テーブル件数</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">テーブル</th>
                <th className="pb-2 text-right">件数</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(status.counts ?? {}).map(([table, count]) => (
                <tr key={table} className="border-b last:border-0">
                  <td className="py-1 font-mono">{table}</td>
                  <td className={`py-1 text-right ${typeof count === 'string' ? 'text-red-500 text-xs' : ''}`}>
                    {count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
