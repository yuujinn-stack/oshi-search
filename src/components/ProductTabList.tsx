'use client';

import { useState, useMemo } from 'react';
import ProductCard from './ProductCard';
import type { RakutenItem } from '@/types/rakuten';

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export interface ProductWithSection {
  product: RakutenItem;
  sectionLabel: string;
  isUsed: boolean;
}

type SortKey = 'default' | 'price-asc' | 'price-desc' | 'review';

// ─── タブ定義 ─────────────────────────────────────────────────────────────────
const TAB_ALL = 'すべて';
const CATEGORY_TABS = ['写真集・書籍', 'CD', 'Blu-ray・DVD', 'グッズ', '中古'];

// ─── コンポーネント ───────────────────────────────────────────────────────────
export default function ProductTabList({ items, personSlug = '' }: { items: ProductWithSection[]; personSlug?: string }) {
  const [activeTab, setActiveTab] = useState(TAB_ALL);
  const [sort, setSort] = useState<SortKey>('default');
  const [showAll, setShowAll] = useState(false);

  const INITIAL_COUNT = 24;

  // タブ別件数
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { [TAB_ALL]: items.length };
    for (const { sectionLabel, isUsed } of items) {
      const key = isUsed ? '中古' : sectionLabel;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  // フィルタリング
  const filtered = useMemo(() => {
    if (activeTab === TAB_ALL) return items;
    if (activeTab === '中古') return items.filter((i) => i.isUsed);
    return items.filter((i) => !i.isUsed && i.sectionLabel === activeTab);
  }, [items, activeTab]);

  // ソート
  const sorted = useMemo(() => {
    const base = [...filtered];
    if (sort === 'price-asc')  return base.sort((a, b) => a.product.price - b.product.price);
    if (sort === 'price-desc') return base.sort((a, b) => b.product.price - a.product.price);
    if (sort === 'review')     return base.sort((a, b) => b.product.reviewAverage - a.product.reviewAverage);
    // おすすめ順: 新品・通常商品を中古より前に（安定ソートで各グループ内の相対順を維持）
    return base.sort((a, b) => (a.isUsed ? 1 : 0) - (b.isUsed ? 1 : 0));
  }, [filtered, sort]);

  const displayed = showAll ? sorted : sorted.slice(0, INITIAL_COUNT);
  const remaining = sorted.length - INITIAL_COUNT;

  if (items.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm rounded-xl"
        style={{ color: 'var(--ds-muted)', background: 'var(--ds-primary-soft)' }}
      >
        現在、関連商品は見つかっていません
      </div>
    );
  }

  const visibleTabs = [TAB_ALL, ...CATEGORY_TABS.filter((t) => (tabCounts[t] ?? 0) > 0)];

  return (
    <div className="space-y-4">
      {/* ─ タブ + ソート ─ */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* カテゴリタブ */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-1 pb-0.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setShowAll(false); }}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150"
              style={
                activeTab === tab
                  ? { background: 'var(--ds-primary)', color: '#fff' }
                  : { background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }
              }
            >
              {tab}
              {tabCounts[tab] != null && (
                <span className="text-[10px] opacity-70">{tabCounts[tab]}</span>
              )}
            </button>
          ))}
        </div>

        {/* ソートセレクター */}
        {sorted.length > 1 && (
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as SortKey); setShowAll(false); }}
            className="text-xs rounded-xl px-2.5 py-1.5 border flex-shrink-0"
            style={{
              background: 'var(--ds-surface)',
              borderColor: 'var(--ds-border)',
              color: 'var(--ds-text)',
              minHeight: '36px',
            }}
          >
            <option value="default">おすすめ順</option>
            <option value="price-asc">価格：安い順</option>
            <option value="price-desc">価格：高い順</option>
            <option value="review">レビュー評価順</option>
          </select>
        )}
      </div>

      {/* ─ 商品グリッド ─ */}
      {displayed.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {displayed.map(({ product }) => (
            <ProductCard key={product.id} product={product} personSlug={personSlug} />
          ))}
        </div>
      ) : (
        <div
          className="py-8 text-center text-sm rounded-xl"
          style={{ color: 'var(--ds-muted)', background: 'var(--ds-primary-soft)' }}
        >
          このカテゴリの商品は現在ありません
        </div>
      )}

      {/* ─ もっと見る ─ */}
      {!showAll && remaining > 0 && (
        <div className="text-center">
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-2 px-6 font-bold text-sm rounded-xl transition-colors"
            style={{
              background: 'var(--ds-primary-soft)',
              color: 'var(--ds-primary)',
              minHeight: '44px',
            }}
          >
            もっと見る
            <span className="text-xs font-normal opacity-70">（残り {remaining} 件）</span>
          </button>
        </div>
      )}
    </div>
  );
}
