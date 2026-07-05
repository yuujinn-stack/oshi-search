'use client';

import { useState } from 'react';
import GroupMemberCard from './GroupMemberCard';
import type { GroupMemberCardData } from './GroupMemberCard';

const INITIAL_SHOW = 8;

interface Props {
  title: string;
  members: GroupMemberCardData[];
}

export default function MemberSection({ title, members }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = members.length > INITIAL_SHOW;
  const displayed = expanded ? members : members.slice(0, INITIAL_SHOW);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
          {title}
        </h2>
        <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{members.length}人</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {displayed.map((m) => (
          <GroupMemberCard key={m.name} member={m} />
        ))}
      </div>

      {hasMore && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm font-medium px-5 py-2 rounded-full border transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--ds-border)', color: 'var(--ds-primary)' }}
          >
            {expanded
              ? '閉じる'
              : `すべての${title}を見る（残り ${members.length - INITIAL_SHOW}人）`}
          </button>
        </div>
      )}
    </div>
  );
}
