import { getAllGroupMetasOrThrow } from '@/lib/group-meta';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import GroupManager from './GroupManager';

export const dynamic = 'force-dynamic';

export default async function AdminGroupsPage() {
  let initialMetas: Awaited<ReturnType<typeof getAllGroupMetasOrThrow>>;
  try {
    initialMetas = await getAllGroupMetasOrThrow();
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">グループ管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            グループの改名・解散・旧グループ名などを管理します
          </p>
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs flex-wrap">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">出演作品管理 →</a>
          <a href="/admin/people-membership-import" className="text-indigo-600 hover:underline">所属CSV更新 →</a>
          <a href="/admin/rakuten-search" className="text-indigo-600 hover:underline font-medium">楽天商品検索 →</a>
          <a href="/admin/product-check" className="text-gray-400 hover:underline">商品確認</a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">ログアウト</a>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 mb-6 space-y-1">
        <p className="font-semibold">使い方</p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li>改名グループ例: 欅坂46（活動状態: 改名済み、改名後: 櫻坂46、旧グループ名: 欅坂46）</li>
          <li>改名後のグループ例: 櫻坂46（活動状態: 活動中、改名前: 欅坂46）</li>
          <li>旧グループ名を登録すると検索で旧名でも見つかるようになります</li>
        </ul>
      </div>

      <GroupManager initialMetas={initialMetas} />
    </div>
  );
}
