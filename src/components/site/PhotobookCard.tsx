'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getBestProductImageUrl, getRenderableProductTitle } from '@/lib/product-image';

export interface PhotobookCardData {
  personName: string;
  /** カードに表示する名前。グループ写真集の場合はグループ名、それ以外は人物名 */
  displayName: string;
  /** displayName クリック時の遷移先（グループページ or 人物ページ） */
  displayHref: string;
  productId: string;
  title: string;
  imageUrl: string;
  price: number;
  itemUrl: string;
  affiliateUrl: string;
}

function trackClick(data: PhotobookCardData, title: string, imageUrl: string, href: string) {
  // 既存の商品クリック計測（type:'product'）をそのまま再利用する（新規計測経路を作らない）。
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'product',
      productId: data.productId,
      slug: data.personName,
      title,
      category: '写真集',
      imageUrl,
      affiliateUrl: href,
    }),
  }).catch(() => {});
}

// 写真集カード。表紙（縦長比率）を主役にしたレイアウト。
// リンク・アフィリエイトURL・クリック計測は既存のProductCard/／api/trackの仕組みをそのまま利用する。
export default function PhotobookCard({ data }: { data: PhotobookCardData }) {
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const href = data.affiliateUrl || data.itemUrl;
  const bestImageUrl = getBestProductImageUrl(data.imageUrl);
  const hasImage = !!bestImageUrl && !imgError;
  const displayTitle = getRenderableProductTitle(data.title);
  const price = Number(data.price) || 0;

  return (
    <div
      className="flex flex-col overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
      style={{
        background: 'var(--ds-surface)',
        border: '1.5px solid var(--ds-border)',
        borderRadius: 'var(--ds-radius)',
      }}
    >
      {/* 表紙画像（縦長比率を維持） */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '3 / 4', background: '#f8f9fa' }}>
        {!loaded && hasImage && (
          <div className="absolute inset-0 animate-pulse" style={{ background: 'var(--ds-border)' }} />
        )}
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bestImageUrl}
            alt={displayTitle}
            className={`absolute inset-0 w-full h-full object-contain p-2 transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5" style={{ color: 'var(--ds-muted)' }}>
            <span className="text-3xl" aria-hidden="true">📷</span>
            <span className="text-[10px]">画像なし</span>
          </div>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="absolute inset-0 z-10"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => trackClick(data, displayTitle, bestImageUrl, href)}
        />
      </div>

      {/* テキスト情報 */}
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <Link
          href={data.displayHref}
          className="text-[11px] font-semibold truncate hover:underline"
          style={{ color: 'var(--ds-primary)' }}
        >
          {data.displayName}
        </Link>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="text-[11px] leading-snug line-clamp-2 hover:underline flex-1"
          style={{ color: 'var(--ds-text)', minHeight: '2.2rem' }}
          onClick={() => trackClick(data, displayTitle, bestImageUrl, href)}
        >
          {displayTitle}
        </a>
        {price > 0 && (
          <p className="font-black text-[14px] leading-none" style={{ color: 'var(--ds-cta)' }}>
            ¥{price.toLocaleString()}
          </p>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="flex items-center justify-center font-bold text-[11px] tracking-wide active:scale-95 transition-transform duration-100 mt-0.5 bg-[#BF0000] hover:bg-[#A60000] active:bg-[#8F0000] text-white"
          style={{ borderRadius: 'var(--ds-radius)', minHeight: '34px', textDecoration: 'none' }}
          onClick={() => trackClick(data, displayTitle, bestImageUrl, href)}
        >
          楽天で見る →
        </a>
      </div>
    </div>
  );
}
