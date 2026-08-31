import { getAllAffiliateProgramsOrThrow } from '@/lib/affiliate-store';
import { LogoutButton } from '@/components/admin/LogoutButton';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import AffiliateManager from './AffiliateManager';

export const dynamic = 'force-dynamic';

export default async function AdminAffiliatesPage() {
  let programs: Awaited<ReturnType<typeof getAllAffiliateProgramsOrThrow>>;
  try {
    programs = await getAllAffiliateProgramsOrThrow();
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">VODアフィリエイト広告管理</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            VODサービスとのアフィリエイト提携（ASP案件・広告素材・掲載位置）を管理します。
            ここに登録していない、または無効化したサービスは、これまで通り既存のVOD配信リンクがそのまま表示されます。
          </p>
        </div>
        <div className="flex items-center gap-4 mt-1 flex-shrink-0">
          <a href="/admin/providers" className="text-xs text-indigo-600 hover:underline">
            配信サービス管理 →
          </a>
          <LogoutButton className="text-xs text-gray-400 hover:text-red-500" />
        </div>
      </div>

      <AffiliateManager initialPrograms={programs} />
    </div>
  );
}
