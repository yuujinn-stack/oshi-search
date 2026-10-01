'use client';

import type { GroupOption } from '@/lib/person-group-filter';
import { GROUP_ALL, GROUP_NONE } from '@/lib/person-group-filter';

interface Props {
  options: GroupOption[];
  value: string;
  onChange: (next: string) => void;
  /** 「すべて」の人数 */
  totalCount: number;
  /** 卒業・元メンバーも含むか（初期値 OFF＝現役のみ） */
  includeFormer: boolean;
  onIncludeFormerChange: (next: boolean) => void;
}

/**
 * 人物選択のグループ絞り込み（通常予約・一括予約で共通）。選択肢は人物データから作る（buildGroupOptions）。
 * グループを選ぶと既定では現役メンバーだけ。「卒業・元メンバーも含む」をONにすると過去の所属者も対象にする。
 */
export default function GroupFilterSelect({ options, value, onChange, totalCount, includeFormer, onIncludeFormerChange }: Props) {
  const selected = options.find((o) => o.value === value);
  const isGroup = value !== GROUP_ALL && value !== GROUP_NONE;
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
        <span className="font-semibold shrink-0">グループ</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="グループで絞り込み"
          className="min-w-0 flex-1 text-xs border border-gray-300 rounded-lg px-2 py-2 bg-white text-slate-700"
        >
          <option value={GROUP_ALL}>すべて（{totalCount}人）</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}（{o.value === GROUP_NONE ? `${o.allCount}人` : includeFormer ? `${o.allCount}人` : `現役${o.currentCount}人`}）
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className={`flex items-center gap-1.5 text-xs ${isGroup ? 'text-slate-700 cursor-pointer' : 'text-gray-300 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={includeFormer}
            disabled={!isGroup}
            onChange={(e) => onIncludeFormerChange(e.target.checked)}
            aria-label="卒業・元メンバーも含む"
          />
          卒業・元メンバーも含む
        </label>
        {isGroup && selected && (
          <span className="text-[11px] text-gray-500">
            {includeFormer
              ? `対象 ${selected.allCount}人（現役${selected.currentCount}人＋卒業・元メンバー${selected.allCount - selected.currentCount}人）`
              : `現役 ${selected.currentCount}人`}
          </span>
        )}
      </div>
    </div>
  );
}
