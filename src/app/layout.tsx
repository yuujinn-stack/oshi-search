import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import Header from '@/components/Header';
import DesignPreviewToggle from '@/components/site/DesignPreviewToggle';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp'),
  title: {
    default: '推しサーチ | 推し・有名人の写真集・グッズ・視聴先を検索',
    template: '%s | 推しサーチ',
  },
  description:
    '推しや有名人の写真集・本・雑誌・Blu-ray・グッズ・出演作品・VOD視聴先をまとめて検索できるサイトです。',
  openGraph: {
    siteName: '推しサーチ',
    locale: 'ja_JP',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-design="standard">
      <body>
        {/* サーバーレンダリングされるコンテンツ — Suspense不要 */}
        <Header />
        <main>{children}</main>
        <footer className="bg-white border-t border-gray-200 mt-16 py-8 text-center text-sm text-gray-500 space-y-1">
          <p className="font-bold text-primary">推しサーチ</p>
          <p>© 2026 推しサーチ. All rights reserved.</p>
          <p className="text-xs text-gray-400">
            本サイトはアフィリエイト広告（楽天市場・楽天ブックス）を掲載しています。
          </p>
        </footer>

        {/* クライアント専用UIは独立した Suspense に隔離 */}
        <Suspense fallback={null}>
          <DesignPreviewToggle />
        </Suspense>
      </body>
    </html>
  );
}
