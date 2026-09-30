import { LogoutButton } from '@/components/admin/LogoutButton';
import InstagramHClient from './InstagramHClient';

export const dynamic = 'force-dynamic';

/** H「観るもの・買うもの、まとめて」：人が人物を選び、3枚を生成・確認して予約する（投稿は既存Cronが行う） */
export default function InstagramHPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <a href="/admin/instagram" className="inline-block text-xs text-gray-500 hover:text-violet-600 mb-3">
        ← Instagram管理へ戻る
      </a>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">H「観るもの・買うもの、まとめて」投稿作成</h1>
          <p className="text-sm text-gray-500 mt-1">
            人物を選んで3枚を生成し、Preview・キャプションを確認して予約します。
            予約した日時に、既存の自動投稿（Cron）がInstagramへ投稿します（人物が自動で選ばれることはありません）。
          </p>
        </div>
        <LogoutButton className="text-xs text-gray-400 hover:text-red-500 mt-1" />
      </div>
      <InstagramHClient />
    </div>
  );
}
