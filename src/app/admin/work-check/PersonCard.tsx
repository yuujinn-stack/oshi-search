'use client';

import type { Counts } from './work-check-types';

interface PersonCardProps {
  personName: string;
  group: string;
  counts: Counts;
  reviewCount: number;
  supplementCount: number;
  open: boolean;
  onClick: () => void;
}

export default function PersonCard({
  personName,
  group,
  counts,
  reviewCount,
  supplementCount,
  open,
  onClick,
}: PersonCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{personName}</span>
        {group && <span className="text-xs text-gray-400">{group}</span>}
      </div>
      <div className="flex items-center gap-2">
        {counts.total > 0 && (
          <span className="text-xs text-gray-500">
            公開{counts.published} / 確認待ち{counts.review} / 非表示{counts.hidden}
          </span>
        )}
        {reviewCount > 0 && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
            確認待ち {reviewCount}件
          </span>
        )}
        {supplementCount > 0 && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
            AI補完 {supplementCount}件
          </span>
        )}
        <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
      </div>
    </button>
  );
}
