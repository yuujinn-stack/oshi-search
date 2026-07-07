'use client';

import { useState } from 'react';

interface DiffItem { personName: string; redis: number; db: number }
interface DryRunResult {
  totalRedisPersons: number;
  totalDBPersons: number;
  diffs: DiffItem[];
  totalMissingRows: number;
}
interface PatchResult {
  processed: number;
  totalInserted: number;
  insertLog: { personName: string; inserted: number }[];
}

export default function DbPatchProductsPage() {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [patchResult, setPatchResult] = useState<PatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true); setError(null); setDryRun(null); setPatchResult(null);
    try {
      const res = await fetch('/api/admin/db-patch-products');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDryRun(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const runPatch = async () => {
    if (!confirm('DBに不足データを追加します。よろしいですか？')) return;
    setLoading(true); setError(null); setPatchResult(null);
    try {
      const res = await fetch('/api/admin/db-patch-products', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPatchResult(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-white mb-2">DB products 補完ツール</h1>
      <p className="text-slate-400 text-sm mb-6">
        live Redis の <code className="text-slate-300">products:*</code> を読み、
        Neon DB に不足している行を追加します（既存行は変更しません）。
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={runDryRun}
          disabled={loading}
          className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? '確認中...' : '① 差分確認（ドライラン）'}
        </button>
        <button
          onClick={runPatch}
          disabled={loading || (!dryRun && !patchResult)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? '実行中...' : '② 不足データを補完（POST）'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm mb-4">
          エラー: {error}
        </div>
      )}

      {dryRun && (
        <div className="bg-slate-800 rounded-lg p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">ドライラン結果</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Redis persons', value: dryRun.totalRedisPersons },
              { label: 'DB persons', value: dryRun.totalDBPersons },
              { label: '不足行数', value: dryRun.totalMissingRows },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700 rounded p-3 text-center">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-bold text-white">{value}</div>
              </div>
            ))}
          </div>
          {dryRun.diffs.length === 0 ? (
            <p className="text-green-400 text-sm">差分なし — 全人物が一致しています</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-600">
                  <th className="text-left py-1.5">人物名</th>
                  <th className="text-right py-1.5">Redis</th>
                  <th className="text-right py-1.5">DB</th>
                  <th className="text-right py-1.5">差分</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.diffs.map((d) => (
                  <tr key={d.personName} className="border-b border-slate-700/50">
                    <td className="py-1.5 text-slate-200">{d.personName}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.redis}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.db}</td>
                    <td className="py-1.5 text-right tabular-nums text-yellow-400 font-mono">
                      {d.redis - d.db > 0 ? '+' : ''}{d.redis - d.db}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {patchResult && (
        <div className="bg-slate-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">補完結果</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: '処理人数', value: patchResult.processed },
              { label: '挿入件数', value: patchResult.totalInserted },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700 rounded p-3 text-center">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-bold text-green-400">{value}</div>
              </div>
            ))}
          </div>
          {patchResult.insertLog.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-600">
                  <th className="text-left py-1.5">人物名</th>
                  <th className="text-right py-1.5">挿入行数</th>
                </tr>
              </thead>
              <tbody>
                {patchResult.insertLog.map((r) => (
                  <tr key={r.personName} className="border-b border-slate-700/50">
                    <td className="py-1.5 text-slate-200">{r.personName}</td>
                    <td className="py-1.5 text-right tabular-nums text-green-400">+{r.inserted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-slate-500 text-xs mt-4">
            ✓ 補完完了。<a href="/admin/db-compare" className="text-blue-400 hover:underline">DB検証ページ</a>で確認してください。
          </p>
        </div>
      )}
    </main>
  );
}
