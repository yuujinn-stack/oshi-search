import { getAllImportedPersons } from '@/lib/imported-persons';
import ImportForm from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function PeopleImportPage() {
  let imported: Awaited<ReturnType<typeof getAllImportedPersons>> = [];
  try {
    imported = await getAllImportedPersons();
  } catch {
    // Redis 未接続時は空リスト
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">人物CSV一括登録</h1>
          <p className="text-sm text-gray-500 mt-1">
            CSVでまとめて人物を登録します。登録後にバッチ処理で出演作品・楽天商品を取得できます。
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

      <ImportForm initialCount={imported.length} />

      {/* インポート済み人物一覧 */}
      {imported.length > 0 && (
        <div className="mt-8 bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-bold text-slate-700 text-sm">
              インポート済み人物
              <span className="ml-2 text-gray-400 font-normal text-xs">{imported.length}件</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              ※ 公開ページへの反映には persons_master.json への追記（リポジトリコミット）が別途必要です
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">名前</th>
                  <th className="px-4 py-2 font-medium">グループ</th>
                  <th className="px-4 py-2 font-medium">ジャンル</th>
                  <th className="px-4 py-2 font-medium">aliases</th>
                  <th className="px-4 py-2 font-medium">TMDb ID</th>
                  <th className="px-4 py-2 font-medium">登録日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {imported.map((p) => (
                  <tr key={p.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-2 text-gray-600">{p.group || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{p.genre}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {p.aliases.length > 0 ? p.aliases.join('、') : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {p.tmdbPersonId ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {new Date(p.importedAt).toLocaleString('ja-JP', {
                        month: 'numeric', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
