import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredProductsJudgeResult } from '@/lib/batch-processor';

// ── モジュールモック ──────────────────────────────────────────────────────────
// judgeStoredProducts自体はjudge-stored-products.test.tsで別途検証済みのため、ここでは
// /api/admin/ai-judge が判定結果を正しくレスポンスへ反映するか、excludeProductIds/limitの
// 受け渡し、および人物単位ロックの挙動だけを検証する。

const mockJudgeStoredProducts = vi.hoisted(() => vi.fn());
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetRedis = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockAcquireBatchLock = vi.hoisted(() => vi.fn());
const mockReleaseBatchLock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/batch-processor', () => ({ judgeStoredProducts: mockJudgeStoredProducts }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/batch-lock', () => ({
  acquireBatchLock: mockAcquireBatchLock,
  releaseBatchLock: mockReleaseBatchLock,
  personAiJudgeLockKey: (name: string) => `product-ai-judge:${name}`,
}));

import { POST } from '@/app/api/admin/ai-judge/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/ai-judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE_RESULT: StoredProductsJudgeResult = {
  personName: 'テスト人物', noStoredProducts: false, totalUnclassifiedBefore: 0,
  attemptedCount: 0, successCount: 0, failedCount: 0, remainingCount: 0,
  runnableRemainingCount: 0, failedInThisRunCount: 0,
  autoApproved: 0, excluded: 0, membershipFiltered: 0,
  relatedCount: 0, unrelatedCount: 0, uncertainCount: 0,
  aiKeyMissing: false, aiFailures: [], stopProcessing: true, stopReason: 'COMPLETED',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRedis.mockReturnValue({});
  mockGetAllPersonsMerged.mockResolvedValue([{ name: 'テスト人物', group: '', config: {} }]);
  mockAcquireBatchLock.mockResolvedValue(true);
  mockReleaseBatchLock.mockResolvedValue(undefined);
});

