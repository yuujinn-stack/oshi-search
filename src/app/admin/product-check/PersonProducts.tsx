'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RakutenItem } from '@/types/rakuten';
import type { JudgmentRecord, Verdict } from '@/lib/judgment-store';
import type { ProductCategory } from '@/types/person';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import ManualProductModal from './ManualProductModal';
import type { PersonOption } from '@/components/admin/PersonCombobox';

interface ProductData {
  status: string;
  products: RakutenItem[];
}

interface AdminData {
  person: { name: string; group: string; config: { strictMode?: boolean } };
  categories: Record<string, ProductData>;
  verdicts: Record<string, JudgmentRecord>;
}

interface SearchTestItem {
  title: string;
  author?: string;
  artistName?: string;
  itemUrl: string;
  price: number;
}

interface SearchTestResult {
  keyword: string;
  paramType: string;
  api: string;
  count: number;
  items: SearchTestItem[];
  error?: string;
}

interface SearchTestData {
  person: { name: string; group: string };
  searches: SearchTestResult[];
  summary: { totalSearches: number; withResults: number; apiErrors: number };
}

const VERDICT_BADGE: Record<Verdict, string> = {
  related: 'bg-green-100 text-green-700',
  uncertain: 'bg-yellow-100 text-yellow-700',
  unrelated: 'bg-red-100 text-red-700',
  deleted: 'bg-gray-200 text-gray-400',
};
const VERDICT_LABEL: Record<Verdict, string> = {
  related: '関連あり',
  uncertain: 'AI判定待ち',
  unrelated: '非表示',
  deleted: '削除済み',
};
const SOURCE_ICON: Record<string, string> = {
  auto: '⚙️',
  ai: '🤖',
  manual: '👤',
};

const CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'] as const;

// Product with category label and verdict attached
type ProductWithMeta = RakutenItem & {
  catLabel: ProductCategory;
  judgment: JudgmentRecord | undefined;
};

// Apply saved display order to a list; unlisted items come last
function applyDisplayOrder<T extends { id: string }>(items: T[], savedOrder: string[]): T[] {
  if (savedOrder.length === 0) return items;
  const added = new Set<string>();
  const inOrder: T[] = [];
  for (const id of savedOrder) {
    const item = items.find((x) => x.id === id);
    if (item && !added.has(item.id)) { inOrder.push(item); added.add(item.id); }
  }
  const rest = items.filter((x) => !added.has(x.id));
  return [...inOrder, ...rest];
}

// ─── SortableProductCard ────────────────────────────────────────────────────

interface SortableCardProps {
  p: ProductWithMeta;
  sortMode: boolean;
  selectedIds: Set<string>;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onMouseEnter: (id: string) => void;
  onVerdict: (id: string, verdict: Verdict, score: number) => void;
  onDeleteVerdict: (id: string) => void;
  onConfirmDelete: (ids: string[]) => void;
  onEdit: (p: ProductWithMeta) => void;
}

