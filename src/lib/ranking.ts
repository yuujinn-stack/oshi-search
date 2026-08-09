import { getRedis } from '@/lib/redis';
import { getAllPersonsMerged } from '@/lib/persons';
import { getPublishedWorks, getAllPublishedWorkPersonMap, getPublicWorkById } from '@/lib/work-store';
import { getAllStoredProducts, getStoredProductImageUrl } from '@/lib/product-store';
import { isConfirmedVodAvailability } from '@/lib/vod-dedup';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { getWorkPublicUrl } from '@/lib/work-url';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import type { Redis } from '@upstash/redis';
import type { Person, ProductCategory } from '@/types/person';

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

// ホームの getCachedRankingData（src/app/page.tsx）に付与する unstable_cache タグ名。
// 商品画像等、ランキング表示に使う元データが更新された書き込み経路（商品手動編集・
// Rakuten再取得・商品復旧等）から revalidateTag(RANKING_DATA_CACHE_TAG, { expire: 0 }) を
// 呼ぶことで、60秒の定期再検証を待たずにこのキャッシュ1件だけを次回リクエストから
// 更新できる。呼び出し側は必ず { expire: 0 }（即時失効）を使うこと。
// Next.js 16 の revalidateTag は第2引数（キャッシュプロファイル）が必須で、'max' 等の
// 名前付きプロファイルは stale 猶予（'max' は stale:300秒）を持つため、無効化直後の
// 最初のアクセスで古い値が返る可能性がある。{ expire: 0 } は猶予なしで即時失効するため、
// 「管理画面で商品画像を変更→次にホームを表示→新しい画像」という要件に合う
// （実機確認: 無効化直後の次リクエストで即座に再計算されることを確認済み）。
// 人物・作品・商品などランキングの全セクションを1つの関数でまとめて計算しているため、
// タグの粒度もランキングデータ全体（このキャッシュエントリ単位）が最小単位となる。
export const RANKING_DATA_CACHE_TAG = 'ranking-data';

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
  // ── 1. 人物閲覧数 + 検索ランキング + SCAN キー + DB全公開作品マップ を並列取得 ──
  const pipe = redis.pipeline();
  for (const p of allPersons) pipe.hgetall(`person:view:${p.name}`);
  const [pipeResults, searchHash, workKeys, productKeys, workPersonMap] = await Promise.all([
    pipe.exec() as Promise<unknown[]>,
    redis.hgetall('search:ranking') as Promise<Record<string, string> | null>,
    scanKeys(redis, 'work:click:*'),
    scanKeys(redis, 'product:click:*'),
    getAllPublishedWorkPersonMap(),
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
  const [worksArr, productsArr, terminatedSlugs] = await Promise.all([
    Promise.all(top8Base.map((p) => getPublishedWorks(p.name))),
    Promise.all(top8Base.map((p) => getAllStoredProducts(p.name))),
    getInactiveProviderSlugs(),
  ]);

  const popularPersons: RankedPerson[] = top8Base.map((p, i) => {
    const works = worksArr[i];
    const products = productsArr[i];
    const productCount = Object.values(products).reduce((s, c) => s + (c?.products.length ?? 0), 0);
    const streamingCount = works.filter((w) =>
      (w.vodProviders ?? []).some(
        (vp) => isConfirmedVodAvailability(vp, terminatedSlugs) && ['flatrate', 'free', 'ads'].includes(vp.type),
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

  // ── 4. 人気作品 (SCAN + pipeline meta + DB照合) ───────────────────────────────
  // workPersonMap でDBに存在する公開作品のみ採用し、personName はDB値を正とする。
  // Redisにしか存在しない workId（削除済み・非公開）はここで除外される。
  let popularWorks: RankedWork[] = [];
  if (workKeys.length > 0) {
    const counts = await redis.mget<(string | null)[]>(...workKeys);
    const metaPipe = redis.pipeline();
    for (const k of workKeys) {
      metaPipe.hgetall(`work:meta:${k.replace('work:click:', '')}`);
    }
    const metas = await metaPipe.exec() as unknown[];

    // 無効IDをRedisから非同期で削除（少数の場合のみ、ページ表示はブロックしない）
    const invalidKeys: string[] = [];

    const snapshotWorks = workKeys
      .map((key, i) => {
        const workId = key.replace('work:click:', '');
        // DB照合: 公開・未削除の作品のみ採用（DBが正）
        const dbPersonName = workPersonMap.get(workId);
        if (!dbPersonName) {
          invalidKeys.push(key);
          return null;
        }
        const meta = metas[i] as Record<string, string> | null;
        const detailUrl = getWorkPublicUrl({ workId, personName: dbPersonName });
        if (!detailUrl) return null;
        return {
          workId,
          title: meta?.title ?? '',
          personName: dbPersonName,
          workType: meta?.workType ?? '',
          posterUrl: meta?.posterUrl ?? '',
          detailUrl,
          clickCount: parseInt(String(counts[i] ?? '0'), 10) || 0,
        };
      })
      .filter((w): w is RankedWork => w !== null && w.title !== '')
      .sort((a, b) => b.clickCount - a.clickCount)
      .slice(0, 6);

    // work:meta:* の posterUrl はクリック時点のスナップショットのため、その後
    // 管理画面での手動画像設定・OG画像再取得等で作品画像が更新されても反映されない
    // （人物ページ・作品詳細ページは常にDBの現在値を getWorkDisplayImage() で参照するため
    // そちらは最新になるが、ここだけ古いままになっていた）。表示対象TOP6のみ、
    // getPublicWorkById()でDBから現在の作品データを取得し、getWorkDisplayImage()+
    // getRenderableWorkImageUrl()という他画面と全く同じ優先順位ロジックで画像URLを
    // 再計算し、見つかった場合だけ posterUrl を差し替える（DBが正本）。
    // 他のフィールド・並び順・クリック集計は一切変更しない。作品が削除済み等で
    // 見つからない場合はスナップショットのまま。
    const liveWorks = await Promise.all(snapshotWorks.map((w) => getPublicWorkById(w.workId)));
    popularWorks = snapshotWorks.map((w, i) => {
      const liveWork = liveWorks[i];
      if (!liveWork) return w;
      const liveImageUrl = getRenderableWorkImageUrl(getWorkDisplayImage(liveWork));
      return liveImageUrl ? { ...w, posterUrl: liveImageUrl } : w;
    });

    // 無効IDが少数（20件以下）かつDBマップが正常に取得できた場合のみ非同期削除
    // workPersonMap.size === 0 かつ workKeys があるケースはDB障害の可能性があるため削除しない
    if (invalidKeys.length > 0 && invalidKeys.length <= 20 && workPersonMap.size > 0) {
      const cleanPipe = redis.pipeline();
      for (const k of invalidKeys) {
        cleanPipe.del(k);
        cleanPipe.del(`work:meta:${k.replace('work:click:', '')}`);
      }
      cleanPipe.exec().catch((err: unknown) => {
        console.error('[ranking] failed to clean invalid work keys:', err);
      });
    } else if (invalidKeys.length > 20 && workPersonMap.size > 0) {
      console.warn(`[ranking] ${invalidKeys.length} invalid work keys found in Redis. Run cleanup script.`);
    }
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
    const snapshotProducts = productKeys
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

    // product:meta:* の imageUrl はクリック時点のスナップショットのため、その後
    // 管理画面での手動編集やRakuten再取得で商品画像が更新されても反映されない。
    // 表示対象TOP8のみ、getStoredProductImageUrl()でDB側から対象商品1件だけを
    // ピンポイントに絞り込んで現在のimageUrlを取得し、見つかった場合だけ差し替える
    // （他のフィールド・並び順・クリック集計は一切変更しない。商品が削除済み等で
    // 見つからない場合はスナップショットのまま）。
    // getAllStoredProducts()（カテゴリ内の商品を丸ごと取得）は使わない。1人物・1カテゴリの
    // 商品点数が数百〜千件規模になり得るため、TOP8のためだけに丸ごと転送するのは無駄が大きい。
    const liveImageUrls = await Promise.all(
      snapshotProducts.map((p) =>
        p.personSlug && p.category
          ? getStoredProductImageUrl(p.personSlug, p.category as ProductCategory, p.productId)
          : Promise.resolve(null),
      ),
    );

    popularProducts = snapshotProducts.map((p, i) => {
      const liveImageUrl = liveImageUrls[i];
      return liveImageUrl ? { ...p, imageUrl: liveImageUrl } : p;
    });
  }

  return { popularPersons, risingPersons, popularSearches, popularWorks, popularProducts };
  } catch (err) {
    console.error('[ranking] Redis error, using fallback:', err);
    return emptyRanking;
  }
}
