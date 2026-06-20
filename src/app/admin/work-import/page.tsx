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
            作品管理 →
          </a>
          <a href="/admin/people/import" className="text-indigo-600 hover:underline">
            人物CSV登録 →
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>

      {/* 動作フロー説明 */}
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
            color: 'bg-blue-50 border-blue-200 text-blue-800',
          },
        ].map((s) => (
          <div key={s.step} className={`border rounded-xl p-4 ${s.color}`}>
            <div className="font-black text-lg mb-1">{s.step}</div>
            <div className="font-bold mb-1">{s.title}</div>
            <div className="opacity-80">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* 既存機能との違い */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 mb-8 text-xs text-gray-600 space-y-1">
        <p className="font-semibold text-slate-700 mb-2">既存機能との違い</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <div>
            <span className="font-medium text-slate-600">配信情報CSV（既存）</span>
            <span className="ml-2 text-gray-400">→ TMDb取得済み作品への配信情報追加のみ</span>
          </div>
          <div>
            <span className="font-medium text-indigo-600">統合CSV（本機能）</span>
            <span className="ml-2 text-gray-400">→ 作品の新規作成 ＋ 配信情報追加を同時実行</span>
          </div>
        </div>
        <p className="text-gray-400 text-[10px] mt-2">
          ※ TMDbにない作品（バラエティ・アイドル番組等）をChatGPTで調査してCSV化し、そのまま投入できます。
        </p>
      </div>

      {/* フォーム */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <WorkVodImportForm />
      </div>
    </div>
  );
}
