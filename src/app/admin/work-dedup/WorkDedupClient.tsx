'use client';

import { useState, useEffect, useCallback, useId } from 'react';
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

// ─── 信頼度バッジ定義（WCAG AA 相当のコントラスト確保） ──────────────────────────

const CONFIDENCE_BADGE: Record<WorkDuplicateConfidence, { bg: string; text: string; label: string }> = {
  exact:    { bg: 'bg-red-800',    text: 'text-red-100',    label: 'EXACT'    },
  high:     { bg: 'bg-orange-800', text: 'text-orange-100', label: 'HIGH'     },
  medium:   { bg: 'bg-yellow-700', text: 'text-yellow-50',  label: 'MEDIUM'   },
  low:      { bg: 'bg-slate-600',  text: 'text-slate-100',  label: 'LOW'      },
  conflict: { bg: 'bg-slate-700',  text: 'text-slate-200',  label: 'CONFLICT' },
};

const CONFIDENCE_BORDER: Record<WorkDuplicateConfidence, string> = {
  exact:    'border-red-700',
  high:     'border-orange-700',
  medium:   'border-yellow-600',
  low:      'border-slate-500',
  conflict: 'border-slate-600',
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
        <div key={label} className="bg-slate-800 rounded p-3 border border-slate-600">
          <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
          <div className="text-xs text-slate-300 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── セクション見出し ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── グループカード ─────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: WorkDedupGroup }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const plan = group.mergePlan;
  const badge = CONFIDENCE_BADGE[group.confidence];

  return (
    <div className={`border rounded-lg bg-slate-800 overflow-hidden ${CONFIDENCE_BORDER[group.confidence]}`}>
      {/* ヘッダー（折りたたみボタン） */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400"
      >
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${badge.bg} ${badge.text}`}
          aria-label={`信頼度: ${group.confidence}`}
        >
          {badge.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm truncate">
            {group.entries[0]?.title ?? '（タイトル不明）'}
          </div>
          <div className="text-xs text-slate-300 mt-0.5">
            {group.entries.length}件の候補 ·{' '}
            {group.entries.map((e) => e.workId).join(', ')}
          </div>
        </div>
        <span className="text-slate-300 text-sm mt-0.5" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* 展開コンテンツ */}
      {open && (
        <div
          id={detailId}
          className="px-4 pb-5 border-t border-slate-600 pt-4 space-y-5"
        >
          {/* 判定根拠 */}
          {group.reasons.length > 0 && (
            <Section title="判定根拠">
              <ul className="text-sm text-slate-100 space-y-1 list-disc list-inside">
                {group.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          )}

          {/* 矛盾点 */}
          {group.conflicts.length > 0 && (
            <Section title="矛盾点 / 要確認">
              <ul className="text-sm text-yellow-200 space-y-1 list-disc list-inside">
                {group.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

          {/* 候補作品比較表 */}
          <Section title="候補作品">
            <div className="overflow-x-auto rounded border border-slate-600">
              <table className="text-xs w-full min-w-[600px]">
                <thead className="bg-slate-700">
                  <tr className="border-b border-slate-600">
                    {['workId', 'タイトル', '種別', '年', 'TMDb', 'ソース', '人物数', 'VOD', 'ステータス'].map((h) => (
                      <th key={h} className="text-left py-2 px-3 font-semibold text-slate-200 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {group.entries.map((e) => {
                    const isCanonical = e.workId === group.canonicalRecommendation.recommendedWorkId;
                    return (
                      <tr
                        key={e.workId}
                        className={isCanonical ? 'bg-emerald-900/50' : ''}
                      >
                        <td className="py-2 px-3 font-mono text-[11px] break-all text-slate-100">
                          {e.workId}
                          {isCanonical && (
                            <span className="ml-1.5 inline-block text-[9px] bg-emerald-700 text-emerald-100 px-1 py-0.5 rounded font-bold align-middle whitespace-nowrap">
                              推奨canonical候補
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 max-w-[180px] text-slate-100 truncate">{e.title}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.type}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.releaseYear ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.tmdbId ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{e.source}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.personLinkCount}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.vodCount}</td>
                        <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{e.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 統合計画（dry-run） */}
          <Section title="統合計画（dry-run / DB・Redis変更なし）">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { label: '人物リンク移動',      value: plan.personLinksToMove },
                { label: '人物リンク重複除去',  value: plan.personLinksToDeduplicate },
                { label: 'VOD移動',             value: plan.vodRecordsToMove },
                { label: 'VOD重複除去',         value: plan.vodRecordsToDeduplicate },
                { label: 'redirect作成',        value: plan.redirectsToCreate },
                { label: 'Redisランキング更新', value: plan.rankingEntriesToUpdate },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-700 rounded p-2 border border-slate-600">
                  <div className="text-slate-300">{label}</div>
                  <div className="text-white font-bold text-sm mt-0.5">{value}</div>
                </div>
              ))}
            </div>

            {/* 自動統合不可バッジ */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 bg-slate-600 border border-slate-400 text-white text-xs font-bold px-2 py-1 rounded">
                🚫 自動統合不可
              </span>
              <span className="text-slate-300 text-xs">
                canApplyAutomatically: false（このUIからの統合・DB変更は行いません）
              </span>
            </div>
          </Section>
        </div>
      )}
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
    <nav aria-label="ページネーション" className="flex items-center justify-between mt-4 text-xs text-slate-300">
      <span>{total === 0 ? '0件' : `${from}–${to} / ${total}件`}</span>
      <div className="flex gap-1 items-center">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="前のページ"
          className="px-2 py-1 rounded border border-slate-500 text-slate-200 disabled:opacity-40 hover:bg-slate-700 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          ←
        </button>
        <span className="px-3 py-1 text-slate-200">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="次のページ"
          className="px-2 py-1 rounded border border-slate-500 text-slate-200 disabled:opacity-40 hover:bg-slate-700 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          →
        </button>
      </div>
    </nav>
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
        } catch { /* ignore */ }
        setFetchState({ status: 'error', code, httpStatus: res.status });
        return;
      }
      const data = (await res.json()) as ApiResponse;
      setFetchState({ status: 'ok', data });
    } catch {
      setFetchState({ status: 'error', code: 'NETWORK_ERROR', httpStatus: 0 });
    }
  }, [buildUrl]);

  useEffect(() => { load(); }, [load]);

  function commitSearch() {
    setSearchQuery(searchInput);
    setPage(1);
  }

  function handleConfidenceChange(c: WorkDuplicateConfidence | 'all') {
    setConfidence(c);
    setPage(1);
  }

  const stats      = fetchState.status === 'ok' ? fetchState.data.stats      : null;
  const groups     = fetchState.status === 'ok' ? fetchState.data.groups     : [];
  const pagination = fetchState.status === 'ok' ? fetchState.data.pagination : null;

  return (
    <div>
      {/* ローディング */}
      {fetchState.status === 'loading' && (
        <div className="flex items-center gap-3 text-slate-200 text-sm py-10">
          <span
            className="animate-spin inline-block w-5 h-5 border-2 border-slate-500 border-t-white rounded-full"
            aria-hidden="true"
          />
          重複候補を取得中…（初回は10〜30秒かかる場合があります）
        </div>
      )}

      {/* エラー */}
      {fetchState.status === 'error' && (
        <div role="alert" className="bg-red-950 border border-red-600 rounded-lg p-4 mb-4">
          <div className="text-red-200 font-semibold text-sm mb-1">重複候補の取得に失敗しました</div>
          <div className="text-xs text-red-300 mb-3">
            エラーコード: <code className="bg-red-900 text-red-100 px-1 rounded">{fetchState.code}</code>
            {fetchState.httpStatus > 0 && (
              <span className="ml-2 text-red-300">HTTP {fetchState.httpStatus}</span>
            )}
          </div>
          {(fetchState.httpStatus === 401 || fetchState.httpStatus === 403) ? (
            <p className="text-xs text-yellow-200 mb-3">
              認証エラーです。ページを再読み込みするか、再ログインしてください。
            </p>
          ) : fetchState.code === 'NETWORK_ERROR' ? (
            <p className="text-xs text-yellow-200 mb-3">
              ネットワークエラーです。接続を確認して再試行してください。
            </p>
          ) : (
            <p className="text-xs text-yellow-200 mb-3">
              サーバーエラーが発生しました。しばらく待ってから再試行してください。
              （サーバーログに詳細が記録されています）
            </p>
          )}
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* 正常データ */}
      {fetchState.status === 'ok' && (
        <>
          {stats && <StatsBar stats={stats} />}

          {/* フィルターバー */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <div className="flex gap-1 flex-wrap" role="group" aria-label="信頼度フィルター">
              {(['all', ...ALL_CONFIDENCES] as const).map((c) => {
                const isActive = confidence === c;
                const count = c === 'all'
                  ? (pagination?.total ?? groups.length)
                  : (stats ? (stats[`${c}Groups` as keyof typeof stats] as number) : 0);

                if (c === 'all') {
                  return (
                    <button
                      key="all"
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => handleConfidenceChange('all')}
                      className={`text-xs px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                        isActive
                          ? 'bg-white text-slate-900 border-white font-semibold'
                          : 'bg-slate-800 text-slate-200 border-slate-500 hover:bg-slate-700'
                      }`}
                    >
                      すべて ({count})
                    </button>
                  );
                }

                const b = CONFIDENCE_BADGE[c];
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleConfidenceChange(c)}
                    className={`text-xs px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                      isActive
                        ? 'bg-white text-slate-900 border-white font-semibold'
                        : `${b.bg} ${b.text} border-transparent hover:opacity-90`
                    }`}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>

            {/* 検索 */}
            <div className="flex flex-1 min-w-[200px]">
              <label htmlFor="dedup-search" className="sr-only">タイトル・workIdで絞り込み</label>
              <input
                id="dedup-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                placeholder="タイトル・workIdで絞り込み..."
                className="text-sm bg-slate-800 border border-slate-500 rounded-l px-3 py-1 text-white placeholder-slate-400 flex-1 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
              />
              <button
                type="button"
                onClick={commitSearch}
                className="text-xs px-3 py-1 bg-slate-700 border border-slate-500 border-l-0 rounded-r text-slate-200 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                検索
              </button>
            </div>
          </div>

          {/* 件数表示 */}
          {pagination && (
            <div className="text-xs text-slate-300 mb-3" aria-live="polite">
              {pagination.total === 0
                ? (searchQuery || confidence !== 'all'
                    ? '条件に一致するグループがありません。'
                    : '重複候補は見つかりませんでした。')
                : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} / ${pagination.total}グループ`}
            </div>
          )}

          {/* グループ一覧 */}
          <div className="space-y-2">
            {groups.map((group) => (
              <GroupCard key={group.groupId} group={group} />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <PaginationBar pagination={pagination} onPage={setPage} />
          )}
        </>
      )}
    </div>
  );
}
