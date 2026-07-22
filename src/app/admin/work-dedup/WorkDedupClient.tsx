'use client';

import { useState, useMemo } from 'react';
import type { WorkDedupGroup, WorkDedupStats, WorkDuplicateConfidence } from '@/lib/work-dedup';

// ─── 定数 ──────────────────────────────────────────────────────────────────────

const CONFIDENCE_LABELS: Record<WorkDuplicateConfidence, string> = {
  exact:    '🔴 exact（外部ID一致）',
  high:     '🟠 high（タイトル+種別+年一致）',
  medium:   '🟡 medium（年欠落）',
  low:      '⚪ low（タイトルのみ）',
  conflict: '⚫ conflict（矛盾あり）',
};

const BADGE_CLASS: Record<WorkDuplicateConfidence, string> = {
  exact:    'bg-red-900/60 text-red-200 border border-red-700',
  high:     'bg-orange-900/60 text-orange-200 border border-orange-700',
  medium:   'bg-yellow-900/60 text-yellow-200 border border-yellow-700',
  low:      'bg-slate-700 text-slate-300 border border-slate-600',
  conflict: 'bg-slate-900 text-slate-400 border border-slate-600',
};

const ALL_CONFIDENCES: WorkDuplicateConfidence[] = ['exact', 'high', 'medium', 'low', 'conflict'];

// ─── 統計ヘッダー ───────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: WorkDedupStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: '全DBレコード',    value: stats.totalWorkRecords },
        { label: 'ユニークworkId',  value: stats.uniqueWorkIds },
        { label: '候補グループ数',  value: stats.duplicateCandidateGroups },
        { label: '候補作品数',      value: stats.duplicateCandidateWorks },
        { label: 'exact',           value: stats.exactGroups },
        { label: 'high',            value: stats.highGroups },
        { label: 'medium',          value: stats.mediumGroups },
        { label: 'conflict',        value: stats.conflictGroups },
      ].map(({ label, value }) => (
        <div key={label} className="bg-slate-800 rounded p-3 border border-slate-700">
          <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── グループ詳細カード ──────────────────────────────────────────────────────────

function GroupCard({ group }: { group: WorkDedupGroup }) {
  const [open, setOpen] = useState(false);
  const plan = group.mergePlan;

  return (
    <div className="border border-slate-700 rounded-lg bg-slate-800/50 overflow-hidden">
      {/* ヘッダー行 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-700/40 transition-colors"
      >
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${BADGE_CLASS[group.confidence]}`}>
          {group.confidence.toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-100 text-sm truncate">
            {group.entries[0]?.title ?? '（タイトル不明）'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {group.entries.length}件の候補 · workId: {group.entries.map((e) => e.workId).join(', ')}
          </div>
        </div>
        <span className="text-slate-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-4">
          {/* 判定根拠 */}
          {group.reasons.length > 0 && (
            <Section title="判定根拠">
              <ul className="text-xs text-slate-300 space-y-0.5 list-disc list-inside">
                {group.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          )}

          {/* 矛盾点 */}
          {group.conflicts.length > 0 && (
            <Section title="矛盾点 / 要確認">
              <ul className="text-xs text-yellow-300 space-y-0.5 list-disc list-inside">
                {group.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

          {/* 候補一覧 */}
          <Section title="候補作品">
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    {['workId', 'タイトル', '種別', '年', 'TMDb', 'ソース', '人物数', 'VOD', 'ステータス'].map((h) => (
                      <th key={h} className="text-left pb-1 pr-3 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((e) => (
                    <tr
                      key={e.workId}
                      className={`border-b border-slate-700/50 ${e.workId === group.canonicalRecommendation.recommendedWorkId ? 'text-emerald-300' : 'text-slate-300'}`}
                    >
                      <td className="py-1 pr-3 font-mono">
                        {e.workId}
                        {e.workId === group.canonicalRecommendation.recommendedWorkId && (
                          <span className="ml-1 text-[9px] text-emerald-400 font-bold">[推奨canonical]</span>
                        )}
                      </td>
                      <td className="py-1 pr-3 max-w-[200px] truncate">{e.title}</td>
                      <td className="py-1 pr-3">{e.type}</td>
                      <td className="py-1 pr-3">{e.releaseYear ?? '—'}</td>
                      <td className="py-1 pr-3">{e.tmdbId ?? '—'}</td>
                      <td className="py-1 pr-3">{e.source}</td>
                      <td className="py-1 pr-3">{e.personLinkCount}</td>
                      <td className="py-1 pr-3">{e.vodCount}</td>
                      <td className="py-1 pr-3">{e.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 統合計画（dry-run） */}
          <Section title="統合計画（dry-run / 変更なし）">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { label: '人物リンク移動', value: plan.personLinksToMove },
                { label: '人物リンク重複除去', value: plan.personLinksToDeduplicate },
                { label: 'VOD移動', value: plan.vodRecordsToMove },
                { label: 'VOD重複除去', value: plan.vodRecordsToDeduplicate },
                { label: 'redirect作成', value: plan.redirectsToCreate },
                { label: 'Redisランキング更新', value: plan.rankingEntriesToUpdate },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-700/50 rounded p-2">
                  <div className="text-slate-400">{label}</div>
                  <div className="text-white font-bold mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-yellow-400 font-medium">
              canApplyAutomatically: {plan.canApplyAutomatically ? 'true' : 'false（常に false）'}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{title}</div>
      {children}
    </div>
  );
}

// ─── メインクライアント ──────────────────────────────────────────────────────────

export default function WorkDedupClient({
  groups,
  stats,
}: {
  groups: WorkDedupGroup[];
  stats: WorkDedupStats;
}) {
  const [confidenceFilter, setConfidenceFilter] = useState<WorkDuplicateConfidence | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    let result = groups;
    if (confidenceFilter !== 'all') {
      result = result.filter((g) => g.confidence === confidenceFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((g) =>
        g.entries.some(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.workId.toLowerCase().includes(q),
        ),
      );
    }
    return result;
  }, [groups, confidenceFilter, searchQuery]);

  return (
    <div>
      <StatsBar stats={stats} />

      {/* フィルター */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setConfidenceFilter('all')}
            className={`text-xs px-2 py-1 rounded border ${confidenceFilter === 'all' ? 'bg-slate-200 text-slate-900 border-slate-300' : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'}`}
          >
            すべて ({groups.length})
          </button>
          {ALL_CONFIDENCES.map((c) => {
            const count = groups.filter((g) => g.confidence === c).length;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setConfidenceFilter(c)}
                className={`text-xs px-2 py-1 rounded border ${confidenceFilter === c ? 'bg-slate-200 text-slate-900 border-slate-300' : `${BADGE_CLASS[c]} hover:opacity-80`}`}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="タイトル・workIdで絞り込み..."
          className="text-sm bg-slate-800 border border-slate-600 rounded px-3 py-1 text-slate-200 placeholder-slate-500 flex-1 min-w-[200px]"
        />
      </div>

      {/* 件数表示 */}
      <div className="text-xs text-slate-500 mb-3">
        {filtered.length} グループ表示中 / 全{groups.length}グループ
      </div>

      {/* グループ一覧 */}
      {filtered.length === 0 ? (
        <div className="text-slate-500 text-sm py-8 text-center">
          {groups.length === 0 ? '重複候補は見つかりませんでした。' : '条件に一致するグループがありません。'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((group) => (
            <GroupCard key={group.groupId} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
