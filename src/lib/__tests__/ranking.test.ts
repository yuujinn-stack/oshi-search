import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkRecord } from '@/types/work';

// ─── モック対象の関数 ─────────────────────────────────────────────────────────
// work-image.ts（getWorkDisplayImage/getRenderableWorkImageUrl）・work-url.ts（getWorkPublicUrl）・
// vod-dedup.ts（isConfirmedVodAvailability）はDB/Redisに触れない純粋関数のため、
// 実装をそのまま使う（モックしない）。これにより、ranking.ts が実際に
// 「人物ページ・作品詳細ページと全く同じ画像決定ロジック」を呼んでいることまで検証できる。
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetRedis = vi.hoisted(() => vi.fn());
const mockGetPublishedWorks = vi.hoisted(() => vi.fn());
const mockGetAllPublishedWorkPersonMap = vi.hoisted(() => vi.fn());
const mockGetPublicWorkById = vi.hoisted(() => vi.fn());
const mockGetAllStoredProducts = vi.hoisted(() => vi.fn());
const mockGetStoredProductImageUrl = vi.hoisted(() => vi.fn());
const mockGetInactiveProviderSlugs = vi.hoisted(() => vi.fn());

vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('@/lib/work-store', () => ({
  getPublishedWorks: mockGetPublishedWorks,
  getAllPublishedWorkPersonMap: mockGetAllPublishedWorkPersonMap,
  getPublicWorkById: mockGetPublicWorkById,
}));
vi.mock('@/lib/product-store', () => ({
  getAllStoredProducts: mockGetAllStoredProducts,
  getStoredProductImageUrl: mockGetStoredProductImageUrl,
}));
vi.mock('@/lib/provider-store', () => ({ getInactiveProviderSlugs: mockGetInactiveProviderSlugs }));

import { getRankingData } from '@/lib/ranking';

// ─── Redis のクリック時点スナップショットを模擬する最小限のフェイク実装 ──────────────
// pipeline().hgetall().exec() / hgetall() / mget() / scan() のみ実装する
// （ranking.ts が実際に呼び出す最小限のRedisインターフェースに合わせる）
class FakeRedis {
  private hashes = new Map<string, Record<string, string>>();
  private scalars = new Map<string, string>();

  setHash(key: string, value: Record<string, string>) {
    this.hashes.set(key, value);
  }
  setScalar(key: string, value: string) {
    this.scalars.set(key, value);
  }

  async hgetall(key: string) {
    return this.hashes.get(key) ?? null;
  }

  async mget(...keys: string[]) {
    return keys.map((k) => this.scalars.get(k) ?? null);
  }

  async scan(_cursor: number, opts: { match: string; count: number }) {
    const prefix = opts.match.endsWith('*') ? opts.match.slice(0, -1) : opts.match;
    const allKeys = [...this.scalars.keys(), ...this.hashes.keys()];
    const matched = allKeys.filter((k) => k.startsWith(prefix));
    return [0, matched] as [number, string[]];
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    const pipe = {
      hgetall(key: string) {
        ops.push(() => self.hgetall(key));
        return pipe;
      },
      del(_key: string) {
        ops.push(() => Promise.resolve(1));
        return pipe;
      },
      exec() {
        return Promise.all(ops.map((op) => op()));
      },
    };
    return pipe;
  }
}

