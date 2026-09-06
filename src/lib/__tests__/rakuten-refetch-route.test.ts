import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CategoryProcessResult } from '@/lib/batch-processor';

// /api/admin/rakuten-refetch は1リクエストにつき1カテゴリだけを処理するエンドポイント
// （「楽天再取得」ボタン専用。フロントが6カテゴリを順番に呼ぶ）。processPersonCategory()を
// 正しい引数で呼び、カテゴリ単位のステータス（success/config_missing/rate_limited/
// upstream_error/network_error/db_error/locked）を返すことを確認する
// （processPersonCategory自体の詳細な挙動はbatch-processor.test.tsで検証済み）。

const mockProcessPersonCategory = vi.hoisted(() => vi.fn());
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetRedis = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockRevalidateTag = vi.hoisted(() => vi.fn());
const mockAcquireBatchLock = vi.hoisted(() => vi.fn());
const mockReleaseBatchLock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/batch-processor', () => ({ processPersonCategory: mockProcessPersonCategory }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath, revalidateTag: mockRevalidateTag }));
// ranking.ts はDBに触れるモジュール(work-store等)を読み込むため、テストではタグ定数のみ提供する
vi.mock('@/lib/ranking', () => ({ RANKING_DATA_CACHE_TAG: 'ranking-data' }));
// product-store.ts はdb importを含むため、CATEGORIESの値だけを提供する
vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
}));
// batch-lock.ts もdb importを含むため、ロック関数をモックする
vi.mock('@/lib/batch-lock', () => ({
  acquireBatchLock: mockAcquireBatchLock,
  releaseBatchLock: mockReleaseBatchLock,
  personRakutenFetchLockKey: (name: string) => `product-rakuten-refetch:${name}`,
}));

import { POST } from '@/app/api/admin/rakuten-refetch/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/rakuten-refetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE_RESULT: CategoryProcessResult = {
  category: '写真集', stored: 0, autoApproved: 0, skipped: 0, excluded: 0,
  usedSuppressed: 0, membershipFiltered: 0, toJudge: [], fetchFailed: false, rakutenConfigMissing: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRedis.mockReturnValue({});
  mockGetAllPersonsMerged.mockResolvedValue([{ name: 'テスト人物', group: '', config: {} }]);
  mockAcquireBatchLock.mockResolvedValue(true);
  mockReleaseBatchLock.mockResolvedValue(undefined);
});

describe('POST /api/admin/rakuten-refetch', () => {
  it('personName が無い場合は400', async () => {
    const res = await POST(makePost({ category: '写真集' }) as never);
    expect(res.status).toBe(400);
  });

  it('category が無い・不正な場合は400', async () => {
    const res1 = await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(res1.status).toBe(400);
    const res2 = await POST(makePost({ personName: 'テスト人物', category: '不正カテゴリ' }) as never);
    expect(res2.status).toBe(400);
  });

  it('processPersonCategory() を personName・category・forceRejudge付きで呼ぶ', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, stored: 5 });
    await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    expect(mockProcessPersonCategory).toHaveBeenCalledWith(
      'テスト人物', '写真集', false, expect.objectContaining({ name: 'テスト人物' }),
    );
  });

  it('ロック取得に失敗した場合は409・statusはlocked', async () => {
    mockAcquireBatchLock.mockResolvedValue(false);
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.status).toBe('locked');
    expect(mockProcessPersonCategory).not.toHaveBeenCalled();
  });

  it('正常終了時は必ずロックを解放する', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, stored: 5 });
    await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    expect(mockReleaseBatchLock).toHaveBeenCalledWith(expect.any(String), 'completed', 'product-rakuten-refetch:テスト人物');
  });

  it('processPersonCategoryが例外を投げた場合もロックを解放する', async () => {
    mockProcessPersonCategory.mockRejectedValue(new Error('boom'));
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    expect(res.status).toBe(500);
    expect(mockReleaseBatchLock).toHaveBeenCalled();
  });

  it('rakutenConfigMissing=trueの場合は503・config_missing', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, rakutenConfigMissing: true });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe('config_missing');
  });

  it('dbErrorありの場合は500・db_error', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, dbError: 'DB保存失敗: 写真集' });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.status).toBe('db_error');
  });

  it('楽天429・このカテゴリ0件: rate_limited・どのカテゴリか分かるメッセージを返す', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, fetchFailed: true, upstreamHttpStatus: 429 });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.status).toBe('rate_limited');
    expect(body.error).toContain('写真集');
  });

  it('楽天upstreamエラー(429以外)は502・upstream_error', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, fetchFailed: true, upstreamHttpStatus: 503 });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.status).toBe('upstream_error');
  });

  it('ネットワークエラー(upstreamHttpStatus不明)は500・network_error', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, fetchFailed: true, upstreamHttpStatus: undefined });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.status).toBe('network_error');
  });

  it('正常系: stored>0でsuccessを返す', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, stored: 5, toJudge: [{}] as never });
    const res = await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('success');
    expect(body.person.pendingAiJudge).toBe(1);
  });

  it('stored>0の場合、人気商品のランキングキャッシュタグをrevalidateする', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, stored: 3 });
    await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    expect(mockRevalidateTag).toHaveBeenCalledWith('ranking-data', { expire: 0 });
  });

  it('stored===0の場合、ランキングキャッシュタグはrevalidateしない（商品が変わっていないため）', async () => {
    mockProcessPersonCategory.mockResolvedValue({ ...BASE_RESULT, stored: 0 });
    await POST(makePost({ personName: 'テスト人物', category: '写真集' }) as never);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it('人物が見つからない場合は404', async () => {
    mockGetAllPersonsMerged.mockResolvedValue([]);
    const res = await POST(makePost({ personName: '未知の人物', category: '写真集' }) as never);
    expect(res.status).toBe(404);
    expect(mockProcessPersonCategory).not.toHaveBeenCalled();
  });
});
