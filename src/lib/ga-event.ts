// GA4 カスタムイベント送信の共通ラッパー（クライアント専用・DB非依存）。
// サイト内の GA4 カスタムイベント（diagnosis_* ・affiliate_click 等）はすべてここを通す。
// - 本番ホスト（GA_ALLOWED_HOSTS）以外では送信しない（AnalyticsGate と同じ判定）
// - AnalyticsGate が読み込んだ window.gtag がある場合のみ送信する
//   （/admin 配下・gtag 未読込・広告ブロッカー等では何もしない）
import { isGaAllowedHost } from '@/lib/analytics-host';

type GaParams = Record<string, string | number | boolean | undefined>;

export function sendGaEvent(name: string, params: GaParams = {}): void {
  if (typeof window === 'undefined') return;
  if (!isGaAllowedHost(window.location.hostname)) return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', name, params);
  } catch {
    // 計測失敗で画面操作を妨げない
  }
}
