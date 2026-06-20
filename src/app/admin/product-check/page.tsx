import { getAllPersonsMerged } from '@/lib/persons';
import { getBatchMeta, getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import BatchButton from './BatchButton';
import PersonProducts from './PersonProducts';
import UncertainQueue from './UncertainQueue';
import PersonAiJudgeButton from './PersonAiJudgeButton';

interface PersonStats {
  total: number;
  related: number;
  uncertain: number;
  unrelated: number;
  unclassified: number;
}

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
  // エラーを画面に表示して本番クラッシュの原因を特定する（診断用）
  let persons: Awaited<ReturnType<typeof getAllPersonsMerged>>;
  let batchMeta: Awaited<ReturnType<typeof getBatchMeta>>;
  try {
    persons = await getAllPersonsMerged();
  } catch (err) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-red-600 font-bold text-lg mb-2">getAllPersonsMerged エラー</p>
        <pre className="text-left bg-red-50 p-4 rounded text-xs overflow-auto">{String(err)}</pre>
      </div>
    );
  }
  try {
    batchMeta = await getBatchMeta();
  } catch (err) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-red-600 font-bold text-lg mb-2">getBatchMeta エラー</p>
        <pre className="text-left bg-red-50 p-4 rounded text-xs overflow-auto">{String(err)}</pre>
        <p className="text-sm text-gray-500 mt-4">Vercel 環境変数: UPSTASH_REDIS_REST_URL={process.env.UPSTASH_REDIS_REST_URL ? '設定あり' : '未設定'}</p>
      </div>
    );
  }

  const sorted = [...persons].sort((a, b) => {
    const order: Record<string, number> = { needs_fix: 0, unchecked: 1, ok: 2 };
    return (order[a.config.checkStatus ?? 'unchecked'] ?? 1) -
           (order[b.config.checkStatus ?? 'unchecked'] ?? 1);
  });

  // 全人物の判定統計を並列取得（取得漏れ vs AI除外を診断するため）
  const statsMap: Record<string, PersonStats> = {};
  try {
    const statsArr = await Promise.all(
      persons.map(async (p) => {
        try {
          const [storedData, verdicts] = await Promise.all([
            getAllStoredProducts(p.name),
            getAllVerdicts(p.name),
          ]);
          const total = Object.values(storedData)
            .reduce((sum, d) => sum + (d?.products.length ?? 0), 0);
          const counts = { related: 0, uncertain: 0, unrelated: 0 };
          for (const v of Object.values(verdicts)) {
            if (v.verdict in counts) counts[v.verdict as keyof typeof counts]++;
          }
          const unclassified = Math.max(0, total - Object.keys(verdicts).length);
          return { name: p.name, total, unclassified, ...counts };
        } catch {
          return { name: p.name, total: 0, related: 0, uncertain: 0, unrelated: 0, unclassified: 0 };
        }
      })
    );
    for (const s of statsArr) statsMap[s.name] = s;
  } catch { /* 統計取得失敗時は表示なし */ }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">商品確認 管理画面</h1>
          <p className="text-sm text-gray-500 mt-1">全{persons.length}件の登録人物</p>
        </div>
        <div className="flex items-center gap-4 mt-1">
          <a href="/admin/work-check" className="text-xs text-indigo-600 hover:underline">
            出演作品管理 →
          </a>
          <a href="/admin/providers" className="text-xs text-indigo-600 hover:underline">
            配信サービス管理 →
          </a>
          <a href="/admin/people/import" className="text-xs text-indigo-600 hover:underline">
            人物CSV登録 →
          </a>
          <a href="/api/admin/logout" className="text-xs text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
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
          <BatchButton personNames={persons.map((p) => p.name)} />
        </div>
      </div>

      {/* フロー説明 */}
      <div className="grid grid-cols-3 gap-3 mb-6 text-center text-xs">
        {[
          { icon: '🤖', label: 'AI判定', desc: '全商品を GPT-4o-mini で分類' },
          { icon: '✅', label: 'related → 表示', desc: '本人作品・グッズ等、自動で掲載' },
          { icon: '👤', label: 'uncertain → 確認', desc: '「AI判定待ち」欄で採用/非表示を選択' },
        ].map((s) => (
          <div key={s.label} className="bg-gray-50 rounded-xl p-3">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="font-bold text-slate-700">{s.label}</div>
            <div className="text-gray-500 mt-0.5">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* AI判定待ちキュー */}
      <UncertainQueue />

      {/* 人物リスト */}
      <div className="space-y-3">
        {sorted.map((p) => {
          const status = p.config.checkStatus ?? 'unchecked';
          return (
            <div key={p.name}>
              {/* 人物ヘッダー */}
              <div className="px-4 py-2 bg-gray-50 border border-b-0 border-gray-200 rounded-t-xl">
                <div className="flex items-center gap-3">
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
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    <PersonAiJudgeButton personName={p.name} />
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                </div>
                {/* 取得・判定統計（取得漏れ vs AI除外の診断用） */}
                {(() => {
                  const s = statsMap[p.name];
                  if (!s || s.total === 0) return null;
                  return (
                    <div className="flex gap-3 mt-1 text-xs">
                      <span className="text-gray-500">取得 {s.total}件</span>
                      <span className="text-green-600">related {s.related}</span>
                      <span className="text-yellow-600">uncertain {s.uncertain}</span>
                      <span className="text-red-500">unrelated {s.unrelated}</span>
                      {s.unclassified > 0 && (
                        <span className="text-gray-400">未判定 {s.unclassified}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <PersonProducts personName={p.name} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
