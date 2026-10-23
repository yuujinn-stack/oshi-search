'use client';

// 推し活お買い物診断の「推し活に便利な一般商品」カード。
// - 商品名は楽天の商品名を省略・改変せず全文を表示する（楽天ウェブサービス規約 第10条1項(7)）。
//   推しサーチが付けた用途の説明（label）は商品名と分けて表示する。
// - 特定の人物・グループの商品や公式グッズとしては表示しない。
// - リンクは楽天APIが返したアフィリエイトURLをそのまま使う。
// - クリック計測は GA4 のみ（人物の商品ランキング＝/api/track には入れない）。
import { useState } from 'react';
import { trackRakutenClick, type RakutenLinkElement } from '@/lib/rakuten-click-track';

interface Props {
  itemCode: string;
  label: string;
  itemName: string;
  price: number;
  imageUrl: string;
  affiliateUrl: string;
  shopName: string;
  reviewCount: number;
  position: number;
  use: string;
}

export default function GeneralItemCard({ itemCode, label, itemName, price, imageUrl, affiliateUrl, shopName, reviewCount, position, use }: Props) {
  const [imgError, setImgError] = useState(false);
  const onClick = (linkElement: RakutenLinkElement) => () =>
    trackRakutenClick({
      productId: `general:${itemCode}`,
      personSlug: '',
      title: itemName,
      category: `一般商品:${use}`,
      imageUrl,
      affiliateUrl,
      pageType: 'oshi_shopping',
      placement: 'oshi_shopping_general',
      position,
      linkElement,
      countInRanking: false,
    });

  return (
    <div className="os-card">
      <a href={affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" className="os-card-img" tabIndex={-1} aria-hidden="true" onClick={onClick('image')}>
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element -- 楽天の画像サーバーのURLをそのまま表示する（保存・最適化しない）
          <img src={imageUrl} alt="" loading="lazy" onError={() => setImgError(true)} />
        ) : (
          <span className="os-card-noimg">画像なし</span>
        )}
      </a>
      <div className="os-card-body">
        <p className="os-card-tag">{label}</p>
        <p className="os-card-price">¥{price.toLocaleString()}<span className="os-card-tax">税込</span></p>
        <a href={affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" className="os-card-title" onClick={onClick('title')}>
          {itemName}
        </a>
        <p className="os-card-meta">
          {shopName && <span>販売：{shopName}</span>}
          <span>レビュー {reviewCount.toLocaleString()}件</span>
        </p>
        <a href={affiliateUrl} target="_blank" rel="noopener noreferrer sponsored" className="os-card-cta" onClick={onClick('cta')}>
          楽天で見る →
        </a>
      </div>
    </div>
  );
}
