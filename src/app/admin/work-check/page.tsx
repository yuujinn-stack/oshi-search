import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks } from '@/lib/work-store';
import PersonWorks from './PersonWorks';
import CsvSection from './CsvSection';

export const dynamic = 'force-dynamic';

export default async function WorkCheckPage() {
  const persons = getAllPersonsWithConfig();

  // 全人物の作品件数を並列取得
  const countResults = await Promise.all(
    persons.map(async (p) => {
      try {
        const works = await getAllWorks(p.name);
        return {
          name: p.name,
          total: works.length,
          published: works.filter((w) => w.status === 'auto_published').length,
          review: works.filter((w) => w.status === 'needs_review').length,
          hidden: works.filter((w) => w.status === 'hidden').length,
        };
      } catch {
        return { name: p.name, total: 0, published: 0, review: 0, hidden: 0 };
      }
    }),
  );

  const countMap = Object.fromEntries(countResults.map((c) => [c.name, c]));
  const totalReview = countResults.reduce((sum, c) => sum + c.review, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">出演作品 管理画面</h1>
          <p className="text-sm text-gray-500 mt-1">
            全{persons.length}人 ／ 確認待ち {totalReview}件
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a href="/admin/product-check" className="text-xs text-indigo-600 hover:underline">
            ← 商品確認
          </a>
          <a href="/admin/providers" className="text-xs text-indigo-600 hover:underline">
            配信サービス管理 →
          </a>
          <a
            href="/api/admin/logout"
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            ログアウト
          </a>
        </div>
      </div>

      {/* フロー説明 */}
      <div className="grid grid-cols-3 gap-3 mb-8 text-center text-xs">
        {[
          { icon: '🎬', label: 'TMDb取得', desc: '人物名で出演作品を自動取得' },
          { icon: '🤖', label: 'AI判定', desc: 'スコアで3段階に自動分類' },
          { icon: '✅', label: '曖昧作品を確認', desc: '確認待ちのみ管理画面で判断' },
        ].map((s) => (
          <div key={s.label} className="bg-gray-50 rounded-xl p-3">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="font-bold text-slate-700">{s.label}</div>
            <div className="text-gray-500 mt-0.5">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* スコア基準 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6 text-xs text-indigo-800">
        <p className="font-bold mb-1">スコア基準</p>
        <div className="flex gap-4">
          <span>90以上 → 自動公開</span>
          <span>70〜89 → 確認待ち</span>
          <span>70未満 → 非表示</span>
        </div>
      </div>

      {/* TMDB_API_KEY 未設定の警告 */}
      {!process.env.TMDB_API_KEY && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 text-xs text-orange-800">
          <p className="font-bold">⚠️ TMDB_API_KEY が設定されていません</p>
          <p className="mt-1">
            TMDb API キーを環境変数に設定してください。
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline ml-1"
            >
              TMDb API設定ページ
            </a>
          </p>
        </div>
      )}

      {/* CSV出力 / VOD調査インポート */}
      <CsvSection persons={persons.map((p) => p.name)} />

      {/* 人物リスト */}
      <div className="space-y-3">
        {persons.map((p) => (
          <PersonWorks
            key={p.name}
            personName={p.name}
            group={p.group ?? ''}
            counts={countMap[p.name] ?? { total: 0, published: 0, review: 0, hidden: 0 }}
          />
        ))}
      </div>
    </div>
  );
}
