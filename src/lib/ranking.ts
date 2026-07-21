import { getRedis } from '@/lib/redis';
import { getAllPersonsMerged } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import { isConfirmedVodAvailability } from '@/lib/vod-dedup';
import type { Redis } from '@upstash/redis';
import type { Person } from '@/types/person';

// ─── 型定義 ──────────────────────────────────────────────────────────────────────
export interface RankedPerson {
  name: string;
  group: string;
  genre: string;
  viewCount: number;
  productCount: number;
  workCount: number;
  streamingCount: number;
}

export interface RankedWork {
  workId: string;
  title: string;
  personName: string;
  workType: string;
  posterUrl: string;
  detailUrl: string;
  clickCount: number;
}

export interface RankedProduct {
  productId: string;
  title: string;
  personSlug: string;
  category: string;
  imageUrl: string;
  affiliateUrl: string;
  clickCount: number;
}

export interface RankedSearch {
  keyword: string;
  count: number;
}

export interface RankingData {
  /** 閲覧数降順 TOP8 */
  popularPersons: RankedPerson[];
  /** 急上昇: 現時点では popularPersons と同一（将来: 期間比較データで差し替え） */
  risingPersons: RankedPerson[];
  popularSearches: RankedSearch[];
  popularWorks: RankedWork[];
  popularProducts: RankedProduct[];
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────────
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

function makePersonFallback(persons: Person[]): RankedPerson[] {
  return persons.slice(0, 8).map((p) => ({
    name: p.name,
    group: p.group,
    genre: p.genre,
    viewCount: 0,
    productCount: 0,
    workCount: 0,
    streamingCount: 0,
  }));
}

// ─── メイン ──────────────────────────────────────────────────────────────────────
export async function getRankingData(): Promise<RankingData> {
  const allPersons = await getAllPersonsMerged();
  const redis = getRedis();

  const fallbackPersons = makePersonFallback(allPersons);
  const emptyRanking: RankingData = {
    popularPersons: fallbackPersons,
    risingPersons: fallbackPersons,
    popularSearches: [],
    popularWorks: [],
    popularProducts: [],
  };

  if (!redis) return emptyRanking;

  try {
  // ── 1. 人物閲覧数 + 検索ランキング + SCAN キー を並列取得 ─────────────────────
  const pipe = redis.pipeline();
  for (const p of allPersons) pipe.hgetall(`person:view:${p.name}`);
  const [pipeResults, searchHash, workKeys, productKeys] = await Promise.all([
    pipe.exec() as Promise<unknown[]>,
    redis.hgetall('search:ranking') as Promise<Record<string, string> | null>,
    scanKeys(redis, 'work:click:*'),
    scanKeys(redis, 'product:click:*'),
  ]);

  // 閲覧数でソートして TOP8 を選定
  const sortedByView = allPersons
    .map((p, i) => {
      const vd = pipeResults[i] as Record<string, string> | null;
      return {
        name: p.name,
        group: p.group,
        genre: p.genre,
        viewCount: parseInt(vd?.count ?? '0', 10) || 0,
      };
    })
    .sort((a, b) => b.viewCount - a.viewCount);

  // 閲覧データがない場合はそのままの順で 8 人を使う
  const hasViewData = sortedByView.some((p) => p.viewCount > 0);
  const top8Base = hasViewData ? sortedByView.slice(0, 8) : allPersons.slice(0, 8).map((p) => ({ ...p, viewCount: 0 }));

  // ── 2. TOP8 の作品数・商品数・配信数を並列取得 ────────────────────────────────
  const [worksArr, productsArr] = await Promise.all([
    Promise.all(top8Base.map((p) => getPublishedWorks(p.name))),
    Promise.all(top8Base.map((p) => getAllStoredProducts(p.name))),
  ]);

  const popularPersons: RankedPerson[] = top8Base.map((p, i) => {
    const works = worksArr[i];
    const products = productsArr[i];
    const productCount = Object.values(products).reduce((s, c) => s + (c?.products.length ?? 0), 0);
    const streamingCount = works.filter((w) =>
      (w.vodProviders ?? []).some(
        (vp) => isConfirmedVodAvailability(vp) && ['flatrate', 'free', 'ads'].includes(vp.type),
      ),
    ).length;
    return {
      name: p.name,
      group: p.group,
      genre: p.genre,
      viewCount: p.viewCount,
      workCount: works.length,
      productCount,
      streamingCount,
    };
  });

  // 急上昇: 将来は期間比較データで差し替え
  const risingPersons = popularPersons;

  // ── 3. 検索ランキング ─────────────────────────────────────────────────────────
  const popularSearches: RankedSearch[] = Object.entries(searchHash ?? {})
    .map(([keyword, count]) => ({ keyword, count: parseInt(String(count), 10) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── 4. 人気作品 (SCAN + pipeline meta) ────────────────────────────────────────
  let popularWorks: RankedWork[] = [];
  if (workKeys.length > 0) {
    const counts = await redis.mget<(string | null)[]>(...workKeys);
    const metaPipe = redis.pipeline();
    for (const k of workKeys) {
      metaPipe.hgetall(`work:meta:${k.replace('work:click:', '')}`);
    }
    const metas = await metaPipe.exec() as unknown[];
    popularWorks = workKeys
      .map((key, i) => {
        const workId = key.replace('work:click:', '');
        const meta = metas[i] as Record<string, string> | null;
        if (!meta?.title) return null;
        return {
          workId,
          title: meta.title,
          personName: meta.personName ?? '',
          workType: meta.workType ?? '',
          posterUrl: meta.posterUrl ?? '',
          detailUrl: meta.personName
            ? `/person/${encodeURIComponent(meta.personName)}/work/${encodeURIComponent(workId)}`
            : '',
          clickCount: parseInt(String(counts[i] ?? '0'), 10) || 0,
        };
      })
      .filter((w): w is RankedWork => w !== null && w.detailUrl !== '')
      .sort((a, b) => b.clickCount - a.clickCount)
      .slice(0, 6);
  }

  // ── 5. 人気商品 (SCAN + pipeline meta) ────────────────────────────────────────
  let popularProducts: RankedProduct[] = [];
  if (productKeys.length > 0) {
    const counts = await redis.mget<(string | null)[]>(...productKeys);
    const metaPipe = redis.pipeline();
    for (const k of productKeys) {
      metaPipe.hgetall(`product:meta:${k.replace('product:click:', '')}`);
    }
    const metas = await metaPipe.exec() as unknown[];
    popularProducts = productKeys
      .map((key, i) => {
        const productId = key.replace('product:click:', '');
        const meta = metas[i] as Record<string, string> | null;
        if (!meta?.title) return null;
        return {
          productId,
          title: meta.title,
          personSlug: meta.personSlug ?? '',
          category: meta.category ?? '',
          imageUrl: meta.imageUrl ?? '',
          affiliateUrl: meta.affiliateUrl ?? '',
          clickCount: parseInt(String(counts[i] ?? '0'), 10) || 0,
        };
      })
      .filter((p): p is RankedProduct => p !== null)
      .sort((a, b) => b.clickCount - a.clickCount)
      .slice(0, 8);
  }

  return { popularPersons, risingPersons, popularSearches, popularWorks, popularProducts };
  } catch (err) {
    console.error('[ranking] Redis error, using fallback:', err);
    return emptyRanking;
  }
}
