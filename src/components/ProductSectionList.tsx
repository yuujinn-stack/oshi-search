'use client';

import { useState } from 'react';
import ProductCard from './ProductCard';
import type { ApiResult } from '@/types/rakuten';

// 初期表示件数（PC・スマホ共通）
const INITIAL_COUNT = 24;

interface Props {
  result: ApiResult;
}

export default function ProductSectionList({ result }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (result.status === 'error') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        現在商品情報を取得できません
      </div>
    );
  }

  if (result.status === 'no_data') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        商品情報を準備中です。しばらくお待ちください。
      </div>
    );
  }

  if (result.status === 'empty') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        現在、関連商品は見つかっていません
      </div>
    );
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
            className="px-6 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
          >
            もっと見る（残り {remaining} 件）
          </button>
        </div>
      )}
    </div>
  );
}
