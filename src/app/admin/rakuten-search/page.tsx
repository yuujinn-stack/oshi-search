import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetasOrThrow } from '@/lib/person-meta';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import RakutenSearchClient from './RakutenSearchClient';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { createGroupList } from './group-utils';

export const dynamic = 'force-dynamic';

export default async function RakutenSearchPage() {
  let persons: Awaited<ReturnType<typeof getAllPersonsMerged>>;
  let metas: Awaited<ReturnType<typeof getAllPersonMetasOrThrow>>;
  try {
    [persons, metas] = await Promise.all([
      getAllPersonsMerged(),
      getAllPersonMetasOrThrow(),
    ]);
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  const personOptions: PersonOption[] = persons.map((p) => ({
    name: p.name,
    group: p.group || undefined,
    currentGroupName: metas[p.name]?.currentGroupName || undefined,
    activityStatus: metas[p.name]?.activityStatus,
    generation: metas[p.name]?.generation,
  }));

  const groups = createGroupList(personOptions);

  const metaMap: Record<string, { joinedAt?: string; leftAt?: string; activityStatus?: string }> = {};
  for (const [name, meta] of Object.entries(metas)) {
    metaMap[name] = { joinedAt: meta.joinedAt, leftAt: meta.leftAt, activityStatus: meta.activityStatus };
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800">楽天商品検索</h1>
          <p className="text-sm text-gray-500 mt-1">キーワード検索して複数人物に商品を一括追加</p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/product-check" className="text-indigo-600 hover:underline">商品確認 →</a>
          <a href="/admin/work-check" className="text-gray-400 hover:underline">作品管理</a>
          <a href="/admin/people-progress" className="text-gray-400 hover:underline">人物進捗</a>
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>
      <RakutenSearchClient persons={personOptions} groups={groups} metaMap={metaMap} />
    </div>
  );
}
