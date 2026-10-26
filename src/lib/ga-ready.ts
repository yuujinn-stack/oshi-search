// GA4（window.gtag）が使えるようになってから送る（クライアント専用）。
// GA4 は AnalyticsGate のマウント後に読み込まれるため、ページを開いた直後（子の useEffect は親より先に動く）に
// sendGaEvent を呼ぶと gtag がまだ無く、黙って捨てられる。ページ表示時のイベントはこちらを使う。
// GA4 を読み込まないホスト（localhost・プレビュー）では送らずに終わる。戻り値は待機の中止（useEffect の cleanup 用）。
// ※サブスク診断の OshiVodShareVisitTracker は同じ処理を個別に持つ。
import { sendGaEvent } from '@/lib/ga-event';

export function sendGaEventWhenReady(name: string, params: Parameters<typeof sendGaEvent>[1], timeoutMs = 10_000): () => void {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    if (typeof (window as unknown as { gtag?: unknown }).gtag === 'function') {
      sendGaEvent(name, params);
      return;
    }
    if (Date.now() - started < timeoutMs) timer = setTimeout(tick, 250);
  };
  tick();
  return () => { if (timer) clearTimeout(timer); };
}
