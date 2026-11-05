'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { sendGaEvent } from '@/lib/ga-event';

// 推し活サービスのジャンル（比較ページ）へのサイト内リンク。
// クリックは GA4 の oshikatsu_category_click で計測する（sendGaEvent 経由。本番ホスト以外・gtag 未読込では送信しない）。
// placement でホーム（home）・総合ページ（hub）などの設置場所を区別する。
// 外部サイト（各サービス）へのリンクは ServiceOutboundLink（oshikatsu_service_click）を使う。

interface Props {
  href: string;
  categoryId: string;
  placement: string;
  className?: string;
  children: ReactNode;
}

export default function OshikatsuCategoryLink({ href, categoryId, placement, className, children }: Props) {
  const lastClickAtRef = useRef(0);
  const handleClick = () => {
    const now = Date.now();
    if (now - lastClickAtRef.current < 1000) return;
    lastClickAtRef.current = now;
    sendGaEvent('oshikatsu_category_click', { category_id: categoryId, placement, link_url: href });
  };
  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
