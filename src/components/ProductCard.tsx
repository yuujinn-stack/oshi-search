'use client';

import { useState } from 'react';
import type { RakutenItem } from '@/types/rakuten';

// ─── 星レーティング ───────────────────────────────────────────────────────────
function StarRating({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return null;
  const filled = Math.round(avg);
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-px" aria-label={`${avg.toFixed(1)}点`}>
        {[1, 2, 3, 4, 5].map((s) => (
          <span
            key={s}
            style={{ fontSize: '9px', color: s <= filled ? '#f59e0b' : '#d1d5db' }}
            aria-hidden="true"
          >
            ★
          </span>
        ))}
      </div>
      <span className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>
        {avg.toFixed(1)} ({count.toLocaleString()})
      </span>
    </div>
  );
}

function trackProductClick(productId: string, personSlug: string, title: string, category: string) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'product', productId, slug: personSlug, title, category }),
  }).catch(() => {});
}

// ─── 商品カード ───────────────────────────────────────────────────────────────
export default function ProductCard({ product, personSlug = '' }: { product: RakutenItem; personSlug?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const href = product.affiliateUrl || product.itemUrl;
  const hasImage = !!product.imageUrl && !imgError;
  const price = Number(product.price);
  const reviewAvg = Number(product.reviewAverage);
  const reviewCount = Number(product.reviewCount);

  return (
    <div
      className="group overflow-hidden flex flex-col shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
      style={{
        background: 'var(--ds-surface)',
        border: `1.5px solid ${product.isUsed ? '#fcd34d' : 'var(--ds-border)'}`,
        borderRadius: 'var(--ds-radius)',
      }}
    >
      {/* ─ 画像エリア ─ */}
      <div className="relative aspect-square overflow-hidden" style={{ background: '#f8f9fa' }}>

        {/* 中古バッジ */}
        {product.isUsed && (
          <span className="absolute top-1.5 left-1.5 z-10 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full shadow-sm leading-snug">
            中古
          </span>
        )}

        {/* スケルトン（画像読み込み中） */}
        {!loaded && hasImage && (
          <div className="absolute inset-0 animate-pulse" style={{ background: 'var(--ds-border)' }} />
        )}

        {hasImage ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className={`absolute inset-0 w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-105 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-1.5"
            style={{ color: 'var(--ds-muted)' }}
          >
            <span className="text-3xl" aria-hidden="true">🛒</span>
            <span className="text-[10px]">画像なし</span>
          </div>
        )}

        {/* 画像クリック用オーバーレイ（キーボードナビ除外） */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="absolute inset-0 z-20"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {/* ─ テキスト情報 ─ */}
      <div className="p-3 flex flex-col flex-1 gap-2">

        {/* 価格（Visual Hierarchy 最優先） */}
        {price > 0 && (
          <p className="font-black text-[18px] leading-none" style={{ color: 'var(--ds-cta)' }}>
            ¥{price.toLocaleString()}
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--ds-muted)' }}>
              税込
            </span>
          </p>
        )}

        {/* 商品名（2行まで） */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="text-[11px] font-medium line-clamp-2 leading-snug flex-1 hover:underline"
          style={{ color: 'var(--ds-text)', minHeight: '2.5rem' }}
        >
          {product.title}
        </a>

        {/* レビュー星 */}
        <StarRating avg={reviewAvg} count={reviewCount} />

        {/* CTA（Von Restorff: 目立たせる） */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="flex items-center justify-center font-bold text-[13px] tracking-wide active:scale-95 transition-transform duration-100 mt-1"
          style={{
            background: 'var(--ds-cta)',
            color: 'var(--ds-cta-text)',
            borderRadius: 'var(--ds-radius)',
            minHeight: '44px',
            textDecoration: 'none',
          }}
          onClick={() => trackProductClick(product.id, personSlug, product.title, product.category)}
        >
          楽天で見る →
        </a>
      </div>
    </div>
  );
}
