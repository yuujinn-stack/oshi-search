'use client';

import { useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';

export interface SettingsTarget {
  personName: string;
  productId: string;
}

// サーバー側(getAdminPhotobookRows)で重複統合済みの1商品(=1グループ)を表す行。
// 同一productIdが複数人物に紐づくグループ写真集も、ここでは既に1行に統合されている。
export interface AdminRow {
  personName: string;
  groupName: string;
  displayName: string;
  displayMode: 'group' | 'person';
  displayHref: string;
  linkedPersonNames: string[];
  linkedGroupNames: string[];
  gender: 'female' | 'male' | null;
  genreBucket: '女優' | 'アイドル' | '俳優' | 'その他';
  productId: string;
  title: string;
  imageUrl: string;
  price: number;
  itemUrl: string;
  affiliateUrl: string;
  status: 'auto' | 'manual_include' | 'manual_exclude';
  published: boolean;
  homeState: 'auto' | 'pinned' | 'hidden';
  homePinnedPosition: number | null;
  sortOrder: number | null;
  groupSiblingCount: number;
  groupProductIds: string[];
  settingsTargets: SettingsTarget[];
  isAutoDetected: boolean;
}

interface SearchResultItem {
  personName: string;
  category: string;
  productId: string;
  title: string;
  imageUrl: string;
  price: number;
  itemUrl: string;
}

const STATUS_LABEL: Record<AdminRow['status'], string> = {
  auto: '自動判定',
  manual_include: '手動追加',
  manual_exclude: '手動除外',
};
const STATUS_BADGE: Record<AdminRow['status'], string> = {
  auto: 'bg-gray-100 text-gray-500',
  manual_include: 'bg-green-100 text-green-700',
  manual_exclude: 'bg-red-100 text-red-600',
};

// 統合グループへの操作は、そのグループを構成する全ての(personName, productId)組へ
// 一貫して反映する（fan-out）。これにより「1人物だけ除外して残りの人物経由で
// 同じ商品が復活する」事態を防ぐ。既存のphotobook_settingsテーブル（person_name +
// product_id単位）をそのまま利用し、新しいテーブル・スキーマ変更は行わない。
async function callSettingForTargets(targets: SettingsTarget[], payload: Record<string, unknown>) {
  const results = await Promise.all(
    targets.map((t) =>
      fetch('/api/admin/photobooks/setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: t.personName, productId: t.productId, ...payload }),
      }),
    ),
  );
  if (results.some((r) => !r.ok)) throw new Error('保存に失敗しました（一部の人物への反映に失敗した可能性があります）');
}

async function callResetForTargets(targets: SettingsTarget[]) {
  const results = await Promise.all(
    targets.map((t) =>
      fetch('/api/admin/photobooks/setting', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: t.personName, productId: t.productId }),
      }),
    ),
  );
  if (results.some((r) => !r.ok)) throw new Error('リセットに失敗しました');
}

async function callSettingSingle(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/photobooks/setting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('保存に失敗しました');
  return res.json();
}

// ─── ホーム固定枠 並び替え(dnd-kit再利用) ────────────────────────────────────────
function SortablePinnedRow({ row }: { row: AdminRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.productId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-grab">
      <span className="text-gray-300 text-xs">⠿</span>
      {row.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt="" className="w-8 h-8 object-contain rounded" />
      )}
      <span className="text-xs font-semibold text-slate-700 truncate flex-1">{row.displayName}</span>
      <span className="text-[10px] text-gray-400 truncate max-w-[160px]">{row.title}</span>
    </div>
  );
}

