import { getAllImportedPersons } from '@/lib/imported-persons';
import { getPublishedPersonNames } from '@/lib/published-persons';
import ImportForm from './ImportForm';
import PersonList from './PersonList';
import JobQueuePanel from './JobQueuePanel';

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
          <h1 className="text-2xl font-black text-slate-800">人物登録</h1>
          <p className="text-sm text-gray-500 mt-1">
            CSVで人物を登録し、TMDbデータ取得・公開反映まで行います。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">
            作品管理 →
          </a>
          <a href="/admin/work-import" className="text-indigo-600 hover:underline">
            作品・配信追加 →
          </a>
          <a href="/admin/import-history" className="text-gray-400 hover:underline">
            インポート履歴
          </a>
          <a href="/admin/product-check" className="text-gray-400 hover:underline">
            商品確認
          </a>
          <a href="/admin/people-membership-import" className="text-indigo-600 hover:underline">
            所属CSV更新 →
          </a>
          <a href="/admin/groups" className="text-gray-400 hover:underline">
            グループ管理
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      {/* ステップ説明 */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-8 flex-wrap">
        <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-full font-semibold">① 人物CSV登録</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full">② TMDb取得</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full">③ 作品確認</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full">④ 作品・配信補完</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full">⑤ 公開</span>
      </div>

      {/* 人物CSV登録フォーム */}
      <div className="mb-8">
        <ImportForm initialCount={imported.length} />
      </div>

      {/* ジョブキュー状況 */}
      <JobQueuePanel />

      {/* 人物一覧・データ取得・公開反映 */}
      <PersonList
        initialPersons={imported}
        initialPublishedNames={publishedNames}
      />

      {/* 次のステップ */}
      <div className="mt-12 border-t border-gray-100 pt-8">
        <p className="text-sm font-bold text-slate-700 mb-4">登録完了後の次のステップ</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/admin/work-check"
            className="flex items-start gap-4 p-5 rounded-2xl border-2 border-indigo-100 bg-indigo-50 hover:border-indigo-300 hover:bg-indigo-100 transition-colors group"
          >
            <span className="text-3xl">🎬</span>
            <div>
              <p className="font-bold text-indigo-800 group-hover:text-indigo-900">
                ① 作品確認・TMDb取得
              </p>
              <p className="text-xs text-indigo-600 mt-0.5">
                各人物のTMDb作品取得・AI判定・確認待ち承認
              </p>
              <p className="text-[10px] text-indigo-400 mt-1">/admin/work-check →</p>
            </div>
          </a>

          <a
            href="/admin/work-check"
            className="flex items-start gap-4 p-5 rounded-2xl border-2 border-teal-100 bg-teal-50 hover:border-teal-300 hover:bg-teal-100 transition-colors group"
          >
            <span className="text-3xl">📄</span>
            <div>
              <p className="font-bold text-teal-800 group-hover:text-teal-900">
                ② 補完用CSV出力
              </p>
              <p className="text-xs text-teal-600 mt-0.5">
                不足作品をCSVで出力 → ChatGPTで調査
              </p>
              <p className="text-[10px] text-teal-400 mt-1">/admin/work-check →</p>
            </div>
          </a>

          <a
            href="/admin/work-import"
            className="flex items-start gap-4 p-5 rounded-2xl border-2 border-violet-100 bg-violet-50 hover:border-violet-300 hover:bg-violet-100 transition-colors group"
          >
            <span className="text-3xl">📥</span>
            <div>
              <p className="font-bold text-violet-800 group-hover:text-violet-900">
                ③ 作品・配信情報 統合CSV追加
              </p>
              <p className="text-xs text-violet-600 mt-0.5">
                ChatGPTで調査した作品・配信情報をCSVで一括登録
              </p>
              <p className="text-[10px] text-violet-400 mt-1">/admin/work-import →</p>
            </div>
          </a>

          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 p-5 rounded-2xl border-2 border-green-100 bg-green-50 hover:border-green-300 hover:bg-green-100 transition-colors group"
          >
            <span className="text-3xl">🌐</span>
            <div>
              <p className="font-bold text-green-800 group-hover:text-green-900">
                ④ 公開ページ確認
              </p>
              <p className="text-xs text-green-600 mt-0.5">
                公開ページで表示・検索を確認
              </p>
              <p className="text-[10px] text-green-400 mt-1">/ →</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
