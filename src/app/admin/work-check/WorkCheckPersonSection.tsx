'use client';

import { useState } from 'react';
import PersonWorks from './PersonWorks';
import type { DashboardStats, PersonWithCounts } from './work-check-types';

type FilterKey = 'noVod' | 'noTmdbId' | 'review' | 'hidden' | 'manualCsv' | 'aiSupplement';

const FILTER_LABELS: Record<FilterKey, string> = {
  noVod: '配信なし',
  noTmdbId: 'tmdbIdなし',
  review: '確認待ち',
  hidden: '非表示あり',
  manualCsv: 'CSV手動',
  aiSupplement: 'AI補完',
};

type Filters = Record<FilterKey, boolean>;

const EMPTY_FILTERS: Filters = {
  noVod: false,
  noTmdbId: false,
  review: false,
  hidden: false,
  manualCsv: false,
  aiSupplement: false,
};

interface StatCardDef {
  label: string;
  value: number;
  filterKey?: FilterKey;
  valueColor: string;
  bg: string;
  border: string;
}

interface Props {
  persons: PersonWithCounts[];
  stats: DashboardStats;
}

export default function WorkCheckPersonSection({ persons, stats }: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState('');

  const hasFilter = Object.values(filters).some(Boolean);
  const hasSearch = searchQuery.trim() !== '';
  const isFiltered = hasFilter || hasSearch;

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSearchQuery('');
  }

  const filtered = persons.filter((p) => {
    if (hasSearch) {
      const q = searchQuery.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.group.toLowerCase().includes(q)) return false;
    }
    if (filters.noVod && p.counts.noVod === 0) return false;
    if (filters.noTmdbId && p.counts.noTmdbId === 0) return false;
    if (filters.review && p.counts.review === 0) return false;
    if (filters.hidden && p.counts.hidden === 0) return false;
    if (filters.manualCsv && p.counts.manualCsv === 0) return false;
    if (filters.aiSupplement && p.counts.aiSupplement === 0) return false;
    return true;
  });

  const statCards: StatCardDef[] = [
    {
      label: '登録人物数',
      value: stats.personCount,
      valueColor: 'text-slate-700',
      bg: 'bg-slate-50',
      border: 'border-slate-200',
    },
    {
      label: '総作品数',
      value: stats.totalWorks,
      valueColor: 'text-slate-700',
      bg: 'bg-slate-50',
      border: 'border-slate-200',
    },
    {
      label: '公開中',
      value: stats.published,
      valueColor: 'text-green-700',
      bg: 'bg-green-50',
      border: 'border-green-200',
    },
    {
      label: '確認待ち',
      value: stats.review,
      filterKey: 'review',
      valueColor: stats.review > 0 ? 'text-amber-700' : 'text-gray-400',
      bg: stats.review > 0 ? 'bg-amber-50' : 'bg-gray-50',
      border: stats.review > 0 ? 'border-amber-200' : 'border-gray-200',
    },
    {
      label: '非表示',
      value: stats.hidden,
      filterKey: 'hidden',
      valueColor: 'text-gray-500',
      bg: 'bg-gray-50',
      border: 'border-gray-200',
    },
    {
      label: '配信なし',
      value: stats.noVod,
      filterKey: 'noVod',
      valueColor: stats.noVod > 0 ? 'text-rose-700' : 'text-gray-400',
      bg: stats.noVod > 0 ? 'bg-rose-50' : 'bg-gray-50',
      border: stats.noVod > 0 ? 'border-rose-200' : 'border-gray-200',
    },
    {
      label: 'tmdbIdなし',
      value: stats.noTmdbId,
      filterKey: 'noTmdbId',
      valueColor: stats.noTmdbId > 0 ? 'text-orange-700' : 'text-gray-400',
      bg: stats.noTmdbId > 0 ? 'bg-orange-50' : 'bg-gray-50',
      border: stats.noTmdbId > 0 ? 'border-orange-200' : 'border-gray-200',
    },
    {
      label: 'CSV手動',
      value: stats.manualCsv,
      filterKey: 'manualCsv',
      valueColor: 'text-blue-700',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
    },
    {
      label: 'AI補完',
      value: stats.aiSupplement,
      filterKey: 'aiSupplement',
      valueColor: 'text-purple-700',
      bg: 'bg-purple-50',
      border: 'border-purple-200',
    },
  ];

  return (
    <div className="space-y-4">
      {/* ダッシュボードカード */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {statCards.map((card) => {
          const isActive = card.filterKey !== undefined && filters[card.filterKey];
          const innerContent = (
            <>
              <span className={`text-xl font-bold tabular-nums ${card.valueColor}`}>{card.value}</span>
              <span className="text-[10px] text-gray-500 mt-0.5 leading-tight">{card.label}</span>
            </>
          );
          const baseClass = `flex flex-col items-center p-2.5 rounded-lg border text-center transition-all ${card.bg} ${card.border}`;

          return card.filterKey !== undefined ? (
            <button
              key={card.label}
              onClick={() => toggleFilter(card.filterKey as FilterKey)}
              className={`${baseClass} ${
                isActive
                  ? 'ring-2 ring-offset-1 ring-slate-500'
                  : 'hover:brightness-95'
              }`}
            >
              {innerContent}
            </button>
          ) : (
            <div key={card.label} className={baseClass}>
              {innerContent}
            </div>
          );
        })}
      </div>

      {/* 検索 + フィルターバー */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="人物名で検索..."
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 pl-7 w-36 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300 text-[10px]">🔍</span>
        </div>
        <span className="text-gray-400 shrink-0">絞り込み:</span>
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <label key={key} className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filters[key]}
              onChange={() => toggleFilter(key)}
              className="rounded"
            />
            <span className={filters[key] ? 'text-slate-800 font-medium' : 'text-gray-500'}>
              {FILTER_LABELS[key]}
            </span>
          </label>
        ))}
        {isFiltered && (
          <>
            <button
              onClick={clearAll}
              className="text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded border border-gray-200 hover:border-gray-300"
            >
              クリア
            </button>
            <span className="text-gray-400 ml-auto shrink-0">
              {filtered.length} / {persons.length} 人
            </span>
          </>
        )}
      </div>

      {/* 人物リスト */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            条件に一致する人物がいません
          </p>
        ) : (
          filtered.map((p) => (
            <PersonWorks
              key={p.name}
              personName={p.name}
              group={p.group}
              counts={p.counts}
            />
          ))
        )}
      </div>
    </div>
  );
}