function makeWorkRecord(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: 'work-gal-naikaku',
    personName: 'テスト太郎',
    title: '発足！ギャル内閣',
    normalizedTitle: '発足ギャル内閣',
    type: 'tv',
    source: 'manual_csv',
    confidenceScore: 100,
    status: 'auto_published',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const WORK_ID = 'work-gal-naikaku';
const PERSON_NAME = 'テスト太郎';
const OLD_IMAGE_URL = 'https://old-cdn.example.com/OLD_IMAGE_URL.jpg';
const NEW_IMAGE_URL = 'https://new-cdn.example.com/NEW_IMAGE_URL.jpg';

function seedWorkClickSnapshot(redis: FakeRedis, opts: { clickCount?: number } = {}) {
  redis.setScalar(`work:click:${WORK_ID}`, String(opts.clickCount ?? 10));
  // クリック時点のRedisスナップショット。DB側で manualImageUrl を後から設定しても
  // このposterUrlは自動更新されない（今回のバグの原因そのもの）。
  redis.setHash(`work:meta:${WORK_ID}`, {
    title: '発足！ギャル内閣',
    personName: PERSON_NAME,
    workType: 'tv',
    posterUrl: OLD_IMAGE_URL,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPersonsMerged.mockResolvedValue([]);
  mockGetPublishedWorks.mockResolvedValue([]);
  mockGetAllStoredProducts.mockResolvedValue({});
  mockGetInactiveProviderSlugs.mockResolvedValue(new Set());
  mockGetAllPublishedWorkPersonMap.mockResolvedValue(new Map([[WORK_ID, PERSON_NAME]]));
});

describe('getRankingData() / popularWorks — 画像URLの取得元（回帰テスト）', () => {
  it('work:meta の古いposterUrlではなく、DB現在値のmanualImageUrlを使用する', async () => {
    const redis = new FakeRedis();
    seedWorkClickSnapshot(redis);
    mockGetRedis.mockReturnValue(redis);

    // DB側は「発見！ギャル内閣」の実際の状態を再現: manualImageUrl（新・縦長）が
    // posterUrl（旧・横長）より優先されるべき状態
    mockGetPublicWorkById.mockResolvedValue(makeWorkRecord({
      posterUrl: OLD_IMAGE_URL,
      manualImageUrl: NEW_IMAGE_URL,
    }));

    const result = await getRankingData();

    expect(result.popularWorks).toHaveLength(1);
    const work = result.popularWorks[0];
    expect(work.workId).toBe(WORK_ID);
    expect(work.posterUrl).toBe(NEW_IMAGE_URL);
    expect(work.posterUrl).not.toBe(OLD_IMAGE_URL);

    // 画像以外のフィールド・クリック数はスナップショット由来のまま変更されないことも確認
    expect(work.clickCount).toBe(10);
    expect(work.personName).toBe(PERSON_NAME);
    expect(work.title).toBe('発足！ギャル内閣');

    // DBから取得したwork自体は照会にのみ使い、書き換えていないことの確認
    expect(mockGetPublicWorkById).toHaveBeenCalledWith(WORK_ID);
  });

  it('manualImageUrlが無い場合はDB現在値のposterUrlを使用する（DBのposterUrlも更新されていれば反映される）', async () => {
    const redis = new FakeRedis();
    seedWorkClickSnapshot(redis); // Redisスナップショットは古いまま
    mockGetRedis.mockReturnValue(redis);

    mockGetPublicWorkById.mockResolvedValue(makeWorkRecord({
      posterUrl: NEW_IMAGE_URL, // DB側のposterUrl自体が更新された想定（manualImageUrlは未設定）
      manualImageUrl: undefined,
    }));

    const result = await getRankingData();

    expect(result.popularWorks[0].posterUrl).toBe(NEW_IMAGE_URL);
  });

  it('DBから現在の作品が取得できない場合のみ、Redisの古いwork:meta画像へフォールバックする', async () => {
    const redis = new FakeRedis();
    seedWorkClickSnapshot(redis);
    mockGetRedis.mockReturnValue(redis);

    // getPublicWorkById が null を返すケース（DB照会失敗・一時的な不整合等）
    mockGetPublicWorkById.mockResolvedValue(null);

    const result = await getRankingData();

    expect(result.popularWorks).toHaveLength(1);
    // フォールバックとしてRedisスナップショットのposterUrlがそのまま使われる
    expect(result.popularWorks[0].posterUrl).toBe(OLD_IMAGE_URL);
  });

  it('人気作品が無い場合（work:click:*が0件）はpopularWorksが空配列のまま', async () => {
    const redis = new FakeRedis();
    mockGetRedis.mockReturnValue(redis);

    const result = await getRankingData();

    expect(result.popularWorks).toEqual([]);
    expect(mockGetPublicWorkById).not.toHaveBeenCalled();
  });

  it('今回の修正は人気商品・人物ランキングには影響しない（該当データが無ければ空のまま）', async () => {
    const redis = new FakeRedis();
    seedWorkClickSnapshot(redis);
    mockGetRedis.mockReturnValue(redis);
    mockGetPublicWorkById.mockResolvedValue(makeWorkRecord({
      posterUrl: OLD_IMAGE_URL,
      manualImageUrl: NEW_IMAGE_URL,
    }));

    const result = await getRankingData();

    expect(result.popularProducts).toEqual([]);
    expect(result.popularPersons).toEqual([]);
    expect(result.risingPersons).toEqual([]);
    expect(mockGetStoredProductImageUrl).not.toHaveBeenCalled();
  });
});
