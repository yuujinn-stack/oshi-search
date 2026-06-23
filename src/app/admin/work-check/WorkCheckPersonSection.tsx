'use client';

import { useMemo, useState } from 'react';
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

const FETCH_STATUS_LABEL: Record<string, string> = {
  not_started: '未取得',
  queued: '待機中',
  processing: '取得中',
  completed: '完了',
  partial_error: '一部失敗',
  failed: '失敗',
};
const FETCH_STATUS_COLOR: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  queued: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  partial_error: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
};

type SortKey =
  | 'importedAt_desc'
  | 'importedAt_asc'
  | 'name'
  | 'totalWorks'
  | 'totalProducts'
  | 'noVod'
  | 'review'
  | 'lastUpdated';

const SORT_LABELS: Record<SortKey, string> = {
  importedAt_desc: '追加日（新しい順）',
  importedAt_asc: '追加日（古い順）',
  name: '名前順',
  totalWorks: '作品数順',
  totalProducts: '商品数順',
  noVod: '配信なし数順',
  review: '確認待ち数順',
  lastUpdated: '最終更新順',
};

function sortPersons(list: PersonWithCounts[], sort: SortKey): PersonWithCounts[] {
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'importedAt_asc':
        return (a.importedAt ?? 0) - (b.importedAt ?? 0);
      case 'name':
        return a.name.localeCompare(b.name, 'ja');
      case 'totalWorks':
        return b.counts.total - a.counts.total;
      case 'totalProducts':
        return (b.totalProducts ?? 0) - (a.totalProducts ?? 0);
      case 'noVod':
        return b.counts.noVod - a.counts.noVod;
      case 'review':
        return b.counts.review - a.counts.review;
      case 'lastUpdated':
        return (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0);
      default: // importedAt_desc
        return (b.importedAt ?? 0) - (a.importedAt ?? 0);
    }
  });
}

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

const RECENT_DAYS = 30;

export default function WorkCheckPersonSection({ persons, stats }: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('importedAt_desc');
  const [recentOpen, setRecentOpen] = useState(true);

  const groups = useMemo(
    () => Array.from(new Set(persons.map((p) => p.group).filter(Boolean))).sort(),
    [persons],
  );
  const genres = useMemo(
    () => Array.from(new Set(persons.map((p) => p.genre).filter(Boolean) as string[])).sort(),
    [persons],
  );

  const recentPersons = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return persons
      .filter((p) => (p.importedAt ?? 0) > cutoff)
      .sort((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0))
      .slice(0, 8);
  }, [persons]);

  const hasFilter = Object.values(filters).some(Boolean);
  const hasSearch = searchQuery.trim() !== '';
  const isFiltered = hasFilter || hasSearch || !!groupFilter || !!genreFilter;

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSearchQuery('');
    setGroupFilter('');
    setGenreFilter('');
  }

  const filtered = useMemo(() => {
    let list = persons;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          (p.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
      );
    }

    if (groupFilter) list = list.filter((p) => p.group === groupFilter);
    if (genreFilter) list = list.filter((p) => p.genre === genreFilter);

    if (filters.noVod) list = list.filter((p) => p.counts.noVod > 0);
    if (filters.noTmdbId) list = list.filter((p) => p.counts.noTmdbId > 0);
    if (filters.review) list = list.filter((p) => p.counts.review > 0);
    if (filters.hidden) list = list.filter((p) => p.counts.hidden > 0);
    if (filters.manualCsv) list = list.filter((p) => p.counts.manualCsv > 0);
    if (filters.aiSupplement) list = list.filter((p) => p.counts.aiSupplement > 0);

    return sortPersons(list, sort);
  }, [persons, searchQuery, groupFilter, genreFilter, filters, sort]);

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
              className={`${baseClass} ${isActive ? 'ring-2 ring-offset-1 ring-slate-500' : 'hover:brightness-95'}`}
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

      {/* 最近追加セクション */}
      {recentPersons.length > 0 && (
        <div className="border border-indigo-100 rounded-xl overflow-hidden">
          <button
            onClick={() => setRecentOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-50 text-left"
          >
            <span className="text-xs font-semibold text-indigo-700">
              最近追加（{RECENT_DAYS}日以内）― {recentPersons.length}人
            </span>
            <span className="text-indigo-400 text-xs">{recentOpen ? '▲' : '▼'}</span>
          </button>
          {recentOpen && (
            <div className="px-4 py-3 bg-white flex flex-wrap gap-2">
              {recentPersons.map((p) => {
                const statusKey = p.dataFetchStatus ?? 'not_started';
                return (
                  <div
                    key={p.name}
                    className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-gray-50"
                  >
                    <span className="font-medium text-slate-700">{p.name}</span>
                    {p.group && <span className="text-gray-400">{p.group}</span>}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        FETCH_STATUS_COLOR[statusKey] ?? 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {FETCH_STATUS_LABEL[statusKey] ?? statusKey}
                    </span>
                    {p.importedAt && (
                      <span className="text-gray-400">
                        {new Date(p.importedAt).toLocaleDateString('ja-JP', {
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 検索 + フィルターバー */}
      <div className="space-y-2">
        {/* 行1: 検索・グループ・ジャンル・ソート */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* テキスト検索 */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="名前・グループ・別名で検索..."
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 pl-7 w-44 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300 text-[10px]">🔍</span>
          </div>

          {/* グループフィルター */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="">全グループ</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          {/* ジャンルフィルター */}
          <div className="flex items-center gap-1 flex-wrap">
            {genres.map((g) => (
              <button
                key={g}
                onClick={() => setGenreFilter(genreFilter === g ? '' : g)}
                className={`text-[11px] px-2 py-1 rounded-full transition-colors ${
                  genreFilter === g
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* ソート */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-300 ml-auto"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {/* 行2: 作業フラグフィルター */}
        <div className="flex items-center gap-3 flex-wrap text-xs">
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
              priority={p.priority}
              memo={p.memo}
              dataFetchStatus={p.dataFetchStatus}
            />
          ))
        )}
      </div>
    </div>
  );
}
