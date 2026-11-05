'use client';

import { useRef, type MouseEvent } from 'react';
import { sendGaEvent } from '@/lib/ga-event';

// 推し活サービス比較ページに、ASP（A8.net 等）が発行した広告HTMLタグを「そのまま」表示する。
// - タグは管理画面で登録され、保存時と表示時（store.ts → core.ts）に checkAdTag で安全確認済みのものだけが渡される
// - タグの中身（リンク先・文言・画像・計測用1×1画像・rel 属性）は一切変更しない。next/link にも変換しない
// - クリック計測は、タグに手を加えず外側の要素でクリックを受け取って GA4 へ送る（ServiceOutboundLink と同じイベント）

interface Props {
  html: string;
  serviceId: string;
  category: string;
  placement: string;
  className?: string;
}

export default function OshikatsuAdTag({ html, serviceId, category, placement, className }: Props) {
  const lastClickAtRef = useRef(0);
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    if (!target?.closest?.('a')) return;
    const now = Date.now();
    if (now - lastClickAtRef.current < 1000) return;
    lastClickAtRef.current = now;
    sendGaEvent('oshikatsu_service_click', { service_id: serviceId, service_category: category, placement, link_type: 'affiliate' });
    sendGaEvent('affiliate_click', { affiliate_name: serviceId, page_type: 'oshikatsu_service', placement });
  };
  return (
    // eslint-disable-next-line react/no-danger -- ASP発行の広告タグを改変せずに表示する仕様（安全確認済みのタグのみ）
    <div className={className} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
