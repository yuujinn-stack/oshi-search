'use client';

// 診断結果の表示を GA4 に1回だけ送る（本番ホスト以外では sendGaEvent が送信しない）。
import { useEffect } from 'react';
import { sendGaEvent } from '@/lib/ga-event';

interface Props {
  resultKey: string;
  use: string;
  budget: string;
  personItemCount: number;
  generalItemCount: number;
}

export default function OshiShoppingResultTracker({ resultKey, use, budget, personItemCount, generalItemCount }: Props) {
  useEffect(() => {
    sendGaEvent('oshi_shopping_result', {
      use,
      budget,
      person_item_count: personItemCount,
      general_item_count: generalItemCount,
    });
    // resultKey が変わったときだけ送る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);
  return null;
}
