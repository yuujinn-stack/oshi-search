import MembershipImportClient from './MembershipImportClient';

export const dynamic = 'force-dynamic';

export default function PeopleMembershipImportPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">所属情報 CSV一括更新</h1>
          <p className="text-sm text-gray-500 mt-1">
            活動状態・期別・所属グループなどをCSVで一括更新します
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">作品管理 →</a>
          <a href="/admin/people/import" className="text-indigo-600 hover:underline">人物登録 →</a>
          <a href="/admin/groups" className="text-gray-400 hover:underline">グループ管理</a>
          <a href="/admin/product-check" className="text-gray-400 hover:underline">商品確認</a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">ログアウト</a>
        </div>
      </div>

      <MembershipImportClient />
    </div>
  );
}
