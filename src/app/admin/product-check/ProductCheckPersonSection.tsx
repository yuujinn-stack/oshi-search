'use client';

import { useMemo, useState, useCallback } from 'react';
import PersonProducts from './PersonProducts';
import PersonAiJudgeButton from './PersonAiJudgeButton';
import PersonRakutenFetchButton from './PersonRakutenFetchButton';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';

export interface PersonWithProductStats {
  name: string;
  group: string;
  genre?: string;
  aliases: string[];
  importedAt?: number;
  dataFetchStatus?: string;
  checkStatus: 'ok' | 'needs_fix' | 'unchecked';
  strictMode?: boolean;
  customKeywords?: string[];
  stats: {
    total: number;
    related: number;
    uncertain: number;
    unrelated: number;
    unclassified: number;
  };
  memo?: string;
  priority?: PersonPriority;
}

const STATUS_BADGE: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  needs_fix: 'bg-red-100 text-red-700',
  unchecked: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  needs_fix: '要修正',
  unchecked: '未確認',
};

const PRIORITY_BADGE: Record<PersonPriority, string> = {
  high: 'bg-red-100 text-red-700',
  normal: '',
  low: 'bg-gray-100 text-gray-500',
};
const PRIORITY_LABEL: Record<PersonPriority, string> = {
  high: '★ 優先',
  normal: '通常',
  low: '↓ 後回し',
};

const FETCH_STATUS_COLOR: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  queued: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  partial_error: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
};
const FETCH_STATUS_LABEL: Record<string, string> = {
  not_started: '未取得',
  queued: '待機中',
  processing: '取得中',
  completed: '完了',
  partial_error: '一部失敗',
  failed: '失敗',
};

type SortKey =
  | 'importedAt_desc'
  | 'importedAt_asc'
  | 'name'
  | 'related_desc'
  | 'uncertain_desc'
  | 'total_desc';

const SORT_LABELS: Record<SortKey, string> = {
  importedAt_desc: '追加日（新しい順）',
  importedAt_asc: '追加日（古い順）',
  name: '名前順',
  related_desc: '採用商品数順',
  uncertain_desc: 'AI判定待ち順',
  total_desc: '取得商品数順',
};

type StatusFilter = 'all' | 'ok' | 'needs_fix' | 'unchecked';

function sortPersons(list: PersonWithProductStats[], sort: SortKey): PersonWithProductStats[] {
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'importedAt_asc': return (a.importedAt ?? 0) - (b.importedAt ?? 0);
      case 'name': return a.name.localeCompare(b.name, 'ja');
      case 'related_desc': return b.stats.related - a.stats.related;
      case 'uncertain_desc': return b.stats.uncertain - a.stats.uncertain;
      case 'total_desc': return b.stats.total - a.stats.total;
      default: return (b.importedAt ?? 0) - (a.importedAt ?? 0); // importedAt_desc
    }
  });
}

const RECENT_DAYS = 30;

