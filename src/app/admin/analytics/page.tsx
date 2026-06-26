export const dynamic = 'force-dynamic';

import { getRedis } from '@/lib/redis';
import { getAllPersonsMerged } from '@/lib/persons';
import AnalyticsDashboard from './AnalyticsDashboard';
import type {
  AnalyticsData, PersonViewData, GroupViewData,
  SearchRankData, ProductClickData, WorkClickData, VodClickData,
} from '@/app/api/admin/analytics/route';
import type { Redis } from '@upstash/redis';

// ─── SCAN ヘルパー ────────────────────────────────────────────────────────────
async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  return keys;
}

const EMPTY: AnalyticsData = {
  persons: [], groups: [], searches: [], products: [], works: [], vods: [],
  summary: {
    totalPersonViews: 0, totalGroupViews: 0, totalProductClicks: 0,
    totalWorkClicks: 0, totalSearches: 0, totalVodClicks: 0,
  },
};

export default async function AnalyticsPage() {
  const redis = getRedis();

  let analyticsData: AnalyticsData = EMPTY;

  if (redis) {
    try {
      const allPersons = await getAllPersonsMerged();
      const groupNames = [...new Set(allPersons.map((p) => p.group).filter(Boolean))];

      // ── 人物・グループ閲覧数 + 商品クリック数 (pipeline) ─────────────────────
      const pipe = redis.pipeline();
      for (const p of allPersons) pipe.hgetall(`person:view:${p.name}`);
      for (const p of allPersons) pipe.get(`person:productClicks:${p.name}`);
      for (const g of groupNames) pipe.hgetall(`group:view:${g}`);
      const pipeResults = await pipe.exec() as unknown[];

      const n = allPersons.length;

      const persons: PersonViewData[] = allPersons
        .map((p, i) => {
          const vd = pipeResults[i] as Record<string, string> | null;
          const clicks = Number(pipeResults[n + i] ?? 0);
          return {
            name: p.name,
            group: p.group,
            count: parseInt(vd?.count ?? '0', 10) || 0,
            lastViewedAt: parseInt(vd?.lastViewedAt ?? '0', 10) || 0,
            productClicks: isNaN(clicks) ? 0 : clicks,
          };
        })
        .filter((p) => p.count > 0 || p.productClicks > 0)
        .sort((a, b) => b.count - a.count);

      const groups: GroupViewData[] = groupNames
        .map((g, i) => {
          const d = pipeResults[n * 2 + i] as Record<string, string> | null;
          return {
            groupName: g,
            count: parseInt(d?.count ?? '0', 10) || 0,
            lastViewedAt: parseInt(d?.lastViewedAt ?? '0', 10) || 0,
          };
        })
        .filter((g) => g.count > 0)
        .sort((a, b) => b.count - a.count);

      // ── 検索ランキング ─────────────────────────────────────────────────────────
      const searchHash = (await redis.hgetall('search:ranking')) as Record<string, string> | null;
      const searches: SearchRankData[] = Object.entries(searchHash ?? {})
        .map(([keyword, count]) => ({ keyword, count: parseInt(String(count), 10) || 0 }))
        .sort((a, b) => b.count - a.count);

      // ── 商品クリック (SCAN) ────────────────────────────────────────────────────
      const productKeys = await scanKeys(redis, 'product:click:*');
      let products: ProductClickData[] = [];
      if (productKeys.length > 0) {
        const counts = await redis.mget<(string | null)[]>(...productKeys);
        const metaPipe = redis.pipeline();
        for (const k of productKeys) {
          metaPipe.hgetall(`product:meta:${k.replace('product:click:', '')}`);
        }
        const metas = await metaPipe.exec() as unknown[];
        products = productKeys.map((key, i) => {
          const productId = key.replace('product:click:', '');
          const meta = metas[i] as Record<string, string> | null;
          return {
            productId,
            title: meta?.title ?? productId,
            personSlug: meta?.personSlug ?? '',
            category: meta?.category ?? '',
            count: parseInt(String(counts[i] ?? '0'), 10) || 0,
          };
        }).sort((a, b) => b.count - a.count);
      }

      // ── 作品クリック (SCAN) ────────────────────────────────────────────────────
      const workKeys = await scanKeys(redis, 'work:click:*');
      let works: WorkClickData[] = [];
      if (workKeys.length > 0) {
        const counts = await redis.mget<(string | null)[]>(...workKeys);
        const metaPipe = redis.pipeline();
        for (const k of workKeys) {
          metaPipe.hgetall(`work:meta:${k.replace('work:click:', '')}`);
        }
        const metas = await metaPipe.exec() as unknown[];
        works = workKeys.map((key, i) => {
          const workId = key.replace('work:click:', '');
          const meta = metas[i] as Record<string, string> | null;
          return {
            workId,
            title: meta?.title ?? workId,
            personName: meta?.personName ?? '',
            workType: meta?.workType ?? '',
            count: parseInt(String(counts[i] ?? '0'), 10) || 0,
          };
        }).sort((a, b) => b.count - a.count);
      }

      // ── VODクリック (SCAN) ─────────────────────────────────────────────────────
      const vodKeys = await scanKeys(redis, 'vod:click:*');
      let vods: VodClickData[] = [];
      if (vodKeys.length > 0) {
        const counts = await redis.mget<(string | null)[]>(...vodKeys);
        vods = vodKeys.map((key, i) => ({
          service: key.replace('vod:click:', ''),
          count: parseInt(String(counts[i] ?? '0'), 10) || 0,
        })).sort((a, b) => b.count - a.count);
      }

      const summary = {
        totalPersonViews: persons.reduce((s, p) => s + p.count, 0),
        totalGroupViews: groups.reduce((s, g) => s + g.count, 0),
        totalProductClicks: products.reduce((s, p) => s + p.count, 0),
        totalWorkClicks: works.reduce((s, w) => s + w.count, 0),
        totalSearches: searches.reduce((s, r) => s + r.count, 0),
        totalVodClicks: vods.reduce((s, v) => s + v.count, 0),
      };

      analyticsData = { persons, groups, searches, products, works, vods, summary };
    } catch (err) {
      console.error('[admin/analytics] fetch error:', err);
    }
  }

  const { summary } = analyticsData;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-800">📊 アナリティクス</h1>
          <p className="text-sm text-gray-500 mt-1">
            閲覧数・クリック数・検索ランキングを確認できます
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
          <span>最終更新: {new Date().toLocaleString('ja-JP')}</span>
          <a href="/admin/analytics" className="text-indigo-600 hover:underline">更新</a>
        </div>
      </div>

      {!getRedis() && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 mb-6">
          Redis が未接続のためデータが取得できません。環境変数 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を確認してください。
        </div>
      )}

      {/* サマリー帯 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { icon: '👤', label: '人物閲覧', value: summary.totalPersonViews, color: 'text-indigo-600' },
          { icon: '🛍', label: '商品クリック', value: summary.totalProductClicks, color: 'text-orange-600' },
          { icon: '🔍', label: '検索数', value: summary.totalSearches, color: 'text-emerald-600' },
          { icon: '▶', label: 'VODクリック', value: summary.totalVodClicks, color: 'text-green-600' },
        ].map(({ icon, label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xl mb-1">{icon}</p>
            <p className="text-xs text-gray-400 font-medium">{label}</p>
            <p className={`text-2xl font-black tabular-nums mt-0.5 ${color}`}>
              {value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <AnalyticsDashboard data={analyticsData} />
    </div>
  );
}
