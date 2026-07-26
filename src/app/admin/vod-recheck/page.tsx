import { fetchRecheckListPage, type RecheckListResult } from '@/lib/vod-recheck-list';
import { DEFAULT_PAGE_SIZE } from '@/lib/vod-recheck-store';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import VodRecheckClient from './VodRecheckClient';

export const dynamic = 'force-dynamic';

export default async function VodRecheckPage() {
  let initial: RecheckListResult;
  try {
    initial = await fetchRecheckListPage({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  } catch (err) {
    return <RedisErrorBanner title="VOD再確認一覧を取得できません" detail={String(err)} />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-slate-800 mb-1">VOD再確認優先度管理</h1>
      <p className="text-sm text-gray-500 mb-6">
        180日以上未確認・unknownのみ・有効VODなし・アクセス上位などの理由で再確認が必要な作品を優先度順に表示します。
      </p>
      <VodRecheckClient initial={initial} />
    </div>
  );
}
