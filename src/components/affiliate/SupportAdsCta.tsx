'use client';

import { useEffect, useRef, useState } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import { ACCESSTRADE_OSHI_AD_BANNER_HTML } from './oshi-ad-link';

// 応援広告ガイド（/support-ads）の推しアド広告枠。
// 人物ページの OshiAdBanner と同じ承認済み AccessTrade リンクコードを改変せずに埋め込む。
// クリック計測も OshiAdBanner と同じ GA4 affiliate_click（affiliate_name='oshi_ad'、sendGaEvent 経由）を使い、
// page_type / placement だけを変える。リンクコード自体には手を入れず、外側の要素の onClick で
// バブリングを検知するため、1クリックで1回だけ送信される（1秒以内の連続クリックも1回）。
// バナー画像の読み込みに失敗した場合は、壊れた画像を見せないよう広告枠全体を非表示にする（OshiAdBanner と同じ）。
// 表示可否（NEXT_PUBLIC_OSHI_AD_ENABLED）は呼び出し側のページで判定する。

interface Props {
  placement: string;
}

export default function SupportAdsCta({ placement }: Props) {
  const creativeRef = useRef<HTMLDivElement>(null);
  const lastClickAtRef = useRef(0);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const img = creativeRef.current?.querySelector('img');
    if (!img) return;
    const onError = () => setImageFailed(true);
    if (img.complete && img.naturalWidth === 0) {
      onError();
      return;
    }
    img.addEventListener('error', onError);
    return () => img.removeEventListener('error', onError);
  }, []);

  if (imageFailed) return null;

  // ダブルクリック等の連続クリックは1秒以内なら1回だけ計測する（二重計測の防止）
  const handleClick = () => {
    const now = Date.now();
    if (now - lastClickAtRef.current < 1000) return;
    lastClickAtRef.current = now;
    sendGaEvent('affiliate_click', {
      affiliate_name: 'oshi_ad',
      page_type: 'support_ads',
      placement,
    });
  };

  return (
    <div className="sa-cta">
      <span className="sa-pr">PR　推しアド（応援広告サービス）の広告です</span>
      <p className="sa-cta-title">推しアド公式サイトで掲載枠を探す</p>
      <p className="sa-cta-text">
        バナーを押すと推しアドの公式サイト（トップページ）が開きます。
        「掲載枠を探す」からエリアや日程で枠を探し、Webで申し込めます（支払いはクレジットカードまたは銀行振込）。
        料金・空き状況・申込条件は、公式サイトで必ず確認してください。
      </p>
      {/* AccessTrade提供のリンクコードを改変せずそのまま利用する */}
      <div
        ref={creativeRef}
        className="oshi-ad-banner__creative sa-cta-creative"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: ACCESSTRADE_OSHI_AD_BANNER_HTML }}
      />
    </div>
  );
}
