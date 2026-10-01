'use client';

import type { FixedPersonPlanSummary } from '@/lib/instagram-template-plan';

interface Props {
  summary: FixedPersonPlanSummary;
  personCount: number;
  templateCount: number;
  /** 「最大7日分まで予約」ON（未予約件数を必ず表示する） */
  maxWeek: boolean;
  /** 打ち切ったとき、最後に予約される投稿（例: 金川紗耶・G 推し活、検索しすぎ問題） */
  lastScheduledLabel?: string;
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD' */
export function formatSlashDate(d: string): string {
  return d.replaceAll('-', '/');
}

/**
 * 人物固定・テンプレを変えるモードの「総投稿数・必要日数」カード。
 * 値はすべて planFixedPersonSchedule の配置結果（＝実際に予約する内容）から計算したもの。
 */
export default function PlanSummaryCard({ summary: s, personCount, templateCount, maxWeek, lastScheduledLabel }: Props) {
  const showOmitted = maxWeek || s.omittedCount > 0;
  const cells: [string, string][] = [
    ['選択人物', `${personCount}人`],
    ['選択テンプレ', `${templateCount}個`],
    ['総投稿数', `${s.totalPosts}件`],
    ['1日あたり', `${s.perDay}件`],
    ['予約予定', `${s.scheduledCount}件`],
    ...(showOmitted ? ([['未予約', `${s.omittedCount}件`]] as [string, string][]) : []),
    ['必要日数', `${s.days}日`],
    ['開始日', s.startDateJst ? formatSlashDate(s.startDateJst) : '—'],
    ['終了予定日', s.endDateJst ? formatSlashDate(s.endDateJst) : '—'],
  ];
  return (
    <div className="border border-violet-200 bg-violet-50/60 rounded-xl p-4 mb-3">
      <p className="text-xl font-bold text-violet-800">
        {s.scheduledCount}投稿 / {s.days}日間
      </p>
      {s.startDateJst && s.endDateJst && (
        <p className="text-xs text-violet-700 mt-0.5">
          予定期間：{formatSlashDate(s.startDateJst)} ～ {formatSlashDate(s.endDateJst)}
        </p>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-3">
        {cells.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 min-w-0 border-b border-violet-100 pb-1">
            <dt className="text-[11px] text-gray-500 shrink-0">{k}</dt>
            <dd className={`text-sm font-semibold text-right ${k === '未予約' && s.omittedCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 space-y-1 text-[11px]">
        <p className="text-gray-500">
          計算：{s.scheduledCount}件 ÷ 1日{s.perDay}件 ＝ {s.baseDays}日
          {s.dayDiff > 0 && <span className="text-amber-700 font-semibold">　→ 既存予約・過去の枠のため{s.dayDiff}日延長（実際は{s.days}日）</span>}
          {s.dayDiff < 0 && s.adjusted && <span className="text-emerald-700 font-semibold">　→ 最終日の調整で{-s.dayDiff}日短縮（実際は{s.days}日）</span>}
        </p>
        {s.omittedCount > 0 && (
          <p className="text-amber-700">
            {maxWeek ? '最大7日分までのため、' : ''}{s.omittedCount}件は予約しません
            {lastScheduledLabel ? `（最後に予約されるのは ${lastScheduledLabel}）` : ''}。
          </p>
        )}
      </div>
    </div>
  );
}
