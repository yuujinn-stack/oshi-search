'use client';

import { usePathname } from 'next/navigation';
import { GoogleAnalytics } from '@next/third-parties/google';

// 公開用のGA4測定ID（フロントエンドに埋め込んで問題ない値）。
const GA_MEASUREMENT_ID = 'G-TCGDBSQBNN';

// /admin配下は管理画面（noindex対象・運営者のみが利用）のため計測対象から除外する。
// /api配下はRoute Handlerでlayout.tsxを経由しないため、ここでの制御は不要
// （このコンポーネント自体がレンダリングされない）。
export default function AnalyticsGate() {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;
  return <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />;
}
