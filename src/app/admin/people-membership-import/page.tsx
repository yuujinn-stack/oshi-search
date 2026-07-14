import { getAllPersonsMerged } from '@/lib/persons';
import MembershipImportClient from './MembershipImportClient';
import { LogoutButton } from '@/components/admin/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function PeopleMembershipImportPage() {
  let groups: string[] = [];
  let persons: Array<{ name: string; group: string }> = [];
  try {
    const allPersons = await getAllPersonsMerged();
    groups = [...new Set(allPersons.map((p) => p.group).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ja'),
    );
    persons = allPersons.map((p) => ({ name: p.name, group: p.group ?? '' }));
  } catch { /* Redis 未接続時は空 */ }

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
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>

      <MembershipImportClient groups={groups} persons={persons} />
    </div>
  );
}
