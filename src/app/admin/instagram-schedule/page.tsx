import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetasOrThrow } from '@/lib/person-meta';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import { LogoutButton } from '@/components/admin/LogoutButton';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import InstagramScheduleClient from './InstagramScheduleClient';

export const dynamic = 'force-dynamic';

export default async function InstagramSchedulePage() {
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">📅 Instagram予約</h1>
          <p className="text-sm text-gray-500 mt-1">
            人物・投稿日時をあらかじめ複数登録しておき、指定日時になったら自動でInstagramへ投稿します。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>
      <InstagramScheduleClient persons={personOptions} />
    </div>
  );
}
