'use client';

import { useState } from 'react';

interface DryRunResult {
  personMeta: { redisCount: number; dbCount: number; missing: string[] };
  groupMeta:  { redisCount: number; dbCount: number; missing: string[] };
}
interface PatchResult {
  personMeta: { inserted: number; errors: string[] };
  groupMeta:  { inserted: number; errors: string[] };
}

export default function DbPatchMetaPage() {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [patchResult, setPatchResult] = useState<PatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true); setError(null); setDryRun(null); setPatchResult(null);
    try {
      const res = await fetch('/api/admin/db-patch-meta');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDryRun(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const runPatch = async () => {
    if (!confirm('DBに不足データを追加します。よろしいですか？')) return;
    setLoading(true); setError(null); setPatchResult(null);
    try {
      const res = await fetch('/api/admin/db-patch-meta', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPatchResult(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-white mb-2">DB meta 補完ツール</h1>
      <p className="text-slate-400 text-sm mb-6">
        live Redis の <code className="text-slate-300">admin:person-meta</code> ／{' '}
        <code className="text-slate-300">admin:groups</code> を読み、
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
        <div className="space-y-4 mb-4">
          {(['personMeta', 'groupMeta'] as const).map((key) => {
            const d = dryRun[key];
            const label = key === 'personMeta' ? '人物メタ (person_meta)' : 'グループメタ (group_meta)';
            return (
              <div key={key} className="bg-slate-800 rounded-lg p-5">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">{label}</h2>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Redis', value: d.redisCount },
                    { label: 'DB',    value: d.dbCount },
                    { label: '不足件数', value: d.missing.length },
                  ].map(({ label: l, value }) => (
                    <div key={l} className="bg-slate-700 rounded p-3 text-center">
                      <div className="text-xs text-slate-400">{l}</div>
                      <div className={`text-lg font-bold ${l === '不足件数' && value > 0 ? 'text-yellow-400' : 'text-white'}`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                {d.missing.length === 0 ? (
                  <p className="text-green-400 text-sm">差分なし — 一致しています</p>
                ) : (
                  <details open>
                    <summary className="text-slate-400 text-xs cursor-pointer mb-2">
                      不足レコード一覧 ({d.missing.length}件)
                    </summary>
                    <ul className="text-sm text-slate-300 space-y-0.5 pl-2">
                      {d.missing.map((name) => (
                        <li key={name} className="text-yellow-300">{name}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {patchResult && (
        <div className="space-y-4">
          {(['personMeta', 'groupMeta'] as const).map((key) => {
            const r = patchResult[key];
            const label = key === 'personMeta' ? '人物メタ (person_meta)' : 'グループメタ (group_meta)';
            return (
              <div key={key} className="bg-slate-800 rounded-lg p-5">
                <h2 className="text-sm font-semibold text-slate-300 mb-3">{label}</h2>
                <div className="flex gap-4 mb-3">
                  <div className="bg-slate-700 rounded p-3 text-center flex-1">
                    <div className="text-xs text-slate-400">挿入件数</div>
                    <div className="text-lg font-bold text-green-400">{r.inserted}</div>
                  </div>
                  {r.errors.length > 0 && (
                    <div className="bg-red-900/40 rounded p-3 flex-1">
                      <div className="text-xs text-red-400">エラー</div>
                      <div className="text-sm text-red-300 mt-1">{r.errors.join(', ')}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-slate-500 text-xs">
            ✓ 補完完了。<a href="/admin/db-compare" className="text-blue-400 hover:underline">DB検証ページ</a>で確認してください。
          </p>
        </div>
      )}
    </main>
  );
}
