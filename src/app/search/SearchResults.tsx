'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { PersonWithConfig, ActivityStatus } from '@/types/person';
import type { PersonMeta } from '@/lib/person-meta';
import type { GroupMeta } from '@/types/group';
import { groupHref } from '@/lib/group-slug';

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export interface PersonStats {
  productCount: number;
  workCount: number;
  streamingCount: number;
}

type SortKey = 'default' | 'active-first' | 'name' | 'genre';
type TabKey = 'all' | 'person' | 'group';

// ─── 定数 ────────────────────────────────────────────────────────────────────
const ACTIVITY_LABEL: Partial<Record<ActivityStatus, string>> = {
  active: '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus: '休止中',
  retired: '引退',
};
const ACTIVITY_BADGE_CLS: Record<ActivityStatus, string> = {
  active: 'bg-green-100 text-green-700',
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus: 'bg-amber-100 text-amber-700',
  retired: 'bg-gray-200 text-gray-500',
  unknown: '',
};
const GENRE_GRADIENT: Record<string, string> = {
  '坂道': 'from-pink-400 to-rose-500',
  '芸人': 'from-amber-400 to-orange-500',
  'テレビ': 'from-sky-400 to-blue-500',
  'アーティスト': 'from-violet-400 to-purple-600',
  '俳優': 'from-emerald-400 to-green-600',
};
const GENRE_BADGE_CLS: Record<string, string> = {
  '坂道': 'bg-pink-100 text-pink-700',
  '芸人': 'bg-yellow-100 text-yellow-700',
  'テレビ': 'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優': 'bg-green-100 text-green-700',
};
const GROUP_STATUS_LABEL: Record<string, string> = {
  active: '活動中', renamed: '改名', disbanded: '解散', hiatus: '活動休止',
};
const GROUP_STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  renamed: 'bg-blue-100 text-blue-700',
  disbanded: 'bg-gray-200 text-gray-500',
  hiatus: 'bg-amber-100 text-amber-700',
};
const SORT_ORDER: Record<ActivityStatus, number> = {
  active: 0, hiatus: 1, graduated: 2, withdrawn: 3, retired: 4, unknown: 5,
};

// ─── 人物カード ───────────────────────────────────────────────────────────────
function SearchPersonCard({
  person,
  meta,
  stats,
}: {
  person: PersonWithConfig;
  meta?: PersonMeta;
  stats?: PersonStats;
}) {
  const initial = person.name[0];
  const gradient = GENRE_GRADIENT[person.genre] ?? 'from-indigo-400 to-violet-500';
  const badgeCls = GENRE_BADGE_CLS[person.genre] ?? 'bg-gray-100 text-gray-600';
  const status = meta?.activityStatus;
  const statusLabel = status ? ACTIVITY_LABEL[status] : undefined;
  const statusCls = status ? ACTIVITY_BADGE_CLS[status] : '';
  const hasStats =
    stats && (stats.productCount > 0 || stats.workCount > 0 || stats.streamingCount > 0);

  return (
    <Link href={`/person/${encodeURIComponent(person.name)}`} className="block">
      <div
        className="overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col h-full"
        style={{
          background: 'var(--ds-surface)',
          border: '1px solid var(--ds-border)',
          borderRadius: 'var(--ds-radius)',
        }}
      >
        {/* アバター */}
        <div
          className={`aspect-[4/3] bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-3xl font-black select-none`}
        >
          {initial}
        </div>

        {/* テキスト情報 */}
        <div className="p-3 flex flex-col gap-1.5 flex-1">
          <p className="font-bold text-sm leading-snug" style={{ color: 'var(--ds-text)' }}>
            {person.name}
          </p>

          {person.group && (
            <p className="text-[11px] truncate" style={{ color: 'var(--ds-muted)' }}>
              {person.group}
            </p>
          )}

          {/* ジャンル・活動状態バッジ */}
          <div className="flex flex-wrap gap-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`}>
              {person.genre}
            </span>
            {statusLabel && statusCls && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCls}`}>
                {statusLabel}
              </span>
            )}
          </div>

          {/* 期別 */}
          {meta?.generation && (
            <p className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>
              {meta.generation}
            </p>
          )}

          {/* スタッツ（小検索時のみ表示） */}
          {hasStats && (
            <div
              className="flex flex-wrap gap-x-2 gap-y-0.5 pt-1.5 mt-auto border-t"
              style={{ borderColor: 'var(--ds-border)' }}
            >
              {(stats.productCount > 0) && (
                <span className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>
                  🛍 {stats.productCount}件
                </span>
              )}
              {(stats.workCount > 0) && (
                <span className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>
                  🎬 {stats.workCount}作品
                </span>
              )}
              {(stats.streamingCount > 0) && (
                <span className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>
                  ▶ 配信{stats.streamingCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── グループカード ───────────────────────────────────────────────────────────
function SearchGroupCard({
  group,
  memberCount,
  formerCount,
}: {
  group: GroupMeta;
  memberCount: number;
  formerCount: number;
}) {
  const statusLabel = GROUP_STATUS_LABEL[group.activityStatus];
  const statusCls = GROUP_STATUS_CLS[group.activityStatus] ?? '';

  return (
    <Link href={groupHref(group)} className="block group">
      <div
        className="p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
        style={{
          background: 'var(--ds-surface)',
          border: '1px solid var(--ds-border)',
          borderRadius: 'var(--ds-radius)',
        }}
      >
        <div className="flex items-start gap-3">
          {/* アイコン */}
          <div
            className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center font-black text-xl text-white"
            style={{
              background: 'linear-gradient(135deg, var(--ds-hero-from), var(--ds-hero-to))',
            }}
          >
            {group.groupName[0]}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-sm group-hover:underline" style={{ color: 'var(--ds-text)' }}>
                {group.groupName}
              </p>
              {statusLabel && statusCls && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCls}`}>
                  {statusLabel}
                </span>
              )}
            </div>

            {memberCount > 0 && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>
                現役 {memberCount}人
                {formerCount > 0 && (
                  <span className="ml-2">/ 歴代 {memberCount + formerCount}人</span>
                )}
              </p>
            )}

            {group.note && (
              <p className="text-[11px] mt-1.5 line-clamp-2 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
                {group.note}
              </p>
            )}
          </div>

          <span
            className="text-gray-300 group-hover:translate-x-0.5 transition-transform flex-shrink-0 mt-0.5 text-sm"
            aria-hidden="true"
          >
            →
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── ソートセレクター ─────────────────────────────────────────────────────────
function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="text-xs rounded-xl px-2.5 py-1.5 border"
      style={{
        background: 'var(--ds-surface)',
        borderColor: 'var(--ds-border)',
        color: 'var(--ds-text)',
        minHeight: '36px',
      }}
    >
      <option value="default">おすすめ順</option>
      <option value="active-first">現役優先</option>
      <option value="name">名前順</option>
      <option value="genre">ジャンル別</option>
    </select>
  );
}

