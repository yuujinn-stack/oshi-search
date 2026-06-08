import { getAllPersonsWithConfig } from '@/lib/persons';
import { getBatchMeta } from '@/lib/product-store';
import BatchButton from './BatchButton';
import PersonProducts from './PersonProducts';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  needs_fix: 'bg-red-100 text-red-700',
  unchecked: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  needs_fix: '要修正',
  unchecked: '未確認',
};

export default async function AdminProductCheckPage() {
  const persons = getAllPersonsWithConfig();
  const batchMeta = await getBatchMeta();

  const sorted = [...persons].sort((a, b) => {
    const order: Record<string, number> = { needs_fix: 0, unchecked: 1, ok: 2 };
    return (order[a.config.checkStatus ?? 'unchecked'] ?? 1) -
           (order[b.config.checkStatus ?? 'unchecked'] ?? 1);
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">商品確認 管理画面</h1>
          <p className="text-sm text-gray-500 mt-1">全{persons.length}件の登録人物</p>
        </div>
        <a href="/api/admin/logout" className="text-xs text-gray-400 hover:text-red-500 mt-1">
          ログアウト
        </a>
      </div>

      {/* バッチ実行パネル */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-bold text-indigo-900 text-sm mb-1">商品情報の一括取得・AI判定</h2>
            <p className="text-xs text-indigo-700">
              全登録人物の楽天商品を取得し、関連度スコアとAIで自動分類します。<br />
              所要時間: 約1〜2分（毎日 03:00 JST に自動実行）
            </p>
            {batchMeta ? (
              <p className="text-xs text-indigo-600 mt-2">
                前回実行: {new Date(batchMeta.lastRunAt).toLocaleString('ja-JP')}
                　{batchMeta.personCount}人処理　AI判定 {batchMeta.aiJudged}件
              </p>
            ) : (
              <p className="text-xs text-orange-600 mt-2 font-medium">
                ⚠️ バッチ未実行。初回セットアップとして実行してください。
              </p>
            )}
          </div>
          <BatchButton />
        </div>
      </div>

      {/* フロー説明 */}
      <div className="grid grid-cols-3 gap-3 mb-8 text-center text-xs">
        {[
          { icon: '⚙️', label: 'ルール判定', desc: 'スコア≥閾値 → 自動で「表示」' },
          { icon: '🤖', label: 'AI判定', desc: '曖昧な商品 → GPT-4o-mini で分類' },
          { icon: '👤', label: '手動確認', desc: '「要確認」→ このページで判定' },
        ].map((s) => (
          <div key={s.label} className="bg-gray-50 rounded-xl p-3">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="font-bold text-slate-700">{s.label}</div>
            <div className="text-gray-500 mt-0.5">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* 人物リスト */}
      <div className="space-y-3">
        {sorted.map((p) => {
          const status = p.config.checkStatus ?? 'unchecked';
          return (
            <div key={p.name}>
              {/* 人物ヘッダー */}
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border border-b-0 border-gray-200 rounded-t-xl">
                <span className="font-medium text-slate-800 text-sm">{p.name}</span>
                {p.group && <span className="text-xs text-gray-400">{p.group}</span>}
                {p.config.strictMode && (
                  <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full">
                    strict
                  </span>
                )}
                {p.config.customKeywords && p.config.customKeywords.length > 0 && (
                  <span className="text-xs text-indigo-500 truncate max-w-[120px]">
                    +{p.config.customKeywords.join(', ')}
                  </span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ml-auto flex-shrink-0 ${STATUS_BADGE[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
              </div>
              <PersonProducts personName={p.name} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
