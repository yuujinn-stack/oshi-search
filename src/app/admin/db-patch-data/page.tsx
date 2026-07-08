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

type EntityKey = 'works' | 'verdicts';

const ENTITY_CONFIG: Record<EntityKey, { label: string; apiPath: string; description: string }> = {
  works: {
    label: '出演作品 (works:*)',
    apiPath: '/api/admin/db-patch-works',
    description: 'Redis の works:* ハッシュを読み、DB works テーブルに不足行を追加します。',
  },
  verdicts: {
    label: 'AI判定 (verdicts:*)',
    apiPath: '/api/admin/db-patch-verdicts',
    description: 'Redis の verdicts:* ハッシュを読み、DB verdicts テーブルに不足行を追加します。',
  },
};

function EntitySection({ entityKey }: { entityKey: EntityKey }) {
  const config = ENTITY_CONFIG[entityKey];
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [patchResult, setPatchResult] = useState<PatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true); setError(null); setDryRun(null); setPatchResult(null);
    try {
      const res = await fetch(config.apiPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDryRun(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const runPatch = async () => {
    if (!confirm(`${config.label} の不足データを DB に追加します。よろしいですか？`)) return;
    setLoading(true); setError(null); setPatchResult(null);
    try {
      const res = await fetch(config.apiPath, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPatchResult(await res.json());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold text-white mb-1">{config.label}</h2>
      <p className="text-slate-400 text-xs mb-4">{config.description}</p>

      <div className="flex gap-3 mb-4">
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
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-xs mb-3">
          エラー: {error}
        </div>
      )}

      {dryRun && (
        <div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[
              { label: 'Redis persons', value: dryRun.totalRedisPersons },
              { label: 'DB persons', value: dryRun.totalDBPersons },
              { label: '不足行数', value: dryRun.totalMissingRows },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700 rounded p-3 text-center">
                <div className="text-xs text-slate-400">{label}</div>
                <div className={`text-lg font-bold ${value === 0 ? 'text-green-400' : 'text-yellow-400'}`}>{value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          {dryRun.diffs.length === 0 ? (
            <p className="text-green-400 text-sm">差分なし — 全人物が一致しています</p>
          ) : (
            <details className="mt-2">
              <summary className="text-slate-400 text-xs cursor-pointer hover:text-slate-300 mb-2">
                差分のある人物 {dryRun.diffs.length}件 を表示
              </summary>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-600 sticky top-0 bg-slate-800">
                      <th className="text-left py-1.5">人物名</th>
                      <th className="text-right py-1.5">Redis</th>
                      <th className="text-right py-1.5">DB</th>
                      <th className="text-right py-1.5">差分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRun.diffs.map((d) => (
                      <tr key={d.personName} className="border-b border-slate-700/50">
                        <td className="py-1 text-slate-200">{d.personName}</td>
                        <td className="py-1 text-right tabular-nums">{d.redis.toLocaleString()}</td>
                        <td className="py-1 text-right tabular-nums">{d.db.toLocaleString()}</td>
                        <td className={`py-1 text-right tabular-nums font-mono ${d.redis - d.db > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {d.redis - d.db > 0 ? '+' : ''}{(d.redis - d.db).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      {patchResult && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              { label: '処理人数', value: patchResult.processed },
              { label: '挿入件数', value: patchResult.totalInserted },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700 rounded p-3 text-center">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-bold text-green-400">{value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          {patchResult.insertLog.filter((r) => r.inserted > 0).length > 0 && (
            <details className="mt-2">
              <summary className="text-slate-400 text-xs cursor-pointer hover:text-slate-300 mb-2">
                挿入ログ {patchResult.insertLog.filter((r) => r.inserted > 0).length}件 を表示
              </summary>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-600">
                      <th className="text-left py-1">人物名</th>
                      <th className="text-right py-1">挿入行数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patchResult.insertLog.filter((r) => r.inserted > 0).map((r) => (
                      <tr key={r.personName} className="border-b border-slate-700/50">
                        <td className="py-1 text-slate-200">{r.personName}</td>
                        <td className="py-1 text-right tabular-nums text-green-400">+{r.inserted.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <p className="text-slate-500 text-xs mt-3">
            ✓ 補完完了。<a href="/admin/db-compare" className="text-blue-400 hover:underline">DB検証ページ</a>で確認してください。
          </p>
        </div>
      )}
    </div>
  );
}

export default function DbPatchDataPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-white mb-2">DB works / verdicts 補完ツール</h1>
      <p className="text-slate-400 text-sm mb-2">
        live Redis の各エンティティを読み、Neon DB に不足している行を追加します（既存行は変更しません）。
      </p>
      <p className="text-slate-500 text-xs mb-6">
        ※ products の補完は{' '}
        <a href="/admin/db-patch-products" className="text-blue-400 hover:underline">DB products 補完ツール</a>
        {' '}を使用してください。
      </p>

      <EntitySection entityKey="works" />
      <EntitySection entityKey="verdicts" />
    </main>
  );
}
