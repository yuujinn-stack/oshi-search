'use client';

import type { Counts } from './work-check-types';

interface PersonCardProps {
  personName: string;
  group: string;
  counts: Counts;
  open: boolean;
  onClick: () => void;
}

export default function PersonCard({
  personName,
  group,
  counts,
  open,
  onClick,
}: PersonCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start justify-between gap-3 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
    >
      {/* 左: 人物名・グループ・優先度バッジ */}
      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-700">{personName}</span>
        {group && <span className="text-xs text-gray-400">{group}</span>}
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
