'use client';

import { useState, useMemo, useCallback } from 'react';
import { canExecuteWorkRecovery } from '@/lib/recovery-guard';
import type { WorkRecoveryItem } from '@/app/api/admin/work-recovery/route';

interface Props {
  initialWorks:       WorkRecoveryItem[];
  initialTotal:       number;
  recoveryEnabled:    boolean;
  recoveryBlockReason: string | null;
}

export default function WorkRecoveryClient({
  initialWorks, initialTotal, recoveryEnabled, recoveryBlockReason,
}: Props) {
  const [works, setWorks]       = useState<WorkRecoveryItem[]>(initialWorks);
  const [total, setTotal]       = useState(initialTotal);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [loading, setLoading]   = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>([].reduce((s) => s, new Set<string>()));

  const [dryRunResult, setDryRunResult] = useState<WorkRecoveryItem[] | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const [confirmInput, setConfirmInput] = useState('');
  const [reason, setReason]       = useState('');
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ recovered: number; skipped: number } | null>(null);
  const [error, setError]         = useState('');

  const PAGE_SIZE = 100;

  const uniquePersons = useMemo(
    () => [...new Set(works.map((w) => w.personName))].sort(),
    [works],
  );

  const filteredWorks = useMemo(() => {
    let result = works;
    if (personFilter) result = result.filter((w) => w.personName === personFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          w.title.toLowerCase().includes(q) ||
          w.personName.toLowerCase().includes(q) ||
          w.workId.toLowerCase().includes(q),
      );
    }
    return result;
  }, [works, personFilter, search]);

  const fetchWorks = useCallback(async (p: number, s: string, pf: string) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(p),
      pageSize: String(PAGE_SIZE),
      ...(s ? { search: s } : {}),
      ...(pf ? { personName: pf } : {}),
    });
    const res = await fetch(`/api/admin/work-recovery?${params}`);
    if (res.ok) {
      const data = (await res.json()) as { works: WorkRecoveryItem[]; total: number };
      setWorks(data.works);
      setTotal(data.total);
      setSelectedIds(new Set());
      setDryRunResult(null);
    }
    setLoading(false);
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDryRunResult(null);
  }

  const selectedWorks = filteredWorks.filter((w) => selectedIds.has(makeKey(w)));
  const selectedWorkIds = selectedWorks.map((w) => w.workId);

  async function handleDryRun() {
    if (selectedWorks.length === 0) return;
    setDryRunLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/work-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: true,
          personName: selectedWorks[0].personName,
          workIds: selectedWorkIds,
        }),
      });
      const data = (await res.json()) as { preview?: WorkRecoveryItem[]; error?: string };
      if (res.ok && data.preview) {
        setDryRunResult(data.preview);
      } else {
        setError(data.error ?? 'dry-run 失敗');
      }
    } catch (e) {
      setError(String(e));
    }
    setDryRunLoading(false);
  }

  async function handleExecute() {
    if (!canExecuteWorkRecovery({ confirmInput, reason, selectedCount: selectedWorks.length, recoveryEnabled })) return;
    setExecuting(true);
    setError('');
    const idempotencyKey = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await fetch('/api/admin/work-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: false,
          personName: selectedWorks[0].personName,
          workIds: selectedWorkIds,
          targetStatus: 'auto_published',
          reason: reason.trim(),
          idempotencyKey,
          confirmToken: 'RECOVER',
        }),
      });
      const data = (await res.json()) as { recovered?: number; skipped?: number; error?: string };
      if (res.ok) {
        setExecuteResult({ recovered: data.recovered ?? 0, skipped: data.skipped ?? 0 });
        setSelectedIds(new Set());
        setDryRunResult(null);
        setConfirmInput('');
        setReason('');
        await fetchWorks(page, search, personFilter);
      } else {
        setError(data.error ?? '実行失敗');
      }
    } catch (e) {
      setError(String(e));
    }
    setExecuting(false);
  }

  // 複数人物が選択されていないかチェック（同一 personName のみ実行可）
  const selectedPersons = [...new Set(selectedWorks.map((w) => w.personName))];
  const multiPersonWarning = selectedPersons.length > 1;

  return (
    <div className="space-y-6">
      {/* ── 実行不可バナー ── */}
      {!recoveryEnabled && recoveryBlockReason && (
        <div className="px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
          ⚠️ {recoveryBlockReason}
          {recoveryBlockReason.includes('Preview') && (
            <span className="ml-1 font-semibold">Dry-run は利用可能です。</span>
          )}
        </div>
      )}

      {/* ── 検索・フィルター ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void fetchWorks(1, search, personFilter); }}
          placeholder="タイトル・人物名・workId で検索"
          className="flex-1 min-w-52 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none"
        >
          <option value="">全人物</option>
          {uniquePersons.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={() => void fetchWorks(1, search, personFilter)}
          disabled={loading}
          className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? '読み込み中...' : '検索'}
        </button>
      </div>

      <p className="text-xs text-gray-500">
        hidden 状態の manual_csv 作品: <span className="font-bold text-orange-600">{total} 件</span>
        {filteredWorks.length !== works.length && (
          <> / フィルター後: <span className="font-bold">{filteredWorks.length} 件</span></>
        )}
        {selectedWorks.length > 0 && (
          <> / 選択中: <span className="font-bold text-indigo-600">{selectedWorks.length} 件</span></>
        )}
      </p>

      {/* ── 作品リスト ── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">人物名</th>
                <th className="px-3 py-2">タイトル</th>
                <th className="px-3 py-2">type</th>
                <th className="px-3 py-2">source</th>
                <th className="px-3 py-2">checked_at</th>
                <th className="px-3 py-2">updated_at</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                    {loading ? '読み込み中...' : 'hidden のCSV登録作品がありません'}
                  </td>
                </tr>
              ) : (
                filteredWorks.map((w) => {
                  const key = makeKey(w);
                  const isSelected = selectedIds.has(key);
                  return (
                    <tr
                      key={key}
                      onClick={() => toggleSelect(key)}
                      className={`border-t border-gray-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(key)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 accent-indigo-600"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{w.personName}</td>
                      <td className="px-3 py-2 max-w-[240px] truncate" title={w.title}>{w.title}</td>
                      <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap">{w.type}</td>
                      <td className="px-3 py-2 font-mono text-orange-700 whitespace-nowrap">{w.source}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{w.checkedAt ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{w.updatedAt}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ページネーション ── */}
      {total > PAGE_SIZE && (
        <div className="flex gap-2 justify-center text-xs">
          {Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => { setPage(p); void fetchWorks(p, search, personFilter); }}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                page === p
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── dry-run ── */}
      {selectedWorks.length > 0 && (
        <div className="border border-indigo-200 rounded-xl p-4 space-y-4 bg-indigo-50/40">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-indigo-700">
              {selectedWorks.length} 件を選択中
            </p>
            {multiPersonWarning && (
              <p className="text-xs text-red-600 font-medium">
                ⚠️ 複数人物が選択されています。同一人物の作品のみ一度に実行できます。
              </p>
            )}
            <button
              onClick={() => void handleDryRun()}
              disabled={dryRunLoading || multiPersonWarning}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {dryRunLoading ? 'dry-run 実行中...' : 'dry-run（プレビュー）'}
            </button>
          </div>

          {/* dry-run 結果 */}
          {dryRunResult !== null && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-indigo-600">
                dry-run 結果: {dryRunResult.length} 件が復旧対象
              </p>
              <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                {dryRunResult.map((w) => (
                  <li key={makeKey(w)} className="text-indigo-700">
                    {w.personName} / {w.title} ({w.type}) hidden → auto_published
                  </li>
                ))}
              </ul>

              {dryRunResult.length > 0 && (
                <div className="border-t border-indigo-200 pt-3 space-y-3">
                  <p className="text-xs font-semibold text-gray-700">実行確認</p>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">復旧理由 (必須)</label>
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="例: 2026-07-18 手動復旧 batch"
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        確認コード入力: <span className="font-mono font-bold text-orange-600">RECOVER</span> と入力してください
                      </label>
                      <input
                        type="text"
                        value={confirmInput}
                        onChange={(e) => setConfirmInput(e.target.value)}
                        placeholder="RECOVER"
                        className={`w-48 text-sm px-3 py-1.5 border rounded-lg focus:outline-none focus:ring-2 ${
                          confirmInput === 'RECOVER'
                            ? 'border-green-400 focus:ring-green-200'
                            : 'border-gray-200 focus:ring-indigo-200'
                        }`}
                      />
                    </div>
                    <button
                      onClick={() => void handleExecute()}
                      disabled={
                        executing ||
                        multiPersonWarning ||
                        !canExecuteWorkRecovery({ confirmInput, reason, selectedCount: selectedWorks.length, recoveryEnabled })
                      }
                      className="self-start px-5 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-40 transition-colors"
                    >
                      {executing ? '実行中...' : `${dryRunResult.length} 件を復旧実行`}
                    </button>
                    {!recoveryEnabled && recoveryBlockReason && (
                      <p className="text-xs text-yellow-600">⚠️ {recoveryBlockReason}</p>
                    )}
                    <p className="text-xs text-red-500">
                      ⚠️ この操作は取り消せません。必ず dry-run 結果を確認してから実行してください。
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── エラー・結果 ── */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}
      {executeResult && (
        <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          復旧完了: <strong>{executeResult.recovered} 件</strong> を auto_published に変更しました。
          {executeResult.skipped > 0 && ` (${executeResult.skipped} 件スキップ)`}
        </div>
      )}
    </div>
  );
}

function makeKey(w: WorkRecoveryItem): string {
  return `${w.personName}::${w.workId}`;
}
