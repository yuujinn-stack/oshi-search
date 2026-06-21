import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks } from '@/lib/work-store';
import PersonWorks from './PersonWorks';
import CsvSection from './CsvSection';
import VodRecheckSection from './VodRecheckSection';
import AiSupplementSection from './AiSupplementSection';
import ChatGptPromptSection from './ChatGptPromptSection';

export const dynamic = 'force-dynamic';

export default async function WorkCheckPage() {
  const persons = await getAllPersonsMerged();

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
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <a href="/admin/people/import" className="text-indigo-600 hover:underline">
            ← 人物登録
          </a>
          <a href="/admin/work-import" className="text-indigo-600 hover:underline font-medium">
            作品・配信追加 →
          </a>
          <a href="/admin/providers" className="text-gray-400 hover:underline">
            配信サービス
          </a>
          <a href="/admin/product-check" className="text-gray-400 hover:underline">
            商品確認
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500 transition-colors">
            ログアウト
          </a>
        </div>
      </div>

      {/* ワークフロー概要 */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-6 flex-wrap">
        <span className="px-2.5 py-1 bg-gray-100 rounded-full">Step1 人物登録</span>
        <span className="text-gray-300">→</span>
        <span className="px-2.5 py-1 bg-indigo-600 text-white rounded-full font-semibold">Step2 作品収集</span>
        <span className="text-gray-300">→</span>
        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full">Step3 作品補完</span>
        <span className="text-gray-300">→</span>
        <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full">Step4 配信調査</span>
        <span className="text-gray-300">→</span>
        <span className="px-2.5 py-1 bg-teal-100 text-teal-700 rounded-full">Step5 配信取込</span>
        <span className="text-gray-300">→</span>
        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full">Step6 公開管理</span>
      </div>

      {/* スコア基準 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-8 text-xs text-indigo-800">
        <p className="font-bold mb-1">スコア基準</p>
        <div className="flex gap-4">
          <span>90以上 → 自動公開</span>
          <span>70〜89 → 確認待ち</span>
          <span>70未満 → 非表示</span>
        </div>
      </div>

      {/* TMDB_API_KEY 未設定の警告 */}
      {!process.env.TMDB_API_KEY && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-8 text-xs text-orange-800">
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

      {/* ════════════════════════════════════
          Step 1: 人物登録
      ════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full">Step 1</span>
          <h2 className="text-sm font-bold text-slate-700">人物登録</h2>
        </div>
        <a
          href="/admin/people/import"
          className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3 bg-white hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
        >
          <span className="text-sm text-indigo-600 font-medium">人物CSVインポート画面へ →</span>
          <span className="text-xs text-gray-400">人物名・グループ名を登録します</span>
        </a>
      </section>

      {/* ════════════════════════════════════
          Step 2: 作品収集
      ════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-600 text-white rounded-full">Step 2</span>
          <h2 className="text-sm font-bold text-slate-700">作品収集</h2>
          <span className="text-[11px] text-gray-400">TMDb取得・ステータス管理・個別配信調査はこのカードから</span>
        </div>
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
      </section>

      {/* ════════════════════════════════════
          Step 3: 作品補完 / Step 4: 配信調査
      ════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">Step 3–4</span>
          <h2 className="text-sm font-bold text-slate-700">作品補完・配信調査</h2>
          <span className="text-[11px] text-gray-400">①出演作品探しがStep3、②配信再調査（一括）がStep4に対応</span>
        </div>
        <ChatGptPromptSection persons={persons.map((p) => ({ name: p.name, group: p.group ?? '' }))} />
      </section>

      {/* ════════════════════════════════════
          Step 5: 配信取込
      ════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">Step 5</span>
          <h2 className="text-sm font-bold text-slate-700">配信取込</h2>
          <span className="text-[11px] text-gray-400">ChatGPTから返却されたCSVを取り込みます</span>
        </div>
        <CsvSection persons={persons.map((p) => ({ name: p.name, group: p.group ?? '' }))} />
      </section>

      {/* ════════════════════════════════════
          Step 6: 公開管理
      ════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">Step 6</span>
          <h2 className="text-sm font-bold text-slate-700">公開管理</h2>
        </div>
        <div className="border border-gray-200 rounded-xl px-4 py-3 bg-white text-xs text-gray-500">
          Step 2の各人物カードから、作品ごとのステータス（公開 / 確認待ち / 非表示）を変更できます。
          スコア 90以上は自動公開、70〜89は確認待ちになります。
        </div>
      </section>

      {/* ════════════════════════════════════
          補助ツール
      ════════════════════════════════════ */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">補助ツール</span>
          <h2 className="text-sm font-bold text-slate-600">補助ツール</h2>
          <span className="text-[11px] text-gray-400">AI補完候補・配信再確認リスト</span>
        </div>
        <div className="space-y-4">
          <AiSupplementSection persons={persons.map((p) => ({ name: p.name, group: p.group ?? '' }))} />
          <VodRecheckSection />
        </div>
      </section>
    </div>
  );
}
