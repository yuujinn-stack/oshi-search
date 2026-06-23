'use client';

import type { Counts, PersonPriority } from './work-check-types';

const PRIORITY_BADGE: Record<PersonPriority, string> = {
  high: '★ 優先',
  normal: '',
  low: '↓ 後回し',
};
const PRIORITY_COLOR: Record<PersonPriority, string> = {
  high: 'bg-red-100 text-red-700',
  normal: '',
  low: 'bg-gray-100 text-gray-500',
};

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-400',
  partial_error: 'bg-orange-400',
  failed: 'bg-red-400',
  processing: 'bg-blue-400 animate-pulse',
  queued: 'bg-yellow-400',
  not_started: 'bg-gray-300',
};

interface PersonCardProps {
  personName: string;
  group: string;
  counts: Counts;
  open: boolean;
  onClick: () => void;
  priority?: PersonPriority;
  memo?: string;
  dataFetchStatus?: string;
}

export default function PersonCard({
  personName,
  group,
  counts,
  open,
  onClick,
  priority,
  memo,
  dataFetchStatus,
}: PersonCardProps) {
  const priorityLabel = priority ? PRIORITY_BADGE[priority] : '';
  const dotClass = dataFetchStatus ? (STATUS_DOT[dataFetchStatus] ?? 'bg-gray-300') : '';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start justify-between gap-3 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
    >
      {/* 左: 人物名・グループ・バッジ群 */}
      <div className="flex items-start gap-2 flex-wrap flex-1 min-w-0">
        {/* 取得状態ドット */}
        {dotClass && (
          <span
            className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotClass}`}
            title={dataFetchStatus}
          />
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-700">{personName}</span>
            {group && <span className="text-xs text-gray-400">{group}</span>}

            {/* 優先度 */}
            {priority && priority !== 'normal' && priorityLabel && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[priority]}`}>
                {priorityLabel}
              </span>
            )}

            {/* 作業フラグ */}
            {counts.review > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                ⚠ 確認待ち {counts.review}
              </span>
            )}
            {counts.noVod > 0 && (
              <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                ⚠ 配信なし {counts.noVod}
              </span>
            )}
            {counts.noTmdbId > 0 && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                ⚠ tmdbIdなし {counts.noTmdbId}
              </span>
            )}
          </div>

          {/* メモプレビュー */}
          {memo && (
            <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-xs">{memo}</p>
          )}
        </div>
      </div>

      {/* 右: 作品数サマリー・開閉 */}
      <div className="flex items-center gap-2 shrink-0">
        {counts.total > 0 && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            公開{counts.published} / 確認待ち{counts.review} / 非表示{counts.hidden}
          </span>
        )}
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </div>
    </button>
  );
}
