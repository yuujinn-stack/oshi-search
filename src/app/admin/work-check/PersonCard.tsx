'use client';

import type { Counts, PersonPriority, ActivityStatus } from './work-check-types';
import { isCurrentMembership, type ResolvedMembership } from '@/lib/group-membership';

const ACTIVITY_BADGE: Record<ActivityStatus, { label: string; cls: string }> = {
  active:    { label: '現役',   cls: 'bg-green-100 text-green-700' },
  graduated: { label: '卒業',   cls: 'bg-blue-100 text-blue-700' },
  withdrawn: { label: '脱退',   cls: 'bg-red-100 text-red-600' },
  hiatus:    { label: '休止中', cls: 'bg-amber-100 text-amber-700' },
  retired:   { label: '引退',   cls: 'bg-gray-200 text-gray-500' },
  unknown:   { label: '不明',   cls: 'bg-gray-100 text-gray-400' },
};

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
  activityStatus?: ActivityStatus;
  generation?: string;
  /** 所属履歴（person_group_memberships）がある人物のグループごとの所属。指定時はグループ名・活動状態をこちらで表示 */
  memberships?: ResolvedMembership[];
  /** グループ絞り込み中のグループ（そのグループとの所属を先に表示し、別の現在の所属を「現在：」で添える） */
  focusGroup?: string;
}

function MembershipBadge({ m }: { m: ResolvedMembership }) {
  const badge = m.status ? ACTIVITY_BADGE[m.status] : null;
  return (
    <span className="text-xs text-gray-500 whitespace-nowrap">
      {m.groupName}
      {badge && (
        <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>［{badge.label}］</span>
      )}
    </span>
  );
}

function MembershipSummary({ memberships, focusGroup }: { memberships: ResolvedMembership[]; focusGroup?: string }) {
  const listed = memberships.filter((m) => m.source !== 'former_list');
  const focus = focusGroup ? listed.find((m) => m.groupName === focusGroup) : undefined;
  if (focus) {
    const others = listed.filter((m) => m !== focus && isCurrentMembership(m));
    return (
      <>
        <MembershipBadge m={focus} />
        {others.length > 0 && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            現在：{others.map((m) => <MembershipBadge key={m.groupName} m={m} />)}
          </span>
        )}
      </>
    );
  }
  const current = listed.filter(isCurrentMembership);
  const past = listed.filter((m) => !isCurrentMembership(m));
  return (
    <>
      {current.map((m) => <MembershipBadge key={m.groupName} m={m} />)}
      {past.map((m) => (
        <span key={m.groupName} className="text-xs text-gray-400 whitespace-nowrap">元<MembershipBadge m={m} /></span>
      ))}
    </>
  );
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
  activityStatus,
  generation,
  memberships,
  focusGroup,
}: PersonCardProps) {
  const priorityLabel = priority ? PRIORITY_BADGE[priority] : '';
  const dotClass = dataFetchStatus ? (STATUS_DOT[dataFetchStatus] ?? 'bg-gray-300') : '';
  const activityBadge = activityStatus && activityStatus !== 'unknown' ? ACTIVITY_BADGE[activityStatus] : null;

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
            {memberships ? (
              <MembershipSummary memberships={memberships} focusGroup={focusGroup} />
            ) : (
              group && <span className="text-xs text-gray-400">{group}</span>
            )}

            {/* 活動状態（所属履歴がある人物はグループごとの状態を上で表示するため出さない） */}
            {!memberships && activityBadge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${activityBadge.cls}`}>
                {activityBadge.label}
              </span>
            )}
            {/* 期別 */}
            {generation && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 font-medium">
                {generation}
              </span>
            )}
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
