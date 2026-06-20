import { getAllImportedPersons } from '@/lib/imported-persons';
import { getPublishedPersonNames } from '@/lib/published-persons';
import ImportForm from './ImportForm';
import PersonList from './PersonList';
import VodImportForm from './VodImportForm';

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
        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">① 人物CSV登録</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">② データ取得</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full font-medium">③ 配信情報CSV</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full font-medium">④ 公開反映</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full font-medium">公開ページに即時反映</span>
      </div>

      {/* ① 人物CSV インポートフォーム */}
      <div className="mb-2">
        <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
          人物CSV
        </h2>
        <ImportForm initialCount={imported.length} />
      </div>

      {/* ③ 配信情報CSV インポートフォーム */}
      <div className="mb-2 mt-8">
        <h2 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">3</span>
          配信情報CSV
          <span className="text-xs font-normal text-gray-400">（データ取得後に実行）</span>
        </h2>
        <p className="text-xs text-gray-500 mb-3 ml-7">
          OpenAI を使わず、CSVで直接配信情報を登録します。作品タイトルで TMDb 取得済み作品と照合します。
        </p>
        <VodImportForm />
      </div>

      {/* ② + ④ 人物一覧・データ取得・公開反映 */}
      <PersonList
        initialPersons={imported}
        initialPublishedNames={publishedNames}
      />
    </div>
  );
}
