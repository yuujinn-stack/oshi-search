import { getAllImportedPersons } from '@/lib/imported-persons';
import { getPublishedPersonNames } from '@/lib/published-persons';
import ImportForm from './ImportForm';
import PersonList from './PersonList';

export const dynamic = 'force-dynamic';

export default async function PeopleImportPage() {
  let imported: Awaited<ReturnType<typeof getAllImportedPersons>> = [];
  let publishedNames: string[] = [];

  try {
    [imported, publishedNames] = await Promise.all([
      getAllImportedPersons(),
      getPublishedPersonNames(),
    ]);
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
            CSVで人物を登録 → データ取得 → 公開反映まで管理画面で完結できます。
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

      {/* フロー説明 */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6 flex-wrap">
        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">① CSV登録</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">② データ取得</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full font-medium">③ 公開反映</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full font-medium">公開ページに即時反映</span>
      </div>

      {/* ① CSV インポートフォーム */}
      <ImportForm initialCount={imported.length} />

      {/* ② + ③ 人物一覧・データ取得・公開反映 */}
      <PersonList
        initialPersons={imported}
        initialPublishedNames={publishedNames}
      />
    </div>
  );
}
