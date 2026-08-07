'use client';

import { useMemo, useState } from 'react';
import WorkCard from '@/components/WorkCard';
import type { WorkRecord } from '@/types/work';
import {
  getDisplayWorkType,
  DISPLAY_WORK_TYPE_LABEL,
  DISPLAY_WORK_TYPE_ORDER,
  type DisplayWorkType,
} from '@/lib/work-display-type';
import {
  filterAndSortWorks,
  getAvailableDecades,
  getAvailableProviders,
  isDefaultWorkFilter,
  DEFAULT_WORK_FILTER,
  type WorkFilterOptions,
  type WorkSortMode,
} from '@/lib/work-filter';

type FilterType = DisplayWorkType | 'all';

const SORT_LABEL: Record<WorkSortMode, string> = {
  streaming_first: '配信あり優先',
  newest: '新しい順',
  oldest: '古い順',
};

interface Props {
  works: WorkRecord[];
}

export default function WorksSection({ works }: Props) {
  const [activeType, setActiveType] = useState<FilterType>('all');
  const [filterOptions, setFilterOptions] = useState<WorkFilterOptions>(DEFAULT_WORK_FILTER);

  // 各作品の表示タイプを計算（レンダリング時に一度だけ）
  const typedWorks = works.map((work) => ({
    work,
    displayType: getDisplayWorkType(work),
  }));

  // 件数マップ
  const typeCounts = new Map<DisplayWorkType, number>();
  for (const { displayType } of typedWorks) {
    typeCounts.set(displayType, (typeCounts.get(displayType) ?? 0) + 1);
  }

  // タブ表示順（件数 1件以上のタイプのみ）
  const availableTypes: FilterType[] = [
    'all',
    ...DISPLAY_WORK_TYPE_ORDER.filter((t) => (typeCounts.get(t) ?? 0) > 0),
  ];

  // タブは2種類以上のカテゴリがある場合のみ表示
  const showTabs = availableTypes.length > 2;

  // カテゴリタブによる絞り込み（既存ロジック）
  const genreFilteredWorks =
    activeType === 'all'
      ? typedWorks.map(({ work }) => work)
      : typedWorks.filter(({ displayType }) => displayType === activeType).map(({ work }) => work);

  // 検索・年代・配信サービス・並べ替えは、対象作品（カテゴリ絞り込み後）から選択肢を作る
  const availableDecades = useMemo(() => getAvailableDecades(genreFilteredWorks), [genreFilteredWorks]);
  const availableProviders = useMemo(() => getAvailableProviders(genreFilteredWorks), [genreFilteredWorks]);

  // 検索・年代・配信サービス・並べ替えを複合適用（ジャンルタブとは独立して組み合わせ可能）
  const filteredWorks = useMemo(
    () => filterAndSortWorks(genreFilteredWorks, filterOptions),
    [genreFilteredWorks, filterOptions],
  );

  const isFiltered = !isDefaultWorkFilter(filterOptions);
  // 検索対象100件以上を目安に、検索・絞り込みUIを表示する
  const showFilterUi = works.length >= 20;

  function updateFilter(patch: Partial<WorkFilterOptions>) {
    setFilterOptions((prev) => ({ ...prev, ...patch }));
  }

  function clearFilters() {
    setFilterOptions(DEFAULT_WORK_FILTER);
  }

  return (
    <div>
      {/* カテゴリフィルタタブ */}
      {showTabs && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-2 mb-4">
          {availableTypes.map((type) => {
            const isActive = type === activeType;
            const label = type === 'all' ? 'すべて' : DISPLAY_WORK_TYPE_LABEL[type];
            const count = type === 'all' ? works.length : (typeCounts.get(type as DisplayWorkType) ?? 0);
            return (
              <button
                key={type}
                type="button"
                onClick={() => setActiveType(type)}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap"
                style={
                  isActive
                    ? { background: 'var(--ds-primary)', color: '#fff' }
                    : { background: 'var(--ds-surface)', color: 'var(--ds-muted)', border: '1px solid var(--ds-border)' }
                }
              >
                {label}
                <span
                  className="text-[10px] px-1 py-0.5 rounded-full"
                  style={
                    isActive
                      ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                      : { background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 検索・年代・配信サービス・並べ替え */}
      {showFilterUi && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="search"
            value={filterOptions.searchText}
            onChange={(e) => updateFilter({ searchText: e.target.value })}
            placeholder="作品名で検索"
            aria-label="作品名で検索"
            className="flex-1 min-w-[140px] text-sm px-3 py-2 rounded-lg"
            style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
          />

          {availableDecades.length > 1 && (
            <select
              value={filterOptions.decade}
              onChange={(e) => updateFilter({ decade: e.target.value })}
              aria-label="年代で絞り込み"
              className="text-sm px-2 py-2 rounded-lg"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            >
              <option value="all">すべての年代</option>
              {availableDecades.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}

          {availableProviders.length > 1 && (
            <select
              value={filterOptions.providerSlug}
              onChange={(e) => updateFilter({ providerSlug: e.target.value })}
              aria-label="配信サービスで絞り込み"
              className="text-sm px-2 py-2 rounded-lg"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            >
              <option value="all">すべての配信サービス</option>
              {availableProviders.map((p) => (
                <option key={p.slug} value={p.slug}>{p.displayName}</option>
              ))}
            </select>
          )}

          <select
            value={filterOptions.sortMode}
            onChange={(e) => updateFilter({ sortMode: e.target.value as WorkSortMode })}
            aria-label="並べ替え"
            className="text-sm px-2 py-2 rounded-lg"
            style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
          >
            {(Object.keys(SORT_LABEL) as WorkSortMode[]).map((mode) => (
              <option key={mode} value={mode}>{SORT_LABEL[mode]}</option>
            ))}
          </select>

          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
              style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}
            >
              条件をクリア
            </button>
          )}
        </div>
      )}

      {/* 件数表示（絞り込み中のみ） */}
      {showFilterUi && isFiltered && (
        <p className="text-xs mb-3" style={{ color: 'var(--ds-muted)' }}>
          {filteredWorks.length}件見つかりました
        </p>
      )}

      {/* 作品グリッド */}
      {filteredWorks.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredWorks.map((work) => (
            <WorkCard key={work.id} work={work} />
          ))}
        </div>
      ) : (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--ds-muted)' }}>
          条件に一致する作品が見つかりませんでした。
        </p>
      )}
    </div>
  );
}
