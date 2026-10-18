'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import ProductCard from './ProductCard';
import type { RakutenItem } from '@/types/rakuten';
import { TAB_ALL, CATEGORY_TABS, countProductsByTab, productTabAnchorId, productTabFromHash } from '@/lib/product-tabs';

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export interface ProductWithSection {
  product: RakutenItem;
  sectionLabel: string;
  isUsed: boolean;
}

type SortKey = 'default' | 'price-asc' | 'price-desc' | 'review';

// タブ定義・タブ別件数・カテゴリを直接開くページ内リンク（#products-<slug>）は src/lib/product-tabs.ts

// 固定ヘッダー（約70px）＋クイックナビ（約56px）の下に一覧の先頭が隠れないよう、ページ内リンクの着地点に余白をとる
const ANCHOR_SCROLL_MARGIN = 136;

// ─── コンポーネント ───────────────────────────────────────────────────────────
export default function ProductTabList({ items, personSlug = '' }: { items: ProductWithSection[]; personSlug?: string }) {
  const [activeTab, setActiveTab] = useState(TAB_ALL);
  const [sort, setSort] = useState<SortKey>('default');
  const [showAll, setShowAll] = useState(false);

  const INITIAL_COUNT = 24;

  // タブ別件数
  const tabCounts = useMemo(() => countProductsByTab(items), [items]);

  // URL のページ内リンク（#products-cd 等）でカテゴリタブを選ぶ。
  // - 直接アクセス・リロード時（マウント時）と、ブラウザの戻る／進む（hashchange）で反映する
  // - ページ内リンクから選ばれた状態で、カテゴリ以外のURLへ戻ったら「すべて」に戻す
  // - 同じリンクをもう一度押した場合（URLが変わらず hashchange が起きない）もクリックで反映する
  // URLの書き換え（pushState 等）はしない。リンクは通常の <a href="#..."> のまま（楽天リンク・計測とは無関係）
  const tabFromHashRef = useRef(false);
  const tabStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 横スクロールのタブ列で、選ばれたタブが画面外（スマホ幅で右端の先）にあれば見える位置まで横にだけ動かす（ページは縦に動かさない）
    const revealTab = (tab: string) => requestAnimationFrame(() => {
      const strip = tabStripRef.current;
      const btn = strip?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tab)}"]`);
      if (!strip || !btn) return;
      const left = btn.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
      if (left < strip.scrollLeft || left + btn.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = Math.max(0, left - 16);
      }
    });
    const select = (tab: string | null) => {
      if (tab && (tabCounts[tab] ?? 0) > 0) {
        setActiveTab(tab);
        setShowAll(false);
        tabFromHashRef.current = true;
        revealTab(tab);
        return true;
      }
      return false;
    };
    const onHash = () => {
      if (select(productTabFromHash(window.location.hash))) return;
      if (tabFromHashRef.current) {
        setActiveTab(TAB_ALL);
        setShowAll(false);
        tabFromHashRef.current = false;
      }
    };
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#products-"]') : null;
      if (a) select(productTabFromHash(a.getAttribute('href')));
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, [tabCounts]);

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
    // おすすめ順: 新品・通常商品を中古より前に（安定ソート・入力配列を変更しない）
    return [...base].sort((a, b) => (a.isUsed ? 1 : 0) - (b.isUsed ? 1 : 0));
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
    <>
      {/* ページ内リンク（#products-cd 等）の着地点。サーバーで描画されるため、JS 読み込み前でも一覧の位置へスクロールする */}
      <div aria-hidden="true" style={{ height: 0, margin: 0 }}>
        {CATEGORY_TABS.filter((t) => (tabCounts[t] ?? 0) > 0).map((t) => {
          const id = productTabAnchorId(t);
          return id ? <span key={id} id={id} style={{ display: 'block', height: 0, scrollMarginTop: ANCHOR_SCROLL_MARGIN }} /> : null;
        })}
      </div>
      <div className="space-y-4">
        {/* ─ タブ + ソート ─ */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* カテゴリタブ */}
          <div ref={tabStripRef} className="flex gap-1.5 overflow-x-auto scrollbar-none flex-1 pb-0.5">
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                data-tab={tab}
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
            {displayed.map(({ product, sectionLabel, isUsed }, i) => (
              <ProductCard
                // 楽天市場の商品IDは同一ショップの別商品で重複しうるため（既知の不具合）、位置も含めてキーにする
                key={`${isUsed ? 'u' : 'n'}:${product.id}:${i}`}
                product={product}
                personSlug={personSlug}
                pageType="person"
                placement="person_product_list"
                position={i + 1}
                displayCategory={isUsed ? '中古' : sectionLabel}
              />
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
    </>
  );
}
