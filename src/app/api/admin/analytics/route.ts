import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { getAllPersonsMerged } from '@/lib/persons';
import type { Redis } from '@upstash/redis';

// ─── SCAN ヘルパー ──────────────────────────────────────────────────────────────
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

// ─── 型定義 ──────────────────────────────────────────────────────────────────────
export interface PersonViewData {
  name: string;
  group: string;
  count: number;
  lastViewedAt: number;
  productClicks: number;
}

export interface GroupViewData {
  groupName: string;
  count: number;
  lastViewedAt: number;
}

export interface SearchRankData {
  keyword: string;
  count: number;
}

export interface ProductClickData {
  productId: string;
  title: string;
  personSlug: string;
  category: string;
  count: number;
}

export interface WorkClickData {
  workId: string;
  title: string;
  personName: string;
  workType: string;
  count: number;
}

export interface VodClickData {
  service: string;
  count: number;
}

export interface AnalyticsData {
  persons: PersonViewData[];
  groups: GroupViewData[];
  searches: SearchRankData[];
  products: ProductClickData[];
  works: WorkClickData[];
  vods: VodClickData[];
  summary: {
    totalPersonViews: number;
    totalGroupViews: number;
    totalProductClicks: number;
    totalWorkClicks: number;
    totalSearches: number;
    totalVodClicks: number;
  };
}

export async function GET(): Promise<NextResponse> {
  const redis = getRedis();

  if (!redis) {
    const empty: AnalyticsData = {
      persons: [], groups: [], searches: [], products: [], works: [], vods: [],
      summary: { totalPersonViews: 0, totalGroupViews: 0, totalProductClicks: 0, totalWorkClicks: 0, totalSearches: 0, totalVodClicks: 0 },
    };
    return NextResponse.json(empty);
  }

  try {
    const allPersons = await getAllPersonsMerged();

    // ── 人物・グループ閲覧数 (pipeline) ──────────────────────────────────────────
    const groupNames = [...new Set(allPersons.map((p) => p.group).filter(Boolean))];

    const pipe1 = redis.pipeline();
    for (const p of allPersons) pipe1.hgetall(`person:view:${p.name}`);
    for (const p of allPersons) pipe1.get(`person:productClicks:${p.name}`);
    for (const g of groupNames) pipe1.hgetall(`group:view:${g}`);
    const r1 = await pipe1.exec() as unknown[];

    const n = allPersons.length;
    const g = groupNames.length;

    const persons: PersonViewData[] = allPersons
      .map((p, i) => {
        const viewData = r1[i] as Record<string, string> | null;
        const clicks = Number(r1[n + i] ?? 0);
        return {
          name: p.name,
          group: p.group,
          count: parseInt(viewData?.count ?? '0', 10) || 0,
          lastViewedAt: parseInt(viewData?.lastViewedAt ?? '0', 10) || 0,
          productClicks: isNaN(clicks) ? 0 : clicks,
        };
      })
      .filter((p) => p.count > 0 || p.productClicks > 0)
      .sort((a, b) => b.count - a.count);

    const groups: GroupViewData[] = groupNames
      .map((gName, i) => {
        const data = r1[n * 2 + i] as Record<string, string> | null;
        return {
          groupName: gName,
          count: parseInt(data?.count ?? '0', 10) || 0,
          lastViewedAt: parseInt(data?.lastViewedAt ?? '0', 10) || 0,
        };
      })
      .filter((gr) => gr.count > 0)
      .sort((a, b) => b.count - a.count);

    // ── 検索ランキング ────────────────────────────────────────────────────────────
    const searchHash = (await redis.hgetall('search:ranking')) as Record<string, string> | null;
    const searches: SearchRankData[] = Object.entries(searchHash ?? {})
      .map(([keyword, count]) => ({ keyword, count: parseInt(String(count), 10) || 0 }))
      .sort((a, b) => b.count - a.count);

    // ── 商品クリック ──────────────────────────────────────────────────────────────
    const productKeys = await scanKeys(redis, 'product:click:*');
    let products: ProductClickData[] = [];
    if (productKeys.length > 0) {
      const [counts, ...metaResults] = await Promise.all([
        redis.mget<(string | null)[]>(...productKeys),
        ...productKeys.map((k) => redis.hgetall(`product:meta:${k.replace('product:click:', '')}`)),
      ]);
      products = productKeys.map((key, i) => {
        const productId = key.replace('product:click:', '');
        const meta = metaResults[i] as Record<string, string> | null;
        return {
          productId,
          title: meta?.title ?? productId,
          personSlug: meta?.personSlug ?? '',
          category: meta?.category ?? '',
          count: parseInt(String(counts[i] ?? '0'), 10) || 0,
        };
      }).sort((a, b) => b.count - a.count);
    }

    // ── 作品クリック ──────────────────────────────────────────────────────────────
    const workKeys = await scanKeys(redis, 'work:click:*');
    let works: WorkClickData[] = [];
    if (workKeys.length > 0) {
      const [counts, ...metaResults] = await Promise.all([
        redis.mget<(string | null)[]>(...workKeys),
        ...workKeys.map((k) => redis.hgetall(`work:meta:${k.replace('work:click:', '')}`)),
      ]);
      works = workKeys.map((key, i) => {
        const workId = key.replace('work:click:', '');
        const meta = metaResults[i] as Record<string, string> | null;
        return {
          workId,
          title: meta?.title ?? workId,
          personName: meta?.personName ?? '',
          workType: meta?.workType ?? '',
          count: parseInt(String(counts[i] ?? '0'), 10) || 0,
        };
      }).sort((a, b) => b.count - a.count);
    }

    // ── VODクリック ───────────────────────────────────────────────────────────────
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

    return NextResponse.json({ persons, groups, searches, products, works, vods, summary } satisfies AnalyticsData);
  } catch (err) {
    console.error('[analytics] error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
