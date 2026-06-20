import WorkVodImportForm from './WorkVodImportForm';

export const dynamic = 'force-dynamic';

export default function WorkImportPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">作品・配信情報 統合CSVインポート</h1>
          <p className="text-sm text-gray-500 mt-1">
            ChatGPTで調査した作品情報と配信情報を1枚のCSVで一括登録します。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">
            ← 作品管理
          </a>
          <a href="/admin/people/import" className="text-gray-400 hover:underline">
            人物登録
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      {/* ステップ位置表示 */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-8 flex-wrap">
        <span className="px-3 py-1.5 bg-gray-100 text-gray-400 rounded-full">① 人物CSV登録</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-400 rounded-full">② 作品確認</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-400 rounded-full">③ 補完用CSV出力</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-violet-600 text-white rounded-full font-semibold">④ 作品・配信情報追加</span>
        <span className="text-gray-300">→</span>
        <span className="px-3 py-1.5 bg-gray-100 text-gray-400 rounded-full">⑤ 公開</span>
      </div>

      {/* 処理フロー説明 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 text-xs text-center">
        {[
          {
            step: '①',
            title: '人物確認',
            desc: 'personName でシステム登録済み人物を照合。未登録はスキップ。',
            color: 'bg-indigo-50 border-indigo-200 text-indigo-800',
          },
          {
            step: '②',
            title: '作品照合',
            desc: 'workTitle + workType + releaseYear で既存作品を検索。一致すれば配信情報のみ追加。',
            color: 'bg-teal-50 border-teal-200 text-teal-800',
          },
          {
            step: '③',
            title: '作品なしなら新規作成',
            desc: '既存作品が見つからない場合は「確認待ち」で新規作成し、配信情報を追加。',
            color: 'bg-violet-50 border-violet-200 text-violet-800',
          },
        ].map((s) => (
          <div key={s.step} className={`border rounded-xl p-4 ${s.color}`}>
            <div className="font-black text-lg mb-1">{s.step}</div>
            <div className="font-bold mb-1">{s.title}</div>
            <div className="opacity-80">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* フォーム */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <WorkVodImportForm />
      </div>
    </div>
  );
}
