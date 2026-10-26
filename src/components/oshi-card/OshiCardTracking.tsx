'use client';

// 推し布教カードの表示計測（GA4）。ページを開いた直後に送るため GA4 の読み込みを待つ（src/lib/ga-ready.ts）。
// - oshi_card_view：作成画面（pick / edit）・カードのページ（card）の表示。source は入口（person / top / share / direct）
// - oshi_card_share_visit：共有リンク（sm 付き）経由の訪問。計測後は sm・from を URL から取り除き、
//   同じタブで新しく作り始めたときに共有経由と分かるよう sessionStorage に引き継ぐ（src/lib/oshi-card/attribution.ts）。
import { useEffect } from 'react';
import { sendGaEventWhenReady } from '@/lib/ga-ready';
import { rememberOshiCardShare } from '@/lib/oshi-card/attribution';
import type { OshiCardEntrySource, OshiCardShareMethod, OshiCardVariant } from '@/lib/oshi-card/params';

interface Props {
  stage: 'pick' | 'edit' | 'card';
  source: OshiCardEntrySource | null;
  shareMethod: OshiCardShareMethod | null;
  variant: OshiCardVariant;
  workCount: number;
}

export default function OshiCardTracking({ stage, source, shareMethod, variant, workCount }: Props) {
  useEffect(() => {
    const cancels: (() => void)[] = [];
    cancels.push(sendGaEventWhenReady('oshi_card_view', { stage, source: shareMethod ? 'share' : source ?? 'direct' }));
    if (shareMethod) {
      cancels.push(sendGaEventWhenReady('oshi_card_share_visit', { variant, share_method: shareMethod, work_count: workCount }));
      rememberOshiCardShare({ variant, method: shareMethod });
    }
    if (shareMethod || source) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('sm');
        url.searchParams.delete('from');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      } catch { /* 表示・計測には影響しない */ }
    }
    return () => cancels.forEach((c) => c());
  }, [stage, source, shareMethod, variant, workCount]);
  return null;
}
