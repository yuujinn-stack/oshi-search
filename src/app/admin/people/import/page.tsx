import { getAllImportedPersons } from '@/lib/imported-persons';
import ImportForm from './ImportForm';
import PersonList from './PersonList';

export const dynamic = 'force-dynamic';

export default async function PeopleImportPage() {
  let imported: Awaited<ReturnType<typeof getAllImportedPersons>> = [];
  try {
    imported = await getAllImportedPersons();
  } catch {
    // Redis 未接続時は空リスト
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">人物CSV一括登録</h1>
          <p className="text-sm text-gray-500 mt-1">
            CSVでまとめて人物を登録し、出演作品・楽天商品を取得できます。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <a href="/admin/product-check" className="text-xs text-indigo-600 hover:underline">
            商品確認 →
          </a>
          <a href="/admin/work-check" className="text-xs text-indigo-600 hover:underline">
            作品管理 →
          </a>
          <a href="/admin/providers" className="text-xs text-indigo-600 hover:underline">
            配信サービス →
          </a>
          <a href="/api/admin/logout" className="text-xs text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      {/* CSV インポートフォーム */}
      <ImportForm initialCount={imported.length} />

      {/* インポート済み人物一覧 + データ取得操作 */}
      <PersonList initialPersons={imported} />
    </div>
  );
}
