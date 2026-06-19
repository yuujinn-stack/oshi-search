'use client';

import { useState } from 'react';
import type { ImportedPerson, DataFetchStatus } from '@/lib/imported-persons';

const BULK_MAX = 20;

const STATUS_LABEL: Record<DataFetchStatus, string> = {
  not_started:   '未取得',
  processing:    '取得中',
  completed:     '取得完了',
  partial_error: '一部失敗',
  failed:        '失敗',
};
const STATUS_BADGE: Record<DataFetchStatus, string> = {
  not_started:   'bg-gray-100 text-gray-500',
  processing:    'bg-blue-100 text-blue-600',
  completed:     'bg-green-100 text-green-700',
  partial_error: 'bg-amber-100 text-amber-700',
  failed:        'bg-red-100 text-red-600',
};

// 「取得可能」なステータス（未取得・失敗・一部失敗）
const FETCHABLE: DataFetchStatus[] = ['not_started', 'partial_error', 'failed'];

type FilterKey = 'all' | DataFetchStatus;

interface Props {
  initialPersons: ImportedPerson[];
}

export default function PersonList({ initialPersons }: Props) {
  const [persons, setPersons]       = useState<ImportedPerson[]>(initialPersons);
  const [filter, setFilter]         = useState<FilterKey>('all');
  const [fetchingName, setFetchingName] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] =
    useState<{ current: number; total: number } | null>(null);

  const isBusy = fetchingName !== null || bulkProgress !== null;

  // フィルター別件数
  const counts: Record<FilterKey, number> = {
    all:           persons.length,
    not_started:   persons.filter((p) => p.dataFetchStatus === 'not_started').length,
    processing:    persons.filter((p) => p.dataFetchStatus === 'processing').length,
    completed:     persons.filter((p) => p.dataFetchStatus === 'completed').length,
    partial_error: persons.filter((p) => p.dataFetchStatus === 'partial_error').length,
    failed:        persons.filter((p) => p.dataFetchStatus === 'failed').length,
  };

  const filtered = filter === 'all'
    ? persons
    : persons.filter((p) => p.dataFetchStatus === filter);

  // ── 1人分の取得 ──────────────────────────────────────────────────────────
  async function fetchOne(name: string): Promise<DataFetchStatus> {
    setFetchingName(name);
    // 楽観的 UI: 即 processing に変更
    setPersons((prev) =>
      prev.map((p) => p.name === name ? { ...p, dataFetchStatus: 'processing' } : p)
    );

    try {
      const res = await fetch('/api/admin/people/fetch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const data = await res.json();
      const status = (data.status as DataFetchStatus) ?? 'failed';

      setPersons((prev) =>
        prev.map((p) =>
          p.name === name
            ? {
                ...p,
                dataFetchStatus:       status,
                lastDataFetchedAt:     Date.now(),
                dataFetchErrorMessage: data.error,
              }
            : p
        )
      );
      return status;
    } catch (err) {
      setPersons((prev) =>
        prev.map((p) =>
          p.name === name
            ? { ...p, dataFetchStatus: 'failed', dataFetchErrorMessage: String(err) }
            : p
        )
      );
      return 'failed';
    } finally {
      setFetchingName(null);
    }
  }

  // ── 一括取得（最大 BULK_MAX 件）────────────────────────────────────────────
  async function handleBulkFetch() {
    const targets = filtered
      .filter((p) => FETCHABLE.includes(p.dataFetchStatus))
      .slice(0, BULK_MAX);

    if (targets.length === 0) return;
    setBulkProgress({ current: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length });
      await fetchOne(targets[i].name);
    }

    setBulkProgress(null);
  }

  const fetchableInView = filtered.filter((p) => FETCHABLE.includes(p.dataFetchStatus)).length;

  if (persons.length === 0) return null;

  return (
    <div className="mt-8 bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-bold text-slate-700 text-sm">
            インポート済み人物
            <span className="ml-2 text-gray-400 font-normal text-xs">{persons.length}件</span>
          </h2>

          {/* 一括取得ボタン */}
          {fetchableInView > 0 && (
            <button
              onClick={handleBulkFetch}
              disabled={isBusy}
              className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {bulkProgress
                ? `取得中… ${bulkProgress.current}/${bulkProgress.total}`
                : `未取得 ${Math.min(fetchableInView, BULK_MAX)}件をまとめて取得`}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-1">
          ※ 公開ページへの反映には persons_master.json への追記が別途必要です
        </p>
      </div>

      {/* フィルタータブ */}
      <div className="flex overflow-x-auto border-b border-gray-100 text-xs">
        {(
          [
            { key: 'all' as FilterKey,           label: 'すべて' },
            { key: 'not_started' as FilterKey,   label: '未取得' },
            { key: 'processing' as FilterKey,    label: '取得中' },
            { key: 'completed' as FilterKey,     label: '取得完了' },
            { key: 'partial_error' as FilterKey, label: '一部失敗' },
            { key: 'failed' as FilterKey,        label: '失敗' },
          ] as { key: FilterKey; label: string }[]
        )
          .filter(({ key }) => key === 'all' || counts[key] > 0)
          .map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-2.5 whitespace-nowrap font-medium transition-colors border-b-2 ${
                filter === key
                  ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
              <span className="ml-1 text-gray-400">({counts[key]})</span>
            </button>
          ))}
      </div>

      {/* テーブル */}
      {filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          該当する人物がありません
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-4 py-2 font-medium">名前</th>
                <th className="px-4 py-2 font-medium">グループ</th>
                <th className="px-4 py-2 font-medium">ジャンル</th>
                <th className="px-4 py-2 font-medium">aliases</th>
                <th className="px-4 py-2 font-medium">TMDb ID</th>
                <th className="px-4 py-2 font-medium">取得状態</th>
                <th className="px-4 py-2 font-medium">最終取得</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const isFetching = fetchingName === p.name;
                const canFetch   = FETCHABLE.includes(p.dataFetchStatus) && !isBusy;

                return (
                  <tr key={p.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-2 text-gray-600">{p.group || '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{p.genre}</td>
                    <td className="px-4 py-2 text-gray-500 max-w-[120px] truncate">
                      {p.aliases.length > 0 ? p.aliases.join('、') : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-400">{p.tmdbPersonId ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.dataFetchStatus]}`}
                        title={p.dataFetchErrorMessage}
                      >
                        {isFetching ? '取得中…' : STATUS_LABEL[p.dataFetchStatus]}
                      </span>
                      {p.dataFetchErrorMessage && (
                        <p className="text-red-400 text-xs mt-0.5 truncate max-w-[140px]" title={p.dataFetchErrorMessage}>
                          {p.dataFetchErrorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {p.lastDataFetchedAt
                        ? new Date(p.lastDataFetchedAt).toLocaleString('ja-JP', {
                            month: 'numeric', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {isFetching ? (
                        <span className="text-blue-500 text-xs">取得中…</span>
                      ) : (
                        <button
                          onClick={() => fetchOne(p.name)}
                          disabled={!canFetch}
                          className={`px-2 py-1 rounded text-xs transition-colors ${
                            canFetch
                              ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200'
                              : 'text-gray-300 cursor-default'
                          }`}
                        >
                          {p.dataFetchStatus === 'completed'
                            ? '再取得'
                            : p.dataFetchStatus === 'not_started'
                              ? 'データ取得'
                              : '再試行'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
