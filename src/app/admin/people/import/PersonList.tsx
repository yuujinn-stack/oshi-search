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

const FETCHABLE: DataFetchStatus[] = ['not_started', 'partial_error', 'failed'];

type FilterKey = 'all' | 'unpublished' | DataFetchStatus;

interface Props {
  initialPersons: ImportedPerson[];
  initialPublishedNames: string[];
}

export default function PersonList({ initialPersons, initialPublishedNames }: Props) {
  const [persons, setPersons]       = useState<ImportedPerson[]>(initialPersons);
  const [publishedNames, setPublishedNames] = useState<Set<string>>(
    () => new Set(initialPublishedNames)
  );
  const [filter, setFilter]           = useState<FilterKey>('all');
  const [fetchingName, setFetchingName] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] =
    useState<{ current: number; total: number; label: string } | null>(null);
  const [publishingNames, setPublishingNames] = useState<Set<string>>(new Set());

  const isBusy = fetchingName !== null || bulkProgress !== null;

  // ── カウント計算 ────────────────────────────────────────────────────────────
  const counts: Record<FilterKey, number> = {
    all:           persons.length,
    unpublished:   persons.filter((p) => !publishedNames.has(p.name)).length,
    not_started:   persons.filter((p) => p.dataFetchStatus === 'not_started').length,
    processing:    persons.filter((p) => p.dataFetchStatus === 'processing').length,
    completed:     persons.filter((p) => p.dataFetchStatus === 'completed').length,
    partial_error: persons.filter((p) => p.dataFetchStatus === 'partial_error').length,
    failed:        persons.filter((p) => p.dataFetchStatus === 'failed').length,
  };

  const filtered =
    filter === 'all'        ? persons :
    filter === 'unpublished'? persons.filter((p) => !publishedNames.has(p.name)) :
    persons.filter((p) => p.dataFetchStatus === filter);

  // ── データ取得（1人）──────────────────────────────────────────────────────
  async function fetchOne(name: string): Promise<DataFetchStatus> {
    setFetchingName(name);
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
            ? { ...p, dataFetchStatus: status, lastDataFetchedAt: Date.now(), dataFetchErrorMessage: data.error }
            : p
        )
      );
      return status;
    } catch (err) {
      setPersons((prev) =>
        prev.map((p) =>
          p.name === name ? { ...p, dataFetchStatus: 'failed', dataFetchErrorMessage: String(err) } : p
        )
      );
      return 'failed';
    } finally {
      setFetchingName(null);
    }
  }

  // ── 一括データ取得 ────────────────────────────────────────────────────────
  async function handleBulkFetch() {
    const targets = filtered
      .filter((p) => FETCHABLE.includes(p.dataFetchStatus))
      .slice(0, BULK_MAX);
    if (targets.length === 0) return;

    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length, label: 'データ取得中' });
      await fetchOne(targets[i].name);
    }
    setBulkProgress(null);
  }

  // ── 公開反映（1人）────────────────────────────────────────────────────────
  async function publishOne(name: string): Promise<boolean> {
    setPublishingNames((prev) => new Set([...prev, name]));
    try {
      const res = await fetch('/api/admin/people/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ names: [name] }),
      });
      if (res.ok) {
        setPublishedNames((prev) => new Set([...prev, name]));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setPublishingNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  // ── 一括公開反映（API 1回）────────────────────────────────────────────────
  async function handleBulkPublishAll() {
    if (isBusy) return;
    const unpublishedCount = persons.filter((p) => !publishedNames.has(p.name)).length;
    if (unpublishedCount === 0) return;

    setBulkProgress({ current: 0, total: unpublishedCount, label: '公開反映中...' });
    try {
      const res = await fetch('/api/admin/people/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ publishAll: true }),
      });
      const data = await res.json();
      if (res.ok && data.published) {
        const names = data.published as string[];
        setPublishedNames((prev) => new Set([...prev, ...names]));
        setBulkProgress({ current: names.length, total: names.length, label: '公開反映完了' });
        setTimeout(() => setBulkProgress(null), 1500);
      } else {
        setBulkProgress(null);
      }
    } catch {
      setBulkProgress(null);
    }
  }

  const fetchableInView = filtered.filter((p) => FETCHABLE.includes(p.dataFetchStatus)).length;
  const unpublishedTotal = persons.filter((p) => !publishedNames.has(p.name)).length;

  if (persons.length === 0) return null;

  return (
    <div className="mt-8 space-y-4">

      {/* 公開反映パネル */}
      {unpublishedTotal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-amber-800">
              未公開の人物が {unpublishedTotal} 件あります
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              「公開反映」を実行すると公開ページに即時反映されます
            </p>
          </div>
          <button
            onClick={handleBulkPublishAll}
            disabled={isBusy}
            className="px-5 py-2 text-sm font-bold bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {bulkProgress?.label === '公開反映中...'
              ? `反映中… ${bulkProgress.current}/${bulkProgress.total}`
              : `未公開 ${unpublishedTotal}件をまとめて公開反映`}
          </button>
        </div>
      )}

      {/* 人物テーブル */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-slate-700 text-sm">
              インポート済み人物
              <span className="ml-2 text-gray-400 font-normal text-xs">{persons.length}件</span>
            </h2>

            {/* 一括データ取得ボタン */}
            {fetchableInView > 0 && (
              <button
                onClick={handleBulkFetch}
                disabled={isBusy}
                className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {bulkProgress?.label === 'データ取得中'
                  ? `取得中… ${bulkProgress.current}/${bulkProgress.total}`
                  : `未取得 ${Math.min(fetchableInView, BULK_MAX)}件をまとめてデータ取得`}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            ※ persons_master.json に追加された人物は「既公開（JSON）」です
          </p>
        </div>

        {/* フィルタータブ */}
        <div className="flex overflow-x-auto border-b border-gray-100 text-xs">
          {(
            [
              { key: 'all' as FilterKey,           label: 'すべて' },
              { key: 'unpublished' as FilterKey,   label: '未公開' },
              { key: 'not_started' as FilterKey,   label: '未取得' },
              { key: 'completed' as FilterKey,     label: '取得完了' },
              { key: 'partial_error' as FilterKey, label: '一部失敗' },
              { key: 'failed' as FilterKey,        label: '失敗' },
            ] as { key: FilterKey; label: string }[]
          )
            .filter(({ key }) => key === 'all' || key === 'unpublished' || counts[key] > 0)
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
                  <th className="px-4 py-2 font-medium">取得状態</th>
                  <th className="px-4 py-2 font-medium">公開状態</th>
                  <th className="px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((p) => {
                  const isFetching    = fetchingName === p.name;
                  const isPublishing  = publishingNames.has(p.name);
                  const isPublished   = publishedNames.has(p.name);
                  const canFetch      = FETCHABLE.includes(p.dataFetchStatus) && !isBusy;
                  const canPublish    = !isPublished && !isPublishing && !isBusy;

                  return (
                    <tr key={p.name} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-2.5 text-gray-600">{p.group || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{p.genre}</td>

                      {/* 取得状態 */}
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.dataFetchStatus]}`}
                          title={p.dataFetchErrorMessage}
                        >
                          {isFetching ? '取得中…' : STATUS_LABEL[p.dataFetchStatus]}
                        </span>
                        {p.dataFetchErrorMessage && !isFetching && (
                          <p className="text-red-400 text-xs mt-0.5 max-w-[120px] truncate" title={p.dataFetchErrorMessage}>
                            {p.dataFetchErrorMessage}
                          </p>
                        )}
                      </td>

                      {/* 公開状態 */}
                      <td className="px-4 py-2.5">
                        {isPublished ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            公開済み
                          </span>
                        ) : isPublishing ? (
                          <span className="text-amber-500 text-xs">反映中…</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            未公開
                          </span>
                        )}
                      </td>

                      {/* 操作 */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {/* データ取得ボタン */}
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
                              {p.dataFetchStatus === 'completed' ? '再取得' :
                               p.dataFetchStatus === 'not_started' ? 'データ取得' : '再試行'}
                            </button>
                          )}

                          {/* 公開反映ボタン */}
                          {!isPublished && !isPublishing && (
                            <button
                              onClick={() => publishOne(p.name)}
                              disabled={!canPublish}
                              className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                                canPublish
                                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                                  : 'text-gray-300 cursor-default'
                              }`}
                            >
                              公開反映
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
