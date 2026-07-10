'use client';

import { useState } from 'react';
import WorkCard from '@/components/WorkCard';
import type { WorkRecord } from '@/types/work';
import {
  getDisplayWorkType,
  DISPLAY_WORK_TYPE_LABEL,
  DISPLAY_WORK_TYPE_ORDER,
  type DisplayWorkType,
} from '@/lib/work-display-type';

type FilterType = DisplayWorkType | 'all';

interface Props {
  works: WorkRecord[];
}

export default function WorksSection({ works }: Props) {
  const [activeType, setActiveType] = useState<FilterType>('all');

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

  // フィルタ済み作品リスト
  const filteredWorks =
    activeType === 'all'
      ? typedWorks
      : typedWorks.filter(({ displayType }) => displayType === activeType);

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

      {/* 作品グリッド */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {filteredWorks.map(({ work }) => (
          <WorkCard key={work.id} work={work} />
        ))}
      </div>
    </div>
  );
}
