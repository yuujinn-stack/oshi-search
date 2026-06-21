'use client';

import type { WorkStatus, WorkSource } from '@/types/work';

type StatusFilter = WorkStatus | 'all';
type SourceFilter = WorkSource | 'all';

interface WorkFiltersProps {
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  onStatusChange: (v: StatusFilter) => void;
  onSourceChange: (v: SourceFilter) => void;
}

export default function WorkFilters({
  statusFilter,
  sourceFilter,
  onStatusChange,
  onSourceChange,
}: WorkFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        {(
          [
            { key: 'needs_review', label: '確認待ち' },
            { key: 'auto_published', label: '公開中' },
            { key: 'hidden', label: '非表示' },
            { key: 'all', label: '全ステータス' },
          ] as { key: StatusFilter; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onStatusChange(key)}
            className={`px-3 py-1.5 border-l first:border-l-0 border-gray-200 ${
              statusFilter === key
                ? 'bg-slate-700 text-white font-medium'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        {(
          [
            { key: 'all', label: '全ソース' },
            { key: 'tmdb', label: 'TMDb' },
            { key: 'openai_suggestion', label: 'AI補完' },
            { key: 'manual', label: '手動' },
            { key: 'manual_csv', label: 'CSV手動' },
          ] as { key: SourceFilter; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSourceChange(key)}
            className={`px-3 py-1.5 border-l first:border-l-0 border-gray-200 ${
              sourceFilter === key
                ? 'bg-slate-700 text-white font-medium'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