export default function PhotobookAdminClient({ initialRows, persons }: { initialRows: AdminRow[]; persons: PersonOption[] }) {
  const [rows, setRows] = useState<AdminRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState<'all' | AdminRow['status']>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');
  const [dedupOnly, setDedupOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  function patchRow(productId: string, patch: Partial<AdminRow>) {
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, ...patch } : r)));
  }

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (genderFilter !== 'all' && r.gender !== genderFilter) return false;
      if (dedupOnly && r.groupSiblingCount <= 0) return false;
      if (q && !(r.displayName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.linkedPersonNames.some((n) => n.toLowerCase().includes(q)))) return false;
      return true;
    });
  }, [rows, statusFilter, genderFilter, dedupOnly, query]);

  const stats = useMemo(() => ({
    total: rows.length,
    auto: rows.filter((r) => r.status === 'auto' && r.isAutoDetected).length,
    manualInclude: rows.filter((r) => r.status === 'manual_include').length,
    manualExclude: rows.filter((r) => r.status === 'manual_exclude').length,
    dedupGroups: rows.filter((r) => r.groupSiblingCount > 0).length,
  }), [rows]);

  async function handleAction(row: AdminRow, action: () => Promise<unknown>, optimisticPatch: Partial<AdminRow>) {
    setBusy(row.productId);
    setError('');
    const prev = rows;
    patchRow(row.productId, optimisticPatch);
    try {
      await action();
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(null);
    }
  }

  function handleInclude(row: AdminRow) {
    void handleAction(row, () => callSettingForTargets(row.settingsTargets, { status: 'manual_include' }), { status: 'manual_include' });
  }
  function handleExclude(row: AdminRow) {
    void handleAction(row, () => callSettingForTargets(row.settingsTargets, { status: 'manual_exclude' }), { status: 'manual_exclude' });
  }
  function handleResetToAuto(row: AdminRow) {
    void handleAction(row, () => callResetForTargets(row.settingsTargets), { status: 'auto' });
  }
  function handleTogglePublished(row: AdminRow) {
    const next = !row.published;
    void handleAction(row, () => callSettingForTargets(row.settingsTargets, { published: next }), { published: next });
  }
  function handleSetHomeState(row: AdminRow, homeState: AdminRow['homeState']) {
    const homePinnedPosition = homeState === 'pinned' ? (row.homePinnedPosition ?? 0) : null;
    void handleAction(row, () => callSettingForTargets(row.settingsTargets, { homeState, homePinnedPosition }), { homeState, homePinnedPosition });
  }
  function handleSetSortOrder(row: AdminRow, value: string) {
    const n = value.trim() === '' ? null : Number(value);
    if (n !== null && !Number.isFinite(n)) return;
    void handleAction(row, () => callSettingForTargets(row.settingsTargets, { sortOrder: n }), { sortOrder: n });
  }

  // ─── ホーム固定枠の並び替え ──────────────────────────────────────────────────
  const pinnedFemale = rows.filter((r) => r.homeState === 'pinned' && r.gender === 'female' && r.published)
    .sort((a, b) => (a.homePinnedPosition ?? 0) - (b.homePinnedPosition ?? 0));
  const pinnedMale = rows.filter((r) => r.homeState === 'pinned' && r.gender === 'male' && r.published)
    .sort((a, b) => (a.homePinnedPosition ?? 0) - (b.homePinnedPosition ?? 0));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handlePinnedDragEnd(list: AdminRow[]) {
    return async (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = list.findIndex((r) => r.productId === active.id);
      const newIndex = list.findIndex((r) => r.productId === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(list, oldIndex, newIndex);
      reordered.forEach((r, i) => patchRow(r.productId, { homePinnedPosition: i }));
      try {
        await Promise.all(reordered.map((r, i) =>
          callSettingForTargets(r.settingsTargets, { homeState: 'pinned', homePinnedPosition: i }),
        ));
      } catch {
        setError('並び替えの保存に失敗しました');
      }
    };
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* 統計 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: '合計', value: stats.total },
          { label: '自動判定', value: stats.auto },
          { label: '手動追加', value: stats.manualInclude },
          { label: '手動除外', value: stats.manualExclude },
          { label: '重複統合グループ', value: stats.dedupGroups },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-black text-slate-800">{s.value}</p>
            <p className="text-[10px] text-gray-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ホーム固定枠（女性/男性） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {([['female', '女性', pinnedFemale], ['male', '男性', pinnedMale]] as const).map(([, label, list]) => (
          <div key={label} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <h3 className="text-xs font-bold text-gray-600 mb-2">ホーム固定枠（{label}）— ドラッグで並び替え</h3>
            {list.length === 0 ? (
              <p className="text-[11px] text-gray-400">固定商品はありません</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePinnedDragEnd(list)}>
                <SortableContext items={list.map((r) => r.productId)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {list.map((r) => <SortablePinnedRow key={r.productId} row={r} />)}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        ))}
      </div>

      {/* フィルタ + 追加ボタン */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="人物名・グループ名・タイトルで検索"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs min-w-[200px]"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
          <option value="all">状態: すべて</option>
          <option value="auto">自動判定</option>
          <option value="manual_include">手動追加</option>
          <option value="manual_exclude">手動除外</option>
        </select>
        <select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value as typeof genderFilter)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
          <option value="all">性別: すべて</option>
          <option value="female">女性</option>
          <option value="male">男性</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={dedupOnly} onChange={(e) => setDedupOnly(e.target.checked)} />
          統合済み（複数商品/人物をまとめた）もののみ
        </label>
        <button
          onClick={() => setShowAddModal(true)}
          className="ml-auto px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
        >
          + 写真集を追加
        </button>
      </div>

      {/* 一覧 */}
      <div className="space-y-2">
        {filteredRows.map((row) => {
          const hasSiblings = row.groupSiblingCount > 0;
          const isBusy = busy === row.productId;
          return (
            <div key={row.productId} className={`bg-white border rounded-xl p-3 ${hasSiblings ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="flex gap-3">
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="" className="w-14 h-14 object-contain rounded bg-gray-50 flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 flex items-center justify-center bg-gray-50 rounded flex-shrink-0 text-gray-300 text-xl">📷</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className="text-sm font-semibold text-slate-800">{row.displayName}</span>
                    {row.displayMode === 'group' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600" title={`紐づく人物: ${row.linkedPersonNames.join(', ')}`}>
                        グループ写真集（{row.linkedPersonNames.length}名紐付け）
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">{row.gender === 'female' ? '女性' : row.gender === 'male' ? '男性' : '性別未分類'}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600">{row.genreBucket}</span>
                    {!row.published && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">非公開</span>}
                    {hasSiblings && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">統合 {row.groupSiblingCount + 1}件</span>}
                  </div>
                  <p className="text-xs text-gray-600 truncate mb-1">{row.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                    <span>{row.price > 0 ? `¥${row.price.toLocaleString()}` : '価格未取得'}</span>
                    <a href={row.itemUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">商品URL</a>
                    {row.displayMode === 'group' && (
                      <span className="truncate max-w-[280px]">紐付け人物: {row.linkedPersonNames.join(', ')}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                {row.status !== 'manual_include' && (
                  <button disabled={isBusy} onClick={() => handleInclude(row)} className="text-[11px] px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50">手動で写真集に含める</button>
                )}
                {row.status !== 'manual_exclude' && (
                  <button disabled={isBusy} onClick={() => handleExclude(row)} className="text-[11px] px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">写真集から除外</button>
                )}
                {row.status !== 'auto' && (
                  <button disabled={isBusy} onClick={() => handleResetToAuto(row)} className="text-[11px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">自動判定に戻す</button>
                )}
                <button disabled={isBusy} onClick={() => handleTogglePublished(row)} className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50">
                  {row.published ? '非公開にする' : '公開する'}
                </button>
                <select
                  value={row.homeState}
                  disabled={isBusy}
                  onChange={(e) => handleSetHomeState(row, e.target.value as AdminRow['homeState'])}
                  className="text-[11px] border border-gray-300 rounded-lg px-1.5 py-1"
                >
                  <option value="auto">ホーム: 自動枠</option>
                  <option value="pinned">ホーム: 固定</option>
                  <option value="hidden">ホーム: 非表示</option>
                </select>
                <input
                  type="number"
                  placeholder="並び順"
                  value={row.sortOrder ?? ''}
                  disabled={isBusy}
                  onChange={(e) => handleSetSortOrder(row, e.target.value)}
                  className="w-16 text-[11px] border border-gray-300 rounded-lg px-1.5 py-1"
                />
              </div>
              {hasSiblings && (
                <p className="text-[10px] text-amber-600 mt-1.5">
                  ※ この操作は統合されている{row.groupSiblingCount + 1}件全て（{row.settingsTargets.length}件の人物×商品の組み合わせ）へ一括で反映されます。
                </p>
              )}
            </div>
          );
        })}
        {filteredRows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">条件に一致する商品がありません</p>
        )}
      </div>

      {showAddModal && (
        <AddPhotobookModal
          persons={persons}
          onClose={() => setShowAddModal(false)}
          onAdded={(row) => {
            setRows((prev) => (prev.some((r) => r.productId === row.productId) ? prev : [...prev, row]));
          }}
        />
      )}
    </div>
  );
}

// ─── 写真集を手動追加するモーダル（既存登録商品からのみ選択・外部APIは呼ばない） ──────
function AddPhotobookModal({
  persons, onClose, onAdded,
}: {
  persons: PersonOption[];
  onClose: () => void;
  onAdded: (row: AdminRow) => void;
}) {
  const [personName, setPersonName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleSearch() {
    if (!personName && !keyword.trim()) {
      setError('人物名またはキーワードのどちらかを入力してください');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (personName) params.set('personName', personName);
      if (keyword.trim()) params.set('q', keyword.trim());
      const res = await fetch(`/api/admin/photobooks/search-products?${params.toString()}`);
      const data = await res.json();
      setResults(data.items ?? []);
    } catch {
      setError('検索に失敗しました');
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(item: SearchResultItem) {
    setAddingId(item.productId);
    setError('');
    try {
      await callSettingSingle({
        personName: item.personName,
        productId: item.productId,
        sourceCategory: item.category,
        status: 'manual_include',
      });
      const person = persons.find((p) => p.name === item.personName);
      onAdded({
        personName: item.personName,
        groupName: person?.group ?? '',
        displayName: item.personName,
        displayMode: 'person',
        displayHref: `/person/${encodeURIComponent(item.personName)}`,
        linkedPersonNames: [item.personName],
        linkedGroupNames: person?.group ? [person.group] : [],
        gender: null,
        genreBucket: 'その他',
        productId: item.productId,
        title: item.title,
        imageUrl: item.imageUrl,
        price: item.price,
        itemUrl: item.itemUrl,
        affiliateUrl: '',
        status: 'manual_include',
        published: true,
        homeState: 'auto',
        homePinnedPosition: null,
        sortOrder: null,
        groupSiblingCount: 0,
        groupProductIds: [item.productId],
        settingsTargets: [{ personName: item.personName, productId: item.productId }],
        isAutoDetected: false,
      });
    } catch {
      setError('追加に失敗しました');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-800 mb-3">写真集を追加（既存登録商品から選択）</h2>
        <p className="text-[11px] text-gray-400 mb-3">
          新しく商品を取得することはできません。既に推しサーチに登録されている商品の中から選んで写真集として追加します。
        </p>
        {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</div>}

        <div className="space-y-2 mb-3">
          <PersonCombobox persons={persons} value={personName} onChange={setPersonName} allowEmpty emptyLabel="人物: 指定なし" />
          <div className="flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="商品タイトルのキーワード（任意）"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs"
            />
            <button onClick={handleSearch} disabled={searching} className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {searching ? '検索中...' : '検索'}
            </button>
          </div>
        </div>

        {results !== null && (
          <div className="space-y-1.5">
            {results.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">既存登録商品の中に一致するものが見つかりませんでした</p>
            ) : (
              results.map((item) => (
                <div key={`${item.personName}-${item.productId}`} className="flex items-center gap-2 border border-gray-200 rounded-lg p-2">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="w-10 h-10 object-contain rounded bg-gray-50 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 flex-shrink-0 bg-gray-50 rounded" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700 truncate">{item.personName} <span className="text-gray-400 font-normal">/ {item.category}</span></p>
                    <p className="text-[11px] text-gray-500 truncate">{item.title}</p>
                  </div>
                  <button
                    onClick={() => handleAdd(item)}
                    disabled={addingId === item.productId}
                    className="text-[11px] px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 flex-shrink-0"
                  >
                    {addingId === item.productId ? '追加中...' : '写真集に追加'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <button onClick={onClose} className="mt-4 w-full text-xs text-gray-500 py-2 hover:text-gray-700">閉じる</button>
      </div>
    </div>
  );
}