describe('POST /api/admin/ai-judge', () => {
  it('personNameが無ければ400', async () => {
    const res = await POST(makePost({}) as never);
    expect(res.status).toBe(400);
  });

  it('人物が見つからなければ404', async () => {
    mockGetAllPersonsMerged.mockResolvedValue([]);
    const res = await POST(makePost({ personName: '存在しない人物' }) as never);
    expect(res.status).toBe(404);
  });

  it('judgeStoredProductsに楽天関連の引数を渡さない（personName・forceRejudge・config・options(limit/excludeProductIds)のみ）', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 1, attemptedCount: 1, successCount: 1, remainingCount: 0,
    });
    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(mockJudgeStoredProducts).toHaveBeenCalledWith(
      'テスト人物', false,
      expect.objectContaining({ name: 'テスト人物' }),
      expect.objectContaining({ limit: undefined, excludeProductIds: undefined }),
    );
  });

  it('excludeProductIdsとlimitをそのままjudgeStoredProductsへ渡す', async () => {
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);
    await POST(makePost({ personName: 'テスト人物', limit: 5, excludeProductIds: ['a', 'b'] }) as never);
    expect(mockJudgeStoredProducts).toHaveBeenCalledWith(
      'テスト人物', false, expect.anything(),
      { limit: 5, excludeProductIds: ['a', 'b'] },
    );
  });

  it('excludeProductIdsが上限件数を超える場合、超過分を切り捨ててから渡す', async () => {
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);
    const manyIds = Array.from({ length: 600 }, (_, i) => `id-${i}`);
    await POST(makePost({ personName: 'テスト人物', excludeProductIds: manyIds }) as never);
    const calledOptions = mockJudgeStoredProducts.mock.calls[0][3];
    expect(calledOptions.excludeProductIds.length).toBeLessThanOrEqual(500);
  });

  it('excludeProductIdsに不正な型（文字列以外）が混じっていても無視する', async () => {
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);
    await POST(makePost({ personName: 'テスト人物', excludeProductIds: ['a', 123, null, {}] }) as never);
    const calledOptions = mockJudgeStoredProducts.mock.calls[0][3];
    expect(calledOptions.excludeProductIds).toEqual(['a']);
  });

  it('保存済み商品が0件: no_stored_products案内を返し、200で成功扱い', async () => {
    mockJudgeStoredProducts.mockResolvedValue({ ...BASE_RESULT, noStoredProducts: true, stopReason: undefined });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('no_stored_products');
    expect(body.person.message).toBe('保存済みの商品がありません。先に楽天再取得を実行してください');
  });

  it('全件成功（継続あり）: 「N件を判定しました。残りM件」', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 120, attemptedCount: 10, successCount: 10, remainingCount: 110,
      runnableRemainingCount: 110, stopProcessing: false, stopReason: undefined,
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('success');
    expect(body.person.message).toBe('10件を判定しました。残り110件');
  });

  it('一部失敗（継続あり・複数種の失敗）: 「N件を判定しました。M件失敗、残りK件」', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 120, attemptedCount: 10, successCount: 8, failedCount: 2, remainingCount: 112,
      runnableRemainingCount: 110, stopProcessing: false, stopReason: undefined,
      aiFailures: [{ productId: 'a', code: 'TIMEOUT', message: 'x' }, { productId: 'b', code: 'INVALID_JSON', message: 'y' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.message).toBe('8件を判定しました。2件失敗、残り112件');
  });

  it('完了（stopReason=COMPLETED）: 「すべての商品を判定しました」', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 5, attemptedCount: 5, successCount: 5, remainingCount: 0,
      runnableRemainingCount: 0, stopProcessing: true, stopReason: 'COMPLETED',
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.status).toBe('complete');
    expect(body.person.message).toBe('すべての商品を判定しました');
  });

  it('全件失敗（今回のバッチで成功0件）: 「今回の判定は保存されませんでした」', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 5, attemptedCount: 3, successCount: 0, failedCount: 3, remainingCount: 5,
      runnableRemainingCount: 2, stopProcessing: false, stopReason: undefined,
      aiFailures: [
        { productId: 'a', code: 'TIMEOUT', message: 'x' },
        { productId: 'b', code: 'INVALID_JSON', message: 'y' },
        { productId: 'c', code: 'UNKNOWN', message: 'z' },
      ],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.message).toBe('今回の判定は保存されませんでした');
  });

  it('失敗商品のみが残った場合（FAILED_ITEMS_REMAIN）: 失敗件数を明記して停止扱いにする', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 120, attemptedCount: 2, successCount: 118, failedCount: 2, remainingCount: 2,
      runnableRemainingCount: 0, failedInThisRunCount: 2, stopProcessing: true, stopReason: 'FAILED_ITEMS_REMAIN',
      aiFailures: [{ productId: 'a', code: 'UNKNOWN', message: 'x' }, { productId: 'b', code: 'UNKNOWN', message: 'y' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.stopProcessing).toBe(true);
    expect(body.person.stopReason).toBe('FAILED_ITEMS_REMAIN');
    expect(body.person.message).toBe('118件を判定しました。2件は失敗したため未判定のままです');
  });

  it('一時的レート制限だけで失敗した場合、専用メッセージを返す', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 10, attemptedCount: 10, successCount: 0, failedCount: 10, remainingCount: 10,
      runnableRemainingCount: 0, failedInThisRunCount: 10, stopProcessing: true, stopReason: 'FAILED_ITEMS_REMAIN',
      aiFailures: Array.from({ length: 10 }, (_, i) => ({ productId: `id-${i}`, code: 'RATE_LIMIT', message: 'x' })),
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.message).toBe('OpenAI APIが一時的な利用制限中です。しばらく待ってから再実行してください');
  });

  it('残高・上限不足（INSUFFICIENT_QUOTA）: 専用メッセージを返しstopProcessing=true', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 10, attemptedCount: 3, successCount: 1, failedCount: 2, remainingCount: 9,
      runnableRemainingCount: 5, stopProcessing: true, stopReason: 'INSUFFICIENT_QUOTA',
      aiFailures: [{ productId: 'a', code: 'INSUFFICIENT_QUOTA', message: 'x' }, { productId: 'b', code: 'INSUFFICIENT_QUOTA', message: 'y' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.stopProcessing).toBe(true);
    expect(body.person.message).toBe('OpenAI APIの残高または利用上限を確認してください');
  });

  it('対象0件: totalUnclassifiedBefore=0で「未判定の商品はありません」', async () => {
    mockJudgeStoredProducts.mockResolvedValue({ ...BASE_RESULT, totalUnclassifiedBefore: 0, stopReason: 'COMPLETED' });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.status).toBe('no_targets');
    expect(body.person.message).toBe('未判定の商品はありません');
  });

  it('OPENAI_API_KEY未設定: 専用メッセージを返す', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 5, aiKeyMissing: true, stopProcessing: true, stopReason: 'AI_KEY_MISSING',
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(body.person.message).toBe('OPENAI_API_KEY 未設定: AI判定をスキップしました');
  });

  // ── 同じ人物の二重実行を拒否する ─────────────────────────────────────────────
  it('ロック取得失敗時は409「この人物のAI判定はすでに実行中です」を返し、judgeStoredProductsを呼ばない', async () => {
    mockAcquireBatchLock.mockResolvedValue(false);
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe('この人物のAI判定はすでに実行中です');
    expect(mockJudgeStoredProducts).not.toHaveBeenCalled();
  });

  it('人物単位のロックキーで取得を試みる（product-ai-judge:personName）', async () => {
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);
    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(mockAcquireBatchLock).toHaveBeenCalledWith(expect.any(String), 'product-ai-judge:テスト人物');
  });

  // ── 別人物は同時実行できる（=それぞれ別のロックキーで独立に判定される） ────────
  it('人物ごとに異なるロックキーを使う（人物Aと人物Bは別ロック）', async () => {
    mockGetAllPersonsMerged.mockResolvedValue([
      { name: '人物A', group: '', config: {} },
      { name: '人物B', group: '', config: {} },
    ]);
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);

    await POST(makePost({ personName: '人物A' }) as never);
    await POST(makePost({ personName: '人物B' }) as never);

    const calledKeys = mockAcquireBatchLock.mock.calls.map((c) => c[1]);
    expect(calledKeys).toEqual(['product-ai-judge:人物A', 'product-ai-judge:人物B']);
  });

  it('正常終了時にロックを解放する（finally）', async () => {
    mockJudgeStoredProducts.mockResolvedValue(BASE_RESULT);
    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(mockReleaseBatchLock).toHaveBeenCalledWith(expect.any(String), 'completed', 'product-ai-judge:テスト人物');
  });

  it('judgeStoredProductsが例外を投げても500を返しロックは解放される', async () => {
    mockJudgeStoredProducts.mockRejectedValue(new Error('boom'));
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(res.status).toBe(500);
    expect(mockReleaseBatchLock).toHaveBeenCalled();
  });

  it('1バッチ処理中はロックを保持し、レスポンス返却前（finally）に解放する', async () => {
    // acquireとreleaseの呼び出し順序を確認し、「次バッチがロック解除前に送信されない」設計を裏付ける
    const callOrder: string[] = [];
    mockAcquireBatchLock.mockImplementation(async () => { callOrder.push('acquire'); return true; });
    mockJudgeStoredProducts.mockImplementation(async () => { callOrder.push('judge'); return BASE_RESULT; });
    mockReleaseBatchLock.mockImplementation(async () => { callOrder.push('release'); });

    await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(callOrder).toEqual(['acquire', 'judge', 'release']);
  });

  it('/admin/product-check はrevalidatePathしない（router.refreshによるソフト更新に一本化）', async () => {
    mockJudgeStoredProducts.mockResolvedValue({ ...BASE_RESULT, totalUnclassifiedBefore: 1, attemptedCount: 1, successCount: 1 });
    await POST(makePost({ personName: 'テスト人物' }) as never);
    const calledPaths = mockRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calledPaths).not.toContain('/admin/product-check');
    expect(calledPaths).toContain(`/person/${encodeURIComponent('テスト人物')}`);
  });

  it('Redis未設定なら503（既存仕様）', async () => {
    mockGetRedis.mockReturnValue(null);
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    expect(res.status).toBe(503);
    expect(mockJudgeStoredProducts).not.toHaveBeenCalled();
  });

  it('APIキーやOpenAIレスポンス全文がレスポンスに含まれない', async () => {
    mockJudgeStoredProducts.mockResolvedValue({
      ...BASE_RESULT, totalUnclassifiedBefore: 1, attemptedCount: 1, failedCount: 1, remainingCount: 1,
      stopProcessing: true, stopReason: 'INSUFFICIENT_QUOTA',
      aiFailures: [{ productId: 'a', code: 'INSUFFICIENT_QUOTA', message: 'OpenAI APIの残高または利用上限を確認してください' }],
    });
    const res = await POST(makePost({ personName: 'テスト人物' }) as never);
    const bodyText = await res.text();
    expect(bodyText).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(bodyText.toLowerCase()).not.toContain('openai_api_key');
  });
});
