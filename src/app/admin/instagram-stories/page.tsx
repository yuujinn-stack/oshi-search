import type { Metadata } from 'next';
import { LogoutButton } from '@/components/admin/LogoutButton';
import StoryTemplatesClient from './StoryTemplatesClient';

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

/**
 * ストーリーズテンプレート（静的定義の閲覧・コピー専用）。
 * DB・Instagram API・予約投稿・自動投稿には接続しない。
 */
export default function InstagramStoriesPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <a href="/admin/instagram" className="text-xs text-violet-600 hover:text-violet-700 font-semibold">
            ← Instagram管理へ戻る
          </a>
          <h1 className="text-2xl font-black text-slate-800 mt-1">ストーリーズテンプレート</h1>
          <p className="text-sm text-gray-500 mt-1">
            テンプレートを選び、各スライドの本文とリンクCTAをコピーしてストーリーズを作成します。
            1枚目から最後のスライドまで、すべてにリンクステッカーを置く前提です。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>
      <StoryTemplatesClient />
    </div>
  );
}