// ─── 人物カード（メモ・優先度編集含む）────────────────────────────────────────
function PersonProductCard({ p }: { p: PersonWithProductStats }) {
  const [metaOpen, setMetaOpen] = useState(false);
  const [editMemo, setEditMemo] = useState(p.memo ?? '');
  const [editPriority, setEditPriority] = useState<PersonPriority>(p.priority ?? 'normal');
  const [currentMemo, setCurrentMemo] = useState(p.memo ?? '');
  const [currentPriority, setCurrentPriority] = useState<PersonPriority>(p.priority ?? 'normal');
  const [metaSaving, setMetaSaving] = useState(false);

  const handleMetaSave = useCallback(async () => {
    setMetaSaving(true);
    try {
      await fetch('/api/admin/person-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: p.name, memo: editMemo, priority: editPriority }),
      });
      setCurrentMemo(editMemo);
      setCurrentPriority(editPriority);
      setMetaOpen(false);
    } finally {
      setMetaSaving(false);
    }
  }, [p.name, editMemo, editPriority]);

  const status = p.checkStatus ?? 'unchecked';

  return (
    <div>
      {/* 人物ヘッダー */}
      <div className="px-4 py-2 bg-gray-50 border border-b-0 border-gray-200 rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 名前・グループ・ジャンル */}
          <span className="font-medium text-slate-800 text-sm">{p.name}</span>
          {p.group && <span className="text-xs text-gray-400">{p.group}</span>}
          {p.genre && (
            <span className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded-full">
              {p.genre}
            </span>
          )}

          {/* 優先度バッジ */}
          {currentPriority !== 'normal' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[currentPriority]}`}>
              {PRIORITY_LABEL[currentPriority]}
            </span>
          )}

          {/* 設定バッジ */}
          {p.strictMode && (
            <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full">
              strict
            </span>
          )}
          {p.customKeywords && p.customKeywords.length > 0 && (
            <span className="text-xs text-indigo-500 truncate max-w-[120px]">
              +{p.customKeywords.join(', ')}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
            {/* クイック導線 */}
            <a
              href={`/admin/work-check?person=${encodeURIComponent(p.name)}`}
              className="text-[10px] text-indigo-400 hover:text-indigo-600 hover:underline whitespace-nowrap"
              title="出演作品管理へ"
            >
              作品管理
            </a>
            <a
              href={`/person/${encodeURIComponent(p.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline whitespace-nowrap"
              title="公開ページを新しいタブで開く"
            >
              公開ページ↗
            </a>

            {/* メモ・優先度編集ボタン */}
            <button
              onClick={() => setMetaOpen((v) => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 hover:border-gray-300 whitespace-nowrap"
            >
              {metaOpen ? '▲' : 'メモ/優先'}
            </button>

            <PersonRakutenFetchButton personName={p.name} />
            <PersonAiJudgeButton personName={p.name} />
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>

        {/* 統計バー */}
        {p.stats.total > 0 && (
          <div className="flex gap-3 mt-1 text-xs">
            <span className="text-gray-500">取得 {p.stats.total}件</span>
            <span className="text-green-600">related {p.stats.related}</span>
            <span className="text-yellow-600">uncertain {p.stats.uncertain}</span>
            <span className="text-red-500">unrelated {p.stats.unrelated}</span>
            {p.stats.unclassified > 0 && (
              <span className="text-gray-400">未判定 {p.stats.unclassified}</span>
            )}
          </div>
        )}

        {/* メモ表示（編集非表示時） */}
        {currentMemo && !metaOpen && (
          <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-sm">{currentMemo}</p>
        )}

        {/* メモ・優先度編集フォーム */}
        {metaOpen && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value as PersonPriority)}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300"
            >
              <option value="high">★ 優先</option>
              <option value="normal">通常</option>
              <option value="low">↓ 後回し</option>
            </select>
            <input
              type="text"
              value={editMemo}
              onChange={(e) => setEditMemo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleMetaSave(); }}
              placeholder="メモを入力..."
              className="flex-1 min-w-[140px] text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <button
              onClick={handleMetaSave}
              disabled={metaSaving}
              className="text-xs px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {metaSaving ? '保存中' : '保存'}
            </button>
            <button
              onClick={() => setMetaOpen(false)}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>

      {/* 商品パネル（既存コンポーネント） */}
      <PersonProducts personName={p.name} />
    </div>
  );
}

// ─── メインセクション ─────────────────────────────────────────────────────────
interface Props {
  persons: PersonWithProductStats[];
}

export default function ProductCheckPersonSection({ persons }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('importedAt_desc');
  const [recentOpen, setRecentOpen] = useState(true);

  const groups = useMemo(
    () => Array.from(new Set(persons.map((p) => p.group).filter(Boolean))).sort(),
    [persons],
  );
  const genres = useMemo(
    () => Array.from(new Set(persons.map((p) => p.genre).filter(Boolean) as string[])).sort(),
    [persons],
  );

  const recentPersons = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return persons
      .filter((p) => (p.importedAt ?? 0) > cutoff)
      .sort((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0))
      .slice(0, 8);
  }, [persons]);

  const filtered = useMemo(() => {
    let list = persons;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          (p.genre ?? '').toLowerCase().includes(q) ||
          (p.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
      );
    }

    if (groupFilter) list = list.filter((p) => p.group === groupFilter);
    if (genreFilter) list = list.filter((p) => p.genre === genreFilter);
    if (statusFilter !== 'all') list = list.filter((p) => p.checkStatus === statusFilter);

    return sortPersons(list, sort);
  }, [persons, searchQuery, groupFilter, genreFilter, statusFilter, sort]);

  const isFiltered = !!searchQuery.trim() || !!groupFilter || !!genreFilter || statusFilter !== 'all';

  function clearAll() {
    setSearchQuery('');
    setGroupFilter('');
    setGenreFilter('');
    setStatusFilter('all');
  }

  // ダッシュボード集計
  const totalRelated = persons.reduce((sum, p) => sum + p.stats.related, 0);
  const totalUncertain = persons.reduce((sum, p) => sum + p.stats.uncertain, 0);
  const totalProducts = persons.reduce((sum, p) => sum + p.stats.total, 0);

  return (
    <div className="space-y-4">
      {/* ダッシュボードカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '登録人物数', value: persons.length, color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
          { label: '取得商品総数', value: totalProducts, color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
          { label: 'related（採用）', value: totalRelated, color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
          {
            label: 'AI判定待ち',
            value: totalUncertain,
            color: totalUncertain > 0 ? 'text-amber-700' : 'text-gray-400',
            bg: totalUncertain > 0 ? 'bg-amber-50' : 'bg-gray-50',
            border: totalUncertain > 0 ? 'border-amber-200' : 'border-gray-200',
          },
        ].map((card) => (
          <div key={card.label} className={`flex flex-col items-center p-2.5 rounded-lg border text-center ${card.bg} ${card.border}`}>
            <span className={`text-xl font-bold tabular-nums ${card.color}`}>{card.value}</span>
            <span className="text-[10px] text-gray-500 mt-0.5 leading-tight">{card.label}</span>
          </div>
        ))}
      </div>

      {/* 最近追加セクション */}
      {recentPersons.length > 0 && (
        <div className="border border-indigo-100 rounded-xl overflow-hidden">
          <button
            onClick={() => setRecentOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-indigo-50 text-left"
          >
            <span className="text-xs font-semibold text-indigo-700">
              最近追加（{RECENT_DAYS}日以内）― {recentPersons.length}人
            </span>
            <span className="text-indigo-400 text-xs">{recentOpen ? '▲' : '▼'}</span>
          </button>
          {recentOpen && (
            <div className="px-4 py-3 bg-white flex flex-wrap gap-2">
              {recentPersons.map((p) => {
                const sk = p.dataFetchStatus ?? 'not_started';
                return (
                  <div
                    key={p.name}
                    className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-gray-50"
                  >
                    <span className="font-medium text-slate-700">{p.name}</span>
                    {p.group && <span className="text-gray-400">{p.group}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${FETCH_STATUS_COLOR[sk] ?? 'bg-gray-100 text-gray-500'}`}>
                      {FETCH_STATUS_LABEL[sk] ?? sk}
                    </span>
                    {p.importedAt && (
                      <span className="text-gray-400">
                        {new Date(p.importedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 検索・フィルターバー */}
      <div className="space-y-2">
        {/* 行1: 検索・グループ・ジャンル・ソート */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* テキスト検索 */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="名前・グループ・別名・ジャンルで検索..."
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 pl-7 w-56 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300 text-[10px]">🔍</span>
          </div>

          {/* グループフィルター */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="">全グループ</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          {/* ジャンルフィルター（ピル） */}
          {genres.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {genres.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenreFilter(genreFilter === g ? '' : g)}
                  className={`text-[11px] px-2 py-1 rounded-full transition-colors ${
                    genreFilter === g
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          {/* ソート */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-300 ml-auto"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>{SORT_LABELS[key]}</option>
            ))}
          </select>
        </div>

        {/* 行2: ステータスフィルター */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-gray-400 shrink-0">確認状態:</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              { key: 'all' as StatusFilter, label: '全て' },
              { key: 'unchecked' as StatusFilter, label: STATUS_LABEL.unchecked },
              { key: 'needs_fix' as StatusFilter, label: STATUS_LABEL.needs_fix },
              { key: 'ok' as StatusFilter, label: STATUS_LABEL.ok },
            ]).map(({ key, label }, i) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-2.5 py-1.5 text-[11px] ${i > 0 ? 'border-l border-gray-200' : ''} ${
                  statusFilter === key
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isFiltered && (
            <>
              <button
                onClick={clearAll}
                className="text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded border border-gray-200 hover:border-gray-300"
              >
                クリア
              </button>
              <span className="text-gray-400 ml-auto shrink-0">
                {filtered.length} / {persons.length} 人
              </span>
            </>
          )}
        </div>
      </div>

      {/* 人物リスト */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">条件に一致する人物がいません</p>
        ) : (
          filtered.map((p) => <PersonProductCard key={p.name} p={p} />)
        )}
      </div>
    </div>
  );
}
