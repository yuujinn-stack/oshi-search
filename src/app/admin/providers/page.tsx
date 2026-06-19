import { getAllProviders } from '@/lib/provider-store';
import ProviderManager from './ProviderManager';

export const dynamic = 'force-dynamic';

export default async function AdminProvidersPage() {
  let providers: Awaited<ReturnType<typeof getAllProviders>> = [];
  try {
    providers = await getAllProviders();
  } catch {
    // Redis 未接続時は空リストで表示
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
          <a href="/api/admin/logout" className="text-xs text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      <ProviderManager initialProviders={providers} />
    </div>
  );
}
