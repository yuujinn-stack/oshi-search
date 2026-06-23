'use client';

import { useMemo, useState } from 'react';
import type { PersonWithCounts } from './work-check-types';

const MAX_DISPLAY = 20;

type QuickFilter = 'noVod' | 'review' | 'noTmdbId' | 'manualCsv';

const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  noVod: '配信なしあり',
  review: '確認待ちあり',
  noTmdbId: 'tmdbIdなしあり',
  manualCsv: 'CSV手動あり',
};

interface Props {
  persons: PersonWithCounts[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}

export default function SearchablePersonSelect({
  persons,
  value,
  onChange,
  placeholder = '人物名・グループ名で検索...',
}: Props) {
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilter>>(new Set());

  const selectedPerson = persons.find((p) => p.name === value);

  function toggleFilter(f: QuickFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  // 優先度ソート済み全リスト（配信なし → 確認待ち → tmdbなし → 作品数）
  const allSorted = useMemo(
    () =>
      [...persons].sort((a, b) => {
        if (b.counts.noVod !== a.counts.noVod) return b.counts.noVod - a.counts.noVod;
        if (b.counts.review !== a.counts.review) return b.counts.review - a.counts.review;
        if (b.counts.noTmdbId !== a.counts.noTmdbId) return b.counts.noTmdbId - a.counts.noTmdbId;
        return b.counts.total - a.counts.total;
      }),
    [persons],
  );

  const filtered = useMemo(() => {
    let list = allSorted;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          (p.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
      );
    }

    if (activeFilters.has('noVod')) list = list.filter((p) => p.counts.noVod > 0);
    if (activeFilters.has('review')) list = list.filter((p) => p.counts.review > 0);
    if (activeFilters.has('noTmdbId')) list = list.filter((p) => p.counts.noTmdbId > 0);
    if (activeFilters.has('manualCsv')) list = list.filter((p) => p.counts.manualCsv > 0);

    return list;
  }, [allSorted, query, activeFilters]);

  const displayList = filtered.slice(0, MAX_DISPLAY);
  const hasMore = filtered.length > MAX_DISPLAY;

  return (
    <div className="space-y-3">
      {/* フィルターチップ */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-400 shrink-0">絞り込み:</span>
        {(Object.keys(QUICK_FILTER_LABELS) as QuickFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => toggleFilter(f)}
            className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
              activeFilters.has(f)
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {QUICK_FILTER_LABELS[f]}
          </button>
        ))}
        {activeFilters.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
          >
            クリア
          </button>
        )}
      </div>

      {/* 検索入力 */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pl-7 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 text-[10px] pointer-events-none">
          🔍
        </span>
        {(value || query) && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xs leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {/* 選択中の人物情報（大きめ表示） */}
      {selectedPerson && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">
                選択中
              </span>
              <span className="text-sm font-bold text-slate-800">{selectedPerson.name}</span>
              {selectedPerson.group && (
                <span className="text-xs text-gray-500">（{selectedPerson.group}）</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0"
            >
              選択解除
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-500">
              公開{' '}
              <span className="font-semibold text-green-600">{selectedPerson.counts.published}</span>
            </span>
            <span className="text-gray-500">
              確認待ち{' '}
              <span className="font-semibold text-amber-600">{selectedPerson.counts.review}</span>
            </span>
            <span className="text-gray-500">
              非表示{' '}
              <span className="font-semibold text-gray-400">{selectedPerson.counts.hidden}</span>
            </span>
            <span className="text-gray-500">
              配信なし{' '}
              <span className="font-semibold text-rose-600">{selectedPerson.counts.noVod}</span>
            </span>
            {selectedPerson.counts.noTmdbId > 0 && (
              <span className="text-gray-500">
                tmdbIdなし{' '}
                <span className="font-semibold text-orange-600">
                  {selectedPerson.counts.noTmdbId}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 候補リスト */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1.5">
          {filtered.length > 0
            ? `${filtered.length}人中 上位${displayList.length}件を表示`
            : ''}
        </p>

        {displayList.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6 bg-gray-50 rounded-xl border border-gray-100">
            条件に一致する人物がいません
          </p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-0.5">
            {displayList.map((p) => {
              const isSelected = p.name === value;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => onChange(isSelected ? '' : p.name)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border transition-all ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-300 shadow-sm'
                      : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {/* 行1: 名前・グループ・作品数 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      {isSelected && (
                        <span className="text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full shrink-0">
                          選択中
                        </span>
                      )}
                      <span
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-indigo-800' : 'text-slate-700'
                        }`}
                      >
                        {p.name}
                      </span>
                      {p.group && (
                        <span className="text-[11px] text-gray-400 truncate">{p.group}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{p.counts.total}件</span>
                  </div>

                  {/* 行2: 統計バッジ */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] text-green-600">
                      公開<span className="font-medium ml-0.5">{p.counts.published}</span>
                    </span>
                    <span className="text-[10px] text-gray-300">·</span>
                    {p.counts.review > 0 ? (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                        確認待ち{p.counts.review}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400">確認待ち0</span>
                    )}
                    {p.counts.noVod > 0 ? (
                      <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">
                        配信なし{p.counts.noVod}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400">配信なし0</span>
                    )}
                    {p.counts.noTmdbId > 0 && (
                      <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
                        tmdbなし{p.counts.noTmdbId}
                      </span>
                    )}
                    {p.counts.manualCsv > 0 && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                        CSV{p.counts.manualCsv}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && (
          <p className="text-[11px] text-gray-400 text-center mt-2 py-2 bg-gray-50 rounded-lg border border-gray-100">
            他に{filtered.length - MAX_DISPLAY}人います。検索またはフィルターで絞り込んでください。
          </p>
        )}
      </div>
    </div>
  );
}