// ─── メイン ───────────────────────────────────────────────────────────────────
export default function SearchResults({
  query,
  persons,
  personMetaMap,
  matchingGroups,
  memberCountMap,
  personStatsMap,
}: {
  query: string;
  persons: PersonWithConfig[];
  personMetaMap: Record<string, PersonMeta>;
  matchingGroups: GroupMeta[];
  memberCountMap: Record<string, { active: number; former: number }>;
  personStatsMap: Record<string, PersonStats>;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [sort, setSort] = useState<SortKey>('default');

  const sortedPersons = useMemo(() => {
    const base = [...persons];
    if (sort === 'name') return base.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (sort === 'genre') return base.sort((a, b) => a.genre.localeCompare(b.genre, 'ja'));
    if (sort === 'active-first') {
      return base.sort((a, b) => {
        const sa = personMetaMap[a.name]?.activityStatus ?? 'unknown';
        const sb = personMetaMap[b.name]?.activityStatus ?? 'unknown';
        return (SORT_ORDER[sa as ActivityStatus] ?? 5) - (SORT_ORDER[sb as ActivityStatus] ?? 5);
      });
    }
    return base;
  }, [persons, sort, personMetaMap]);

  const hasGroups = matchingGroups.length > 0;
  const showPersons = activeTab === 'all' || activeTab === 'person';
  const showGroups = activeTab === 'all' || activeTab === 'group';
  const isEmpty = persons.length === 0 && matchingGroups.length === 0;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'all', label: 'すべて', count: persons.length + matchingGroups.length },
    { key: 'person', label: '人物', count: persons.length },
    ...(hasGroups ? [{ key: 'group' as TabKey, label: 'グループ', count: matchingGroups.length }] : []),
  ];

  return (
    <div>
      {/* ─ コントロールバー（タブ + ソート） ─ */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {/* タブ（グループがある時のみ表示） */}
        {hasGroups && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex-shrink-0 flex items-center gap-1 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all duration-150"
                style={
                  activeTab === tab.key
                    ? { background: 'var(--ds-primary)', color: '#fff' }
                    : { background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }
                }
              >
                {tab.label}
                <span className="text-[10px] opacity-75">{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* ソートセレクター */}
        {showPersons && sortedPersons.length > 1 && (
          <div className="ml-auto">
            <SortSelect value={sort} onChange={setSort} />
          </div>
        )}
      </div>

      {/* ─ 人物セクション ─ */}
      {showPersons && sortedPersons.length > 0 && (
        <section className={activeTab === 'all' && hasGroups && sortedPersons.length > 0 ? 'mb-8' : ''}>
          {activeTab === 'all' && hasGroups && (
            <h2
              className="text-sm font-bold mb-3 flex items-center gap-1.5"
              style={{ color: 'var(--ds-text)' }}
            >
              <span>👤</span> 人物
              <span className="font-normal text-xs" style={{ color: 'var(--ds-muted)' }}>
                {sortedPersons.length}件
              </span>
            </h2>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {sortedPersons.map((person) => (
              <SearchPersonCard
                key={person.name}
                person={person}
                meta={personMetaMap[person.name]}
                stats={personStatsMap[person.name]}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─ グループセクション ─ */}
      {showGroups && matchingGroups.length > 0 && (
        <section>
          {activeTab === 'all' && sortedPersons.length > 0 && (
            <h2
              className="text-sm font-bold mb-3 flex items-center gap-1.5"
              style={{ color: 'var(--ds-text)' }}
            >
              <span>👥</span> グループ
              <span className="font-normal text-xs" style={{ color: 'var(--ds-muted)' }}>
                {matchingGroups.length}件
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {matchingGroups.map((group) => (
              <SearchGroupCard
                key={group.groupName}
                group={group}
                memberCount={memberCountMap[group.groupName]?.active ?? 0}
                formerCount={memberCountMap[group.groupName]?.former ?? 0}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─ 空状態 ─ */}
      {isEmpty && (
        <div className="text-center py-24" style={{ color: 'var(--ds-muted)' }}>
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-lg font-medium mb-2" style={{ color: 'var(--ds-text)' }}>
            {query
              ? `「${query}」に一致する人物・グループが見つかりませんでした`
              : '表示できる人物がいません'}
          </p>
          <p className="text-sm">別のキーワードで検索してみてください</p>
        </div>
      )}
    </div>
  );
}
