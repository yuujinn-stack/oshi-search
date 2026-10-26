'use client';

// 「あなたの推しでも布教カードを作る」（カードのページ・共有リンクの着地ページに必ず置く）。
// クリックは GA4 oshi_card_create_start（source: share＝共有リンクで来た人 / card＝自分で作った人）。
import Link from 'next/link';
import { sendGaEvent } from '@/lib/ga-event';
import { OSHI_CARD_PATH } from '@/lib/oshi-card/params';

export default function OshiCardCreateCta({ fromShare, className = 'oc-btn-main' }: { fromShare: boolean; className?: string }) {
  return (
    <Link
      href={fromShare ? `${OSHI_CARD_PATH}?from=share` : OSHI_CARD_PATH}
      className={className}
      onClick={() => sendGaEvent('oshi_card_create_start', { source: fromShare ? 'share' : 'card' })}
    >
      あなたの推しでも布教カードを作る
    </Link>
  );
}
