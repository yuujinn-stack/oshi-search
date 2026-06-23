'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonWithCounts } from './work-check-types';

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
  const [open, setOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilter>>(new Set());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedPerson = persons.find((p) => p.name === value);

  function toggleFilter(f: QuickFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
    setOpen(true);
  }

  const filtered = useMemo(() => {
    let list = persons;

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

    // 配信なし多い → 確認待ち多い → 作品多い の順
    return [...list].sort((a, b) => {
      if (b.counts.noVod !== a.counts.noVod) return b.counts.noVod - a.counts.noVod;
      if (b.counts.review !== a.counts.review) return b.counts.review - a.counts.review;
      return b.counts.total - a.counts.total;
    });
  }, [persons, query, activeFilters]);

  function handleSelect(name: string) {
    onChange(name);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapperRef} className="space-y-2">
      {/* クイックフィルター */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-400">絞り込み:</span>
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
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pl-7 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 text-[10px] pointer-events-none">
          🔍
        </span>
        {(value || query) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xs leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {/* ドロップダウン */}
      {open && (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-lg bg-white">
          <ul className="max-h-64 overflow-y-auto divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <li className="text-xs text-gray-400 text-center py-4">
                {query || activeFilters.size > 0
                  ? '条件に一致する人物がいません'
                  : '人物が見つかりません'}
              </li>
            ) : (
              filtered.map((p) => {
                const isSelected = p.name === value;
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => handleSelect(p.name)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 border-l-2 border-indigo-500'
                          : 'hover:bg-gray-50 border-l-2 border-transparent'
                      }`}
                    >
                      {/* チェックマーク */}
                      <span className={`text-[10px] w-3 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-transparent'}`}>
                        ✓
                      </span>

                      {/* 人物名・グループ */}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-slate-800">{p.name}</span>
                        {p.group && (
                          <span className="text-[11px] text-gray-400 ml-1.5">{p.group}</span>
                        )}
                      </div>

                      {/* カウントバッジ */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-gray-400">{p.counts.total}件</span>
                        {p.counts.noVod > 0 && (
                          <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                            配信なし{p.counts.noVod}
                          </span>
                        )}
                        {p.counts.review > 0 && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                            確認{p.counts.review}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 text-right">
            {filtered.length}人表示
          </div>
        </div>
      )}

      {/* 選択中の人物情報 */}
      {selectedPerson && (
        <div className="flex items-center justify-between text-[11px] bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          <span>
            <span className="font-semibold text-slate-700">{selectedPerson.name}</span>
            {selectedPerson.group && (
              <span className="text-gray-500 ml-1">（{selectedPerson.group}）</span>
            )}
          </span>
          <span className="text-gray-500 ml-3 whitespace-nowrap">
            公開{' '}
            <span className="text-green-600 font-medium">{selectedPerson.counts.published}</span>
            {' / '}確認待ち{' '}
            <span className="text-amber-600 font-medium">{selectedPerson.counts.review}</span>
            {' / '}非表示{' '}
            <span className="text-gray-400">{selectedPerson.counts.hidden}</span>
            {' / '}配信なし{' '}
            <span className="text-rose-600 font-medium">{selectedPerson.counts.noVod}</span>
          </span>
        </div>
      )}
    </div>
  );
}
