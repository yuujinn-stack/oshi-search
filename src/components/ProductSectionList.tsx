'use client';

import { useState } from 'react';
import ProductCard from './ProductCard';
import type { ApiResult } from '@/types/rakuten';

const INITIAL_COUNT = 24;

interface Props {
  result: ApiResult;
}

function EmptyState({ children }: { children: string }) {
  return (
    <div
      className="py-8 text-center text-sm rounded-xl"
      style={{ color: 'var(--ds-muted)', background: 'var(--ds-primary-soft)' }}
    >
      {children}
    </div>
  );
}

export default function ProductSectionList({ result }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (result.status === 'error' || result.status === 'config_missing' || result.status === 'upstream_error') {
    return <EmptyState>現在商品情報を取得できません</EmptyState>;
  }
  if (result.status === 'no_data') {
    return <EmptyState>商品情報を準備中です。しばらくお待ちください。</EmptyState>;
  }
  if (result.status === 'empty') {
    return <EmptyState>現在、関連商品は見つかっていません</EmptyState>;
  }

  const total = result.products.length;
  const displayed = showAll ? result.products : result.products.slice(0, INITIAL_COUNT);
  const remaining = total - INITIAL_COUNT;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {displayed.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

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
