import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: {
    default: '推しサーチ | 推し・有名人の写真集・グッズ・視聴先を検索',
    template: '%s | 推しサーチ',
  },
  description:
    '推しや有名人の写真集・本・雑誌・Blu-ray・グッズ・出演作品・VOD視聴先をまとめて検索できるサイトです。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50">
        <Header />
        <main>{children}</main>
        <footer className="bg-white border-t border-gray-200 mt-16 py-8 text-center text-sm text-gray-500">
          <p className="font-bold text-primary mb-1">推しサーチ</p>
          <p>© 2026 推しサーチ. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}
