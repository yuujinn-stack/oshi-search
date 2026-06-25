'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RakutenItem } from '@/types/rakuten';
import type { JudgmentRecord, Verdict } from '@/lib/judgment-store';
import { useBulkSelection } from '@/hooks/useBulkSelection';

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

export default function PersonProducts({ personName }: { personName: string }) {
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

  // ─── フィルター済み商品リスト ────────────────────────────────────────────────
  const filteredProductList = useMemo(() => {
    if (!data) return [];
    return CATEGORIES.flatMap((cat) => {
      const catData = data.categories[cat];
      if (!catData || catData.status !== 'ok') return [];
      return catData.products
        .map((p) => ({ ...p, catLabel: cat, judgment: data.verdicts[p.id] }))
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

  // ─── 一括選択 ────────────────────────────────────────────────────────────────
  const {
    selectedIds,
    isDragging,
    handleCardMouseDown,
    handleCardMouseEnter,
    toggleSelectAll,
    clearSelection,
  } = useBulkSelection(filteredProductIds);

  // フィルター変更時に選択クリア
  useEffect(() => { clearSelection(); }, [filter, clearSelection]);

  // 現在のフィルタービュー内で選択中のID
  const selectedInView = filteredProductIds.filter((id) => selectedIds.has(id));

  // ─── データ取得 ──────────────────────────────────────────────────────────────
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

  // ─── 個別判定 ────────────────────────────────────────────────────────────────
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

  // ─── 一括判定 ────────────────────────────────────────────────────────────────
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

  // ─── 検索テスト ──────────────────────────────────────────────────────────────
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

  // ─── 削除 ────────────────────────────────────────────────────────────────────
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
      {/* ヘッダー行 */}
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

      {/* 展開パネル */}
      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* アクションバー */}
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
            {message && <span className="text-xs text-green-600">{message}</span>}
          </div>

          {/* 検索テスト結果 */}
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

          {/* 商品リスト */}
          {data && (() => {
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
                {/* 全選択 + 非表示一括削除 */}
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
                  {products.map((p) => {
                    const isShown = p.judgment?.verdict === 'related';
                    const isHidden = p.judgment?.verdict === 'unrelated';
                    const isChecked = selectedIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className={`flex items-start gap-2 p-2.5 rounded-lg text-xs border transition-colors cursor-default ${
                          isChecked ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-300' :
                          isShown ? 'border-green-100 bg-green-50/50' :
                          isHidden ? 'border-red-100 bg-red-50/30 opacity-60' :
                          'border-yellow-100 bg-yellow-50/50'
                        }`}
                        onMouseDown={(e) => handleCardMouseDown(p.id, e)}
                        onMouseEnter={() => handleCardMouseEnter(p.id)}
                      >
                        {/* チェックボックス（視覚的フィードバック / ドラッグ起点外） */}
                        <input
                          type="checkbox"
                          readOnly
                          checked={isChecked}
                          className="mt-1 w-3.5 h-3.5 flex-shrink-0 accent-slate-600"
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* サムネイル */}
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="w-9 h-11 object-cover rounded flex-shrink-0" />
                        )}
                        {/* 商品情報 */}
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-2 text-slate-700 font-medium leading-tight">{p.title}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-gray-400">{p.catLabel}</span>
                            <span className="font-mono text-gray-400">score {p.relevanceScore}</span>
                            {p.judgment ? (
                              <span className={`px-1.5 py-0.5 rounded ${VERDICT_BADGE[p.judgment.verdict] ?? 'bg-gray-100 text-gray-500'}`}>
                                {SOURCE_ICON[p.judgment.source]} {VERDICT_LABEL[p.judgment.verdict] ?? p.judgment.verdict}
                                {p.judgment.reason ? ` — ${p.judgment.reason}` : ''}
                              </span>
                            ) : (
                              <span className="text-gray-400 italic">未判定</span>
                            )}
                          </div>
                        </div>
                        {/* 判定ボタン */}
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleVerdict(p.id, 'related', p.relevanceScore)}
                            disabled={p.judgment?.verdict === 'related'}
                            className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
                          >
                            採用
                          </button>
                          <button
                            onClick={() => handleVerdict(p.id, 'unrelated', p.relevanceScore)}
                            disabled={p.judgment?.verdict === 'unrelated'}
                            className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40"
                          >
                            非表示
                          </button>
                          {p.judgment && (
                            <button
                              onClick={() => handleDeleteVerdict(p.id)}
                              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
                            >
                              リセット
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmDelete({ type: 'single', ids: [p.id] })}
                            className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* 削除確認ダイアログ */}
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

      {/* Sticky一括操作バー */}
      {selectedInView.length > 0 && (
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
