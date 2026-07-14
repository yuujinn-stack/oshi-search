import { getAllProvidersOrThrow } from '@/lib/provider-store';
import { LogoutButton } from '@/components/admin/LogoutButton';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import ProviderManager from './ProviderManager';

export const dynamic = 'force-dynamic';

export default async function AdminProvidersPage() {
  let providers: Awaited<ReturnType<typeof getAllProvidersOrThrow>>;
  try {
    providers = await getAllProvidersOrThrow();
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">配信サービス管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            ロゴURLを登録・編集します。変更は全ページに自動反映されます。
          </p>
        </div>
        <div className="flex items-center gap-4 mt-1">
          <a href="/admin/product-check" className="text-xs text-indigo-600 hover:underline">
            商品確認 →
          </a>
          <a href="/admin/work-check" className="text-xs text-indigo-600 hover:underline">
            作品管理 →
          </a>
          <LogoutButton className="text-xs text-gray-400 hover:text-red-500" />
        </div>
      </div>

      <ProviderManager initialProviders={providers} />
    </div>
  );
}
