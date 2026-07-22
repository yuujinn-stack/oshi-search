'use client';

import { useState, useEffect, useCallback } from 'react';
import type { WorkDedupGroup, WorkDedupStats, WorkDuplicateConfidence } from '@/lib/work-dedup';
import type { Pagination } from '@/app/api/admin/work-dedup/candidates/lib';

// ─── 型 ────────────────────────────────────────────────────────────────────────

interface ApiResponse {
  groups: WorkDedupGroup[];
  stats: WorkDedupStats;
  pagination: Pagination;
}

interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: ApiResponse }
  | { status: 'error'; code: string; httpStatus: number };

// ─── 定数 ──────────────────────────────────────────────────────────────────────

const BADGE_CLASS: Record<WorkDuplicateConfidence, string> = {
  exact:    'bg-red-900/60 text-red-200 border border-red-700',
  high:     'bg-orange-900/60 text-orange-200 border border-orange-700',
  medium:   'bg-yellow-900/60 text-yellow-200 border border-yellow-700',
  low:      'bg-slate-700 text-slate-300 border border-slate-600',
  conflict: 'bg-slate-900 text-slate-400 border border-slate-600',
};

const ALL_CONFIDENCES: WorkDuplicateConfidence[] = ['exact', 'high', 'medium', 'low', 'conflict'];

