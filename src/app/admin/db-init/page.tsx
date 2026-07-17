'use client';

import { useState } from 'react';

interface InitResult {
  ok?: boolean;
  counts?: Record<string, number | string>;
  columns?: Record<string, string[]>;
  createErrors?: string[];
  alterErrors?: string[];
  error?: string;
}

export default function DbInitPage() {
  const [result, setResult] = useState<InitResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/db-init');
      setResult(await res.json());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function runInit() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/db-init', { method: 'POST' });
      setResult(await res.json());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const allErrors = [...(result?.createErrors ?? []), ...(result?.alterErrors ?? [])];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">DB スキーマ初期化 / カラム補完</h1>
      <p className="text-sm text-gray-500 mb-6">
        <strong>CREATE TABLE IF NOT EXISTS</strong> でテーブルを作成し、<br />
        <strong>ALTER TABLE ADD COLUMN IF NOT EXISTS</strong> で不足カラムを安全に追加します。<br />
        DROP / TRUNCATE / DELETE は一切使いません。既存データは変更されません。
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
        >
          現在の状態を確認（読み取りのみ）
        </button>
        <button
          onClick={runInit}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          スキーマ適用（CREATE + ALTER）
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">処理中...</p>}

      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">
          {result.error}
        </div>
      )}

      {result && !result.error && (
        <div className="space-y-4">
          {/* エラー表示 */}
          {allErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-xs font-semibold text-red-700 mb-1">エラー ({allErrors.length}件)</p>
              {allErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 font-mono">{e}</p>
              ))}
            </div>
          )}

          {/* 成功メッセージ（POST後のみ） */}
          {result.ok !== undefined && allErrors.length === 0 && (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700">
              すべての CREATE TABLE / ALTER TABLE が正常に完了しました。
            </div>
          )}

          {/* テーブル件数 */}
          {result.counts && (
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
                  {Object.entries(result.counts).map(([table, count]) => (
                    <tr key={table} className="border-b last:border-0">
                      <td className="py-1 font-mono text-xs">{table}</td>
                      <td className={`py-1 text-right text-xs ${
                        count === '未作成' ? 'text-amber-600' :
                        typeof count === 'string' ? 'text-red-500' : ''
                      }`}>
                        {count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* カラム一覧（GET のみ） */}
          {result.columns && Object.keys(result.columns).length > 0 && (
            <div className="bg-gray-50 border rounded p-4">
              <h2 className="text-sm font-semibold mb-3">DB 上の実カラム</h2>
              <div className="space-y-3">
                {Object.entries(result.columns).map(([table, cols]) => (
                  <div key={table}>
                    <p className="text-xs font-semibold text-gray-600 mb-1 font-mono">{table}</p>
                    <p className="text-xs text-gray-500 font-mono leading-relaxed">
                      {cols.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
