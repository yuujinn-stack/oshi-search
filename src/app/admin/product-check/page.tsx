import { getAllPersonsMerged } from '@/lib/persons';
import { getBatchMeta, getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { getAllImportedPersonsOrThrow } from '@/lib/imported-persons';
import { getRedis } from '@/lib/redis';
import { pingRedis } from '@/lib/redis-health';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import BatchButton from './BatchButton';
import ProductCheckPersonSection from './ProductCheckPersonSection';
import UncertainQueue from './UncertainQueue';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';
import type { PersonWithProductStats } from './ProductCheckPersonSection';

export const dynamic = 'force-dynamic';

export default async function AdminProductCheckPage() {
  const health = await pingRedis();
  if (!health.ok) {
    return <RedisErrorBanner detail={health.error} />;
  }

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

  // importedPersons（aliases/importedAt/dataFetchStatus） + personMetaMap（memo/priority）を並列取得
  let importedPersons: Awaited<ReturnType<typeof getAllImportedPersonsOrThrow>> = [];
  let personMetaMap: Record<string, PersonMeta> = {};
  try {
    importedPersons = await getAllImportedPersonsOrThrow();
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.hgetall('admin:person-meta');
      if (raw) {
        for (const [k, v] of Object.entries(raw)) {
          try {
            personMetaMap[k] = (typeof v === 'string' ? JSON.parse(v) : v) as PersonMeta;
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* 取得失敗時は空のまま */ }

  const importedMap = new Map(importedPersons.map((p) => [p.name, p]));

  // 全人物の判定統計を並列取得
  interface PersonStats {
    total: number;
    related: number;
    uncertain: number;
    unrelated: number;
    unclassified: number;
  }
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

  // enrichedPersons: 全人物情報を統合
  const enrichedPersons: PersonWithProductStats[] = persons.map((p) => {
    const imported = importedMap.get(p.name);
    const meta = personMetaMap[p.name];
    return {
      name: p.name,
      group: p.group ?? '',
      genre: p.genre,
      aliases: imported?.aliases ?? p.config.aliases ?? [],
      importedAt: imported?.importedAt,
      dataFetchStatus: imported?.dataFetchStatus,
      checkStatus: (p.config.checkStatus ?? 'unchecked') as 'ok' | 'needs_fix' | 'unchecked',
      strictMode: p.config.strictMode,
      customKeywords: p.config.customKeywords,
      stats: statsMap[p.name] ?? { total: 0, related: 0, uncertain: 0, unrelated: 0, unclassified: 0 },
      memo: meta?.memo,
      priority: meta?.priority as PersonPriority | undefined,
      activityStatus: meta?.activityStatus,
      generation: meta?.generation,
      joinedAt: meta?.joinedAt,
      leftAt: meta?.leftAt,
      currentGroupName: meta?.currentGroupName,
      formerGroupNames: meta?.formerGroupNames,
      membershipNote: meta?.membershipNote,
    };
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">商品確認 管理画面</h1>
          <p className="text-sm text-gray-500 mt-1">全{persons.length}件の登録人物</p>
        </div>
        <div className="flex items-center gap-4 mt-1 flex-wrap text-xs">
          <a href="/admin/rakuten-search" className="text-indigo-600 hover:underline font-medium">
            楽天商品検索 →
          </a>
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">
            出演作品管理 →
          </a>
          <a href="/admin/people-progress" className="text-indigo-600 hover:underline">
            人物進捗 →
          </a>
          <a href="/admin/providers" className="text-gray-400 hover:underline">
            配信サービス管理
          </a>
          <a href="/admin/people/import" className="text-gray-400 hover:underline">
            人物CSV登録
          </a>
          <a href="/admin/groups" className="text-gray-400 hover:underline">
            グループ管理
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
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

      {/* 人物リスト（検索・フィルター付き） */}
      <ProductCheckPersonSection persons={enrichedPersons} />
    </div>
  );
}