// ─── 統計バー ───────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: WorkDedupStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: '全DBレコード',   value: stats.totalWorkRecords },
        { label: 'ユニークworkId', value: stats.uniqueWorkIds },
        { label: '候補グループ数', value: stats.duplicateCandidateGroups },
        { label: '候補作品数',     value: stats.duplicateCandidateWorks },
        { label: 'exact',          value: stats.exactGroups },
        { label: 'high',           value: stats.highGroups },
        { label: 'medium',         value: stats.mediumGroups },
        { label: 'conflict',       value: stats.conflictGroups },
      ].map(({ label, value }) => (
        <div key={label} className="bg-slate-800 rounded p-3 border border-slate-700">
          <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── グループカード ─────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: WorkDedupGroup }) {
  const [open, setOpen] = useState(false);
  const plan = group.mergePlan;

  return (
    <div className="border border-slate-700 rounded-lg bg-slate-800/50 overflow-hidden">
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
            {group.entries.length}件の候補 · {group.entries.map((e) => e.workId).join(', ')}
          </div>
        </div>
        <span className="text-slate-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-4">
          {group.reasons.length > 0 && (
            <Section title="判定根拠">
              <ul className="text-xs text-slate-300 space-y-0.5 list-disc list-inside">
                {group.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          )}
          {group.conflicts.length > 0 && (
            <Section title="矛盾点 / 要確認">
              <ul className="text-xs text-yellow-300 space-y-0.5 list-disc list-inside">
                {group.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

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
                      <td className="py-1 pr-3 font-mono text-[11px] break-all">
                        {e.workId}
                        {e.workId === group.canonicalRecommendation.recommendedWorkId && (
                          <span className="ml-1 text-[9px] text-emerald-400 font-bold">[推奨canonical]</span>
                        )}
                      </td>
                      <td className="py-1 pr-3 max-w-[180px] truncate">{e.title}</td>
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

          <Section title="統合計画（dry-run / 変更なし）">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { label: '人物リンク移動',      value: plan.personLinksToMove },
                { label: '人物リンク重複除去',  value: plan.personLinksToDeduplicate },
                { label: 'VOD移動',             value: plan.vodRecordsToMove },
                { label: 'VOD重複除去',         value: plan.vodRecordsToDeduplicate },
                { label: 'redirect作成',        value: plan.redirectsToCreate },
                { label: 'Redisランキング更新', value: plan.rankingEntriesToUpdate },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-700/50 rounded p-2">
                  <div className="text-slate-400">{label}</div>
                  <div className="text-white font-bold mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-yellow-400 font-medium">
              canApplyAutomatically: false（常に false）
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

// ─── ページネーション ────────────────────────────────────────────────────────────

function PaginationBar({
  pagination,
  onPage,
}: {
  pagination: Pagination;
  onPage: (page: number) => void;
}) {
  const { page, totalPages, total, limit } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
      <span>{total === 0 ? '0件' : `${from}–${to} / ${total}件`}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 rounded border border-slate-600 disabled:opacity-30 hover:bg-slate-700 disabled:cursor-not-allowed"
        >
          ←
        </button>
        <span className="px-2 py-1">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded border border-slate-600 disabled:opacity-30 hover:bg-slate-700 disabled:cursor-not-allowed"
        >
          →
        </button>
      </div>
    </div>
  );
}

// ─── メインクライアント ──────────────────────────────────────────────────────────

export default function WorkDedupClient() {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });
  const [confidence, setConfidence] = useState<WorkDuplicateConfidence | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (confidence !== 'all') params.set('confidence', confidence);
    if (searchQuery) params.set('q', searchQuery);
    return `/api/admin/work-dedup/candidates?${params.toString()}`;
  }, [page, confidence, searchQuery]);

  const load = useCallback(async () => {
    setFetchState({ status: 'loading' });
    try {
      const res = await fetch(buildUrl(), { credentials: 'same-origin' });
      if (!res.ok) {
        let code = 'HTTP_ERROR';
        try {
          const body = (await res.json()) as ApiError;
          code = body?.error?.code ?? 'HTTP_ERROR';
        } catch { /* ignore parse error */ }
        setFetchState({ status: 'error', code, httpStatus: res.status });
        return;
      }
      const data = (await res.json()) as ApiResponse;
      setFetchState({ status: 'ok', data });
    } catch {
      setFetchState({ status: 'error', code: 'NETWORK_ERROR', httpStatus: 0 });
    }
  }, [buildUrl]);

  // マウント時・フィルタ変化時に取得
  useEffect(() => {
    load();
  }, [load]);

  // 検索は Enter またはボタン押下で確定
  function commitSearch() {
    setSearchQuery(searchInput);
    setPage(1);
  }

  function handleConfidenceChange(c: WorkDuplicateConfidence | 'all') {
    setConfidence(c);
    setPage(1);
  }

  const stats = fetchState.status === 'ok' ? fetchState.data.stats : null;
  const groups = fetchState.status === 'ok' ? fetchState.data.groups : [];
  const pagination = fetchState.status === 'ok' ? fetchState.data.pagination : null;

  return (
    <div>
      {/* ローディング */}
      {fetchState.status === 'loading' && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-500 border-t-slate-200 rounded-full" />
          重複候補を取得中...（初回は10〜30秒かかる場合があります）
        </div>
      )}

      {/* エラー */}
      {fetchState.status === 'error' && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
          <div className="text-red-300 font-semibold text-sm mb-1">重複候補の取得に失敗しました</div>
          <div className="text-xs text-red-400 mb-3">
            エラーコード: <code className="bg-red-900/50 px-1 rounded">{fetchState.code}</code>
            {fetchState.httpStatus > 0 && (
              <span className="ml-2">HTTP {fetchState.httpStatus}</span>
            )}
          </div>
          {fetchState.httpStatus === 401 || fetchState.httpStatus === 403 ? (
            <p className="text-xs text-yellow-300 mb-3">
              認証エラーです。ページを再読み込みするか、再ログインしてください。
            </p>
          ) : fetchState.code === 'NETWORK_ERROR' ? (
            <p className="text-xs text-yellow-300 mb-3">
              ネットワークエラーです。接続を確認して再試行してください。
            </p>
          ) : (
            <p className="text-xs text-yellow-300 mb-3">
              サーバーエラーが発生しました。しばらく待ってから再試行してください。
              サーバーログに詳細が記録されています。
            </p>
          )}
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-500"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* 初期表示（idle は瞬時にloadingへ遷移するため通常表示されない） */}
      {fetchState.status === 'idle' && null}

      {/* 正常データ */}
      {fetchState.status === 'ok' && (
        <>
          {stats && <StatsBar stats={stats} />}

          {/* フィルター */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <div className="flex gap-1 flex-wrap">
              {(['all', ...ALL_CONFIDENCES] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleConfidenceChange(c)}
                  className={
                    confidence === c
                      ? 'text-xs px-2 py-1 rounded border bg-slate-200 text-slate-900 border-slate-300'
                      : c === 'all'
                        ? 'text-xs px-2 py-1 rounded border bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'
                        : `text-xs px-2 py-1 rounded border ${BADGE_CLASS[c as WorkDuplicateConfidence]} hover:opacity-80`
                  }
                >
                  {c === 'all'
                    ? `すべて (${pagination?.total ?? groups.length})`
                    : `${c} (${stats ? (stats[`${c}Groups` as keyof typeof stats] as number) : 0})`}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-1 min-w-[200px]">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                placeholder="タイトル・workIdで絞り込み..."
                className="text-sm bg-slate-800 border border-slate-600 rounded-l px-3 py-1 text-slate-200 placeholder-slate-500 flex-1"
              />
              <button
                type="button"
                onClick={commitSearch}
                className="text-xs px-3 py-1 bg-slate-700 border border-slate-600 border-l-0 rounded-r text-slate-300 hover:bg-slate-600"
              >
                検索
              </button>
            </div>
          </div>

          {/* グループ一覧 */}
          {pagination && (
            <div className="text-xs text-slate-500 mb-3">
              {pagination.total === 0
                ? (searchQuery || confidence !== 'all' ? '条件に一致するグループがありません。' : '重複候補は見つかりませんでした。')
                : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} / ${pagination.total}グループ`}
            </div>
          )}

          <div className="space-y-2">
            {groups.map((group) => (
              <GroupCard key={group.groupId} group={group} />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <PaginationBar
              pagination={pagination}
              onPage={(p) => setPage(p)}
            />
          )}
        </>
      )}
    </div>
  );
}
