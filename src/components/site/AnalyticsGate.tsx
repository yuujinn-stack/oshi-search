'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { GoogleAnalytics } from '@next/third-parties/google';
import { isGaAllowedHost } from '@/lib/analytics-host';

// 公開用のGA4測定ID（フロントエンドに埋め込んで問題ない値）。
const GA_MEASUREMENT_ID = 'G-TCGDBSQBNN';

// /admin配下は管理画面（noindex対象・運営者のみが利用）のため計測対象から除外する。
// /api配下はRoute Handlerでlayout.tsxを経由しないため、ここでの制御は不要
// （このコンポーネント自体がレンダリングされない）。
//
// GA4は本番ホスト（src/lib/analytics-host.ts の GA_ALLOWED_HOSTS）でだけ読み込む。
// localhost・127.0.0.1・*.vercel.app（Preview）等ではGA4自体を読み込まないため、
// 自動の page_view も window.gtag も発生せず、カスタムイベント（sendGaEvent 経由の
// diagnosis_* ・affiliate_click 等）も送信されない。
// hostname はブラウザでしか分からないため、マウント後に判定してから読み込む
// （GoogleAnalytics 自体も afterInteractive で読み込まれるため、本番での読み込みタイミングは実質変わらない）。
export default function AnalyticsGate() {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(isGaAllowedHost(window.location.hostname));
  }, []);
  if (pathname?.startsWith('/admin')) return null;
  if (!allowed) return null;
  return <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />;
}
