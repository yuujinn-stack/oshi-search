import { getImportHistoryList } from '@/lib/import-history';
import ImportHistoryClient from './ImportHistoryClient';

export const dynamic = 'force-dynamic';

export default async function ImportHistoryPage() {
  const list = await getImportHistoryList(100);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">CSVインポート履歴</h1>
          <p className="text-sm text-gray-500 mt-1">
            人物・作品・配信情報の各CSVインポート操作の記録
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/people/import" className="text-indigo-600 hover:underline">
            人物登録
          </a>
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">
            作品管理
          </a>
          <a href="/admin/work-import" className="text-indigo-600 hover:underline">
            作品・配信追加
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      <ImportHistoryClient initialList={list} />
    </div>
  );
}
