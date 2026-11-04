'use client';

import { useRef, type ReactNode } from 'react';
import { sendGaEvent } from '@/lib/ga-event';

// 推し活サービス比較ページ（/oshikatsu/*）から各サービスの公式サイト（または提携後の広告リンク）へのリンク。
// リンク先は呼び出し側で src/lib/oshikatsu-services/links.ts の resolveServiceLink から渡す（ここでURLを組み立てない）。
// クリックは GA4 の oshikatsu_service_click で計測する（sendGaEvent 経由。本番ホスト以外・gtag 未読込では送信しない）。
// 広告リンク（isAffiliate=true）のときは rel に sponsored を付け、GA4 の既存の affiliate_click も送る。

interface Props {
  href: string;
  isAffiliate: boolean;
  serviceId: string;
  category: string;
  placement: string;
  className?: string;
  children: ReactNode;
}

export default function ServiceOutboundLink({ href, isAffiliate, serviceId, category, placement, className, children }: Props) {
  const lastClickAtRef = useRef(0);
  const handleClick = () => {
    // 連続クリックは1秒以内なら1回だけ計測する
    const now = Date.now();
    if (now - lastClickAtRef.current < 1000) return;
    lastClickAtRef.current = now;
    const params = { service_id: serviceId, service_category: category, placement, link_type: isAffiliate ? 'affiliate' : 'official' };
    sendGaEvent('oshikatsu_service_click', params);
    if (isAffiliate) {
      sendGaEvent('affiliate_click', { affiliate_name: serviceId, page_type: 'oshikatsu_service', placement });
    }
  };
  return (
    <a
      href={href}
      target="_blank"
      rel={isAffiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