function SortableProductCard({
  p, sortMode, selectedIds,
  onMouseDown, onMouseEnter,
  onVerdict, onDeleteVerdict, onConfirmDelete, onEdit,
}: SortableCardProps) {
  const {
    listeners, attributes,
    setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({
    id: p.id,
    disabled: !sortMode,
    data: { category: p.catLabel },
  });

  const isChecked = selectedIds.has(p.id);
  const isShown = p.judgment?.verdict === 'related';
  const isHidden = p.judgment?.verdict === 'unrelated';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`flex items-start gap-2 p-2.5 rounded-lg text-xs border transition-colors cursor-default ${
        isChecked
          ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-300'
          : isShown
          ? 'border-green-100 bg-green-50/50'
          : isHidden
          ? 'border-red-100 bg-red-50/30 opacity-60'
          : 'border-yellow-100 bg-yellow-50/50'
      }`}
      onMouseDown={sortMode ? undefined : (e) => onMouseDown(p.id, e)}
      onMouseEnter={sortMode ? undefined : () => onMouseEnter(p.id)}
    >
      {/* DnD drag handle */}
      {sortMode && (
        <div
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none flex items-center self-stretch pr-1 shrink-0 touch-none"
          title="ドラッグして並び替え"
        >
          ☰
        </div>
      )}

      {/* Checkbox (non-sort mode only) */}
      {!sortMode && (
        <input
          type="checkbox"
          readOnly
          checked={isChecked}
          className="mt-1 w-3.5 h-3.5 flex-shrink-0 accent-slate-600"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Thumbnail */}
      {p.imageUrl && (
        <img src={p.imageUrl} alt="" className="w-9 h-11 object-cover rounded flex-shrink-0" />
      )}

      {/* Product info */}
      <div className="flex-1 min-w-0">
        <p className="line-clamp-2 text-slate-700 font-medium leading-tight">{p.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-gray-400">{p.catLabel}</span>
          <span className="font-mono text-gray-400">score {p.relevanceScore}</span>
          {p.judgment ? (
            p.judgment.verdict === 'uncertain' && p.judgment.reason?.startsWith('卒業後グループ商品候補') ? (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                🎓 {p.judgment.reason}
              </span>
            ) : (
              <span className={`px-1.5 py-0.5 rounded ${VERDICT_BADGE[p.judgment.verdict] ?? 'bg-gray-100 text-gray-500'}`}>
                {SOURCE_ICON[p.judgment.source]} {VERDICT_LABEL[p.judgment.verdict] ?? p.judgment.verdict}
                {p.judgment.reason ? ` — ${p.judgment.reason}` : ''}
              </span>
            )
          ) : (
            <span className="text-gray-400 italic">未判定</span>
          )}
        </div>
      </div>

      {/* Verdict buttons (non-sort mode only) */}
      {!sortMode && (
        <div className="flex flex-col gap-1 flex-shrink-0">
          {p.id.startsWith('mn-') && (
            <button
              onClick={() => onEdit(p)}
              className="text-xs px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
            >
              編集
            </button>
          )}
          <button
            onClick={() => onVerdict(p.id, 'related', p.relevanceScore)}
            disabled={p.judgment?.verdict === 'related'}
            className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
          >
            採用
          </button>
          <button
            onClick={() => onVerdict(p.id, 'unrelated', p.relevanceScore)}
            disabled={p.judgment?.verdict === 'unrelated'}
            className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40"
          >
            非表示
          </button>
          {p.judgment && (
            <button
              onClick={() => onDeleteVerdict(p.id)}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
            >
              リセット
            </button>
          )}
          <button
            onClick={() => onConfirmDelete([p.id])}
            className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function PersonProducts({
  personName,
  allPersons = [],
  personGroup,
}: {
  personName: string;
  allPersons?: PersonOption[];
  personGroup?: string;
}) {
  type Filter = 'uncertain' | 'all' | 'unrelated';

  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('uncertain');
  const [message, setMessage] = useState('');
  const [searchTest, setSearchTest] = useState<SearchTestData | null>(null);
  const [searchTestLoading, setSearchTestLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'single' | 'selected' | 'hidden';
    ids: string[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<(RakutenItem & { catLabel: ProductCategory }) | null>(null);

  // ─── Sort mode state ────────────────────────────────────────────────────
  const [sortMode, setSortMode] = useState(false);
  const [displayOrders, setDisplayOrders] = useState<Record<string, string[]>>({});
  const [sortSaving, setSortSaving] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Load display orders from Redis whenever data is loaded
  useEffect(() => {
    if (!data) return;
    fetch(`/api/admin/product-order?person=${encodeURIComponent(personName)}`)
      .then((r) => r.json())
      .then(({ orders }) => setDisplayOrders(orders ?? {}))
      .catch(() => {});
  }, [data, personName]);

  // Products for sort mode: only `related`, grouped by category, ordered
  const sortedByCategory = useMemo(() => {
    if (!data) return null;
    return CATEGORIES.map((cat) => {
      const catProducts = (data.categories[cat]?.products ?? [])
        .filter((p) => data.verdicts[p.id]?.verdict === 'related')
        .map((p) => ({
          ...p,
          catLabel: cat as ProductCategory,
          judgment: data.verdicts[p.id],
        }));
      const ordered = applyDisplayOrder(catProducts, displayOrders[cat] ?? []);
      return { cat, products: ordered };
    }).filter(({ products }) => products.length > 0);
  }, [data, displayOrders]);

  // DnD drag end handler
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const category = active.data.current?.category as string;
    const overCategory = (over.data.current as { category?: string } | undefined)?.category;
    if (!category || category !== overCategory) return;

    const group = sortedByCategory?.find((g) => g.cat === category);
    if (!group) return;

    const oldIndex = group.products.findIndex((p) => p.id === active.id);
    const newIndex = group.products.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(group.products, oldIndex, newIndex).map((p) => p.id);
    setDisplayOrders((prev) => ({ ...prev, [category]: newOrder }));

    // Auto-save
    setSortSaving(category);
    fetch('/api/admin/product-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, category, order: newOrder }),
    }).finally(() => setSortSaving(null));
  }

  async function handleResetOrder(category: string) {
    setDisplayOrders((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
    await fetch('/api/admin/product-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, category, order: [] }),
    });
  }

  // ─── Filtered product list (non-sort mode) ───────────────────────────────
  const filteredProductList = useMemo(() => {
    if (!data) return [];
    return CATEGORIES.flatMap((cat) => {
      const catData = data.categories[cat];
      if (!catData || catData.status !== 'ok') return [];
      return catData.products
        .map((p) => ({ ...p, catLabel: cat as ProductCategory, judgment: data.verdicts[p.id] }))
        .filter((p) => {
          if (p.judgment?.verdict === 'deleted') return false;
          if (filter === 'uncertain') return p.judgment?.verdict === 'uncertain';
          if (filter === 'unrelated') return p.judgment?.verdict === 'unrelated';
          return true;
        });
    });
  }, [data, filter]);

  const filteredProductIds = useMemo(
    () => filteredProductList.map((p) => p.id),
    [filteredProductList],
  );

  // ─── Bulk selection ──────────────────────────────────────────────────────
  const {
    selectedIds,
    isDragging,
    handleCardMouseDown,
    handleCardMouseEnter,
    toggleSelectAll,
    clearSelection,
  } = useBulkSelection(filteredProductIds);

  useEffect(() => { clearSelection(); }, [filter, clearSelection]);

  const selectedInView = filteredProductIds.filter((id) => selectedIds.has(id));

  // ─── Data fetch ──────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    setMessage('');
    const res = await fetch(`/api/admin/products?person=${encodeURIComponent(personName)}`);
    if (res.ok) {
      setData(await res.json());
    } else {
      setMessage('取得に失敗しました');
    }
    setLoading(false);
  }

  async function handleOpen() {
    if (!open && !data) await load();
    setOpen((v) => !v);
  }

  // ─── Verdict handlers ────────────────────────────────────────────────────
  async function handleVerdict(productId: string, verdict: Verdict, score: number) {
    const res = await fetch('/api/admin/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId, verdict, score }),
    });
    if (res.ok) await load();
  }

  async function handleDeleteVerdict(productId: string) {
    const res = await fetch('/api/admin/verdict', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId }),
    });
    if (res.ok) await load();
  }

  async function handleBulkVerdict(verdict: 'related' | 'unrelated') {
    if (selectedInView.length === 0 || bulkProcessing) return;
    setBulkProcessing(true);
    setMessage('');
    const res = await fetch('/api/admin/verdict-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productIds: selectedInView, verdict, score: 0 }),
    });
    if (res.ok) {
      const label = verdict === 'related' ? '採用' : '非表示';
      setMessage(`${selectedInView.length}件を${label}にしました`);
      clearSelection();
      await load();
    } else {
      setMessage('一括判定に失敗しました');
    }
    setBulkProcessing(false);
  }

  async function handleSearchTest() {
    setSearchTestLoading(true);
    setSearchTest(null);
    const res = await fetch(`/api/admin/search-test?person=${encodeURIComponent(personName)}`);
    if (res.ok) {
      setSearchTest(await res.json());
    } else {
      setMessage('検索テスト失敗');
    }
    setSearchTestLoading(false);
  }

  async function executeDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/admin/product-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName, productIds: confirmDelete.ids }),
      });
      if (res.ok) {
        setConfirmDelete(null);
        clearSelection();
        await load();
      } else {
        setMessage('削除に失敗しました');
        setConfirmDelete(null);
      }
    } catch {
      setMessage('通信エラーが発生しました');
      setConfirmDelete(null);
    }
    setDeleting(false);
  }

  const uncertainCount = data
    ? Object.values(data.verdicts).filter((v) => v.verdict === 'uncertain').length
    : 0;

  const allSelected =
    filteredProductIds.length > 0 &&
    filteredProductIds.every((id) => selectedIds.has(id));

  return (
    <div
      className="border border-gray-200 rounded-xl overflow-hidden"
      style={{ userSelect: isDragging ? 'none' : undefined }}
    >
      {/* Header row */}
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-medium text-slate-700">{personName}</span>
        <div className="flex items-center gap-2">
          {data && uncertainCount > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
              AI判定待ち {uncertainCount}件
            </span>
          )}
          <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '更新中...' : '再読み込み'}
            </button>
            <button
              onClick={handleSearchTest}
              disabled={searchTestLoading}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-50"
              title="楽天APIを複数キーワードで実行して取得漏れを診断（Redis保存なし）"
            >
              {searchTestLoading ? '検索中...' : '🔍 検索テスト'}
            </button>
            <button
              onClick={() => { setEditingProduct(null); setManualModalOpen(true); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors font-medium"
            >
              ＋ 商品を追加
            </button>

            {/* Sort mode toggle */}
            <button
              onClick={() => setSortMode((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                sortMode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
              }`}
              title="採用済み商品の表示順を変更します"
            >
              {sortMode ? '✓ 並び替えモード中' : '☰ 並び替え'}
            </button>

            {/* Filter (non-sort mode only) */}
            {!sortMode && (
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-auto">
                <button
                  onClick={() => setFilter('uncertain')}
                  className={`px-3 py-1.5 ${filter === 'uncertain' ? 'bg-yellow-50 text-yellow-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  AI判定待ちのみ
                </button>
                <button
                  onClick={() => setFilter('unrelated')}
                  className={`px-3 py-1.5 border-l border-gray-200 ${filter === 'unrelated' ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  非表示のみ
                </button>
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1.5 border-l border-gray-200 ${filter === 'all' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  全商品
                </button>
              </div>
            )}

            {message && <span className="text-xs text-green-600">{message}</span>}
          </div>

          {/* Search test results (unchanged) */}
          {searchTest && (
            <div className="border border-blue-100 rounded-xl bg-blue-50/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-blue-800">
                  🔍 検索テスト結果（楽天API実行 / Redis保存なし）
                </p>
                <div className="text-xs text-blue-600">
                  {searchTest.summary.totalSearches}種 / ヒット{searchTest.summary.withResults}種
                  {searchTest.summary.apiErrors > 0 && (
                    <span className="text-red-500 ml-2">エラー{searchTest.summary.apiErrors}件</span>
                  )}
                </div>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {searchTest.searches.map((s, i) => (
                  <div
                    key={i}
                    className={`text-xs px-3 py-2 rounded-lg ${s.count > 0 ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-gray-600">{s.paramType}</span>
                      <span className={`font-bold ${s.count > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                        {s.error ? `エラー: ${s.error}` : `${s.count}件`}
                      </span>
                    </div>
                    {s.count > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-2">
                        {s.items.slice(0, 5).map((item, j) => (
                          <li key={j} className="text-gray-700 truncate">
                            <a href={item.itemUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {item.title}
                            </a>
                            {item.author && <span className="text-gray-400 ml-1">({item.author})</span>}
                            {item.artistName && <span className="text-gray-400 ml-1">({item.artistName})</span>}
                          </li>
                        ))}
                        {s.items.length > 5 && (
                          <li className="text-gray-400">… 他 {s.items.length - 5}件</li>
                        )}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-blue-500">
                ※ここに表示されない商品は楽天API段階で取得されていません。AI判定ボタンで全件保存・判定してください。
              </p>
            </div>
          )}

          {/* ── Sort mode view ──────────────────────────────────────────── */}
          {sortMode && data && (
            <div className="space-y-4">
              <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                ☰ ハンドルをドラッグして並び替えてください。保存は自動です。並び順は公開ページに反映されます。
                {sortSaving && <span className="ml-2 text-indigo-400">（{sortSaving} を保存中...）</span>}
              </p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                {(!sortedByCategory || sortedByCategory.length === 0) && (
                  <p className="text-sm text-gray-400 text-center py-4">採用済み商品がありません</p>
                )}
                {sortedByCategory?.map(({ cat, products }) => (
                  <div key={cat} className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <h4 className="text-xs font-bold text-gray-500 tracking-wide">
                        {cat}
                        <span className="font-normal ml-1 text-gray-400">（{products.length}件）</span>
                      </h4>
                      {displayOrders[cat] && displayOrders[cat].length > 0 && (
                        <button
                          onClick={() => handleResetOrder(cat)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          title="このカテゴリの並び順をデフォルトに戻す"
                        >
                          並び順をリセット
                        </button>
                      )}
                    </div>
                    <SortableContext items={products.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {products.map((p) => (
                          <SortableProductCard
                            key={p.id}
                            p={p}
                            sortMode={true}
                            selectedIds={selectedIds}
                            onMouseDown={handleCardMouseDown}
                            onMouseEnter={handleCardMouseEnter}
                            onVerdict={handleVerdict}
                            onDeleteVerdict={handleDeleteVerdict}
                            onConfirmDelete={(ids) => setConfirmDelete({ type: 'single', ids })}
                            onEdit={(prod) => { setEditingProduct(prod as RakutenItem & { catLabel: ProductCategory }); setManualModalOpen(true); }}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </div>
                ))}
              </DndContext>
            </div>
          )}

          {/* ── Normal (non-sort) product list ──────────────────────────── */}
          {!sortMode && data && (() => {
            const products = filteredProductList;

            if (products.length === 0) {
              return (
                <p className="text-sm text-gray-400 text-center py-4">
                  {filter === 'uncertain' ? 'AI判定待ちの商品はありません ✓' :
                   filter === 'unrelated' ? '非表示商品はありません' :
                   'バッチ処理を実行してください'}
                </p>
              );
            }

            return (
              <>
                {/* Select all + bulk delete */}
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 accent-slate-600"
                    />
                    全選択（{products.length}件）
                  </label>
                  {selectedInView.length > 0 && (
                    <span className="text-xs text-slate-600 font-medium">
                      選択中: {selectedInView.length}件
                    </span>
                  )}
                  {filter === 'unrelated' && (
                    <button
                      onClick={() => setConfirmDelete({ type: 'hidden', ids: filteredProductIds })}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors font-medium ml-auto"
                    >
                      🗑 非表示商品を一括削除（{products.length}件）
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {products.map((p) => (
                    <SortableProductCard
                      key={p.id}
                      p={p}
                      sortMode={false}
                      selectedIds={selectedIds}
                      onMouseDown={handleCardMouseDown}
                      onMouseEnter={handleCardMouseEnter}
                      onVerdict={handleVerdict}
                      onDeleteVerdict={handleDeleteVerdict}
                      onConfirmDelete={(ids) => setConfirmDelete({ type: 'single', ids })}
                      onEdit={(prod) => { setEditingProduct(prod as RakutenItem & { catLabel: ProductCategory }); setManualModalOpen(true); }}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-800 text-base">
              {confirmDelete.type === 'single' && 'この商品を削除しますか？'}
              {confirmDelete.type === 'selected' && `選択した ${confirmDelete.ids.length}件の商品を削除しますか？`}
              {confirmDelete.type === 'hidden' && `非表示商品 ${confirmDelete.ids.length}件を一括削除しますか？`}
            </h3>
            <p className="text-sm text-gray-500">この操作は元に戻せません。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={executeDelete}
                disabled={deleting}
                className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-colors disabled:opacity-50"
              >
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual add/edit modal */}
      {manualModalOpen && (
        <ManualProductModal
          personName={personName}
          editProduct={editingProduct ?? undefined}
          onClose={() => { setManualModalOpen(false); setEditingProduct(null); }}
          onSaved={load}
          allPersons={editingProduct ? [] : allPersons}
          personGroup={editingProduct ? undefined : personGroup}
        />
      )}

      {/* Sticky bulk action bar */}
      {!sortMode && selectedInView.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-2xl shadow-2xl text-xs whitespace-nowrap">
          <span className="font-medium mr-1">選択中: {selectedInView.length}件</span>
          <button
            onClick={() => handleBulkVerdict('related')}
            disabled={bulkProcessing}
            className="px-3 py-1.5 bg-green-500 hover:bg-green-400 rounded-lg font-medium disabled:opacity-50 transition-colors"
          >
            採用
          </button>
          <button
            onClick={() => handleBulkVerdict('unrelated')}
            disabled={bulkProcessing}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 rounded-lg font-medium disabled:opacity-50 transition-colors"
          >
            非表示
          </button>
          <button
            onClick={() => setConfirmDelete({ type: 'selected', ids: selectedInView })}
            disabled={bulkProcessing}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-400 rounded-lg font-medium disabled:opacity-50 transition-colors"
          >
            削除
          </button>
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors"
          >
            選択解除
          </button>
        </div>
      )}
    </div>
  );
}
