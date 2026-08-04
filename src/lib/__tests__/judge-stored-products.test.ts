import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig } from '@/types/person';

// ── モジュールモック ──────────────────────────────────────────────────────────
// judgeStoredProducts()は楽天APIを一切呼んではいけないため、@/lib/rakuten をモックし
// getProductsByCategory が一度も呼ばれないことをテストで直接検証する。

const mockGetProductsByCategory = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rakuten', () => ({
  getProductsByCategory: mockGetProductsByCategory,
}));

vi.mock('@/lib/persons', () => ({
  getAllPersonsWithConfig: vi.fn(),
  getAllPersonsMerged: vi.fn(),
}));

const mockGetAllStoredProducts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
  getAllStoredProducts: mockGetAllStoredProducts,
  storeProducts: vi.fn(),
  saveBatchMeta: vi.fn(),
}));

vi.mock('@/lib/judgment-store', () => ({
  getAllVerdicts: vi.fn(),
  saveVerdict: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai-judge', () => ({
  judgeProducts: vi.fn(),
  shouldAutoApprove: vi.fn().mockReturnValue(false),
  PROMPT_VERSION: 'v1',
}));

vi.mock('@/lib/product-membership-guard', () => ({
  checkPostMembershipGroupContent: vi.fn().mockReturnValue({ shouldReview: false, reason: '' }),
}));

vi.mock('@/lib/person-meta', () => ({
  getPersonMeta: vi.fn().mockResolvedValue(null),
}));

// ── インポート（モック登録後）──────────────────────────────────────────────────

import { judgeStoredProducts, AI_JUDGE_BATCH_SIZE } from '@/lib/batch-processor';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllVerdicts, saveVerdict } from '@/lib/judgment-store';
import { judgeProducts, shouldAutoApprove } from '@/lib/ai-judge';

const PERSON: PersonWithConfig = {
  name: 'テスト人物',
  group: 'テストグループ',
  genre: '坂道',
  config: {},
};

function makeItem(id: string, title = `商品${id}`): RakutenItem {
  return {
    id, title, price: 1000, reviewCount: 0, reviewAverage: 0,
    imageUrl: '', itemUrl: '', affiliateUrl: '', category: '写真集', relevanceScore: 50,
  };
}

function storedDataOf(items: RakutenItem[]) {
  return { '写真集': { products: items, fetchedAt: Date.now() } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAllPersonsWithConfig).mockReturnValue([PERSON]);
  vi.mocked(shouldAutoApprove).mockReturnValue(false);
  vi.mocked(getAllVerdicts).mockResolvedValue({});
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

describe('judgeStoredProducts()', () => {
  // ── 1: 楽天APIが一度も呼ばれない ────────────────────────────────────────────
  it('[1] 楽天APIを一度も呼ばない', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('a')]));
    vi.mocked(judgeProducts).mockResolvedValue([{ id: 'a', result: { verdict: 'related', score: 80, reason: 'ok' } }]);
    await judgeStoredProducts('テスト人物');
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
  });

  // ── 2: 保存済み商品から未判定商品を取得する ──────────────────────────────────
  it('[2] products.itemsの保存済み商品から未判定商品を抽出する', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('a'), makeItem('b')]));
    vi.mocked(judgeProducts).mockResolvedValue([
      { id: 'a', result: { verdict: 'related', score: 80, reason: 'ok' } },
      { id: 'b', result: { verdict: 'unrelated', score: 10, reason: 'ok' } },
    ]);
    const r = await judgeStoredProducts('テスト人物');
    expect(mockGetAllStoredProducts).toHaveBeenCalledWith('テスト人物');
    expect(r.attemptedCount).toBe(2);
    expect(r.successCount).toBe(2);
  });

  // ── 3・4: 120件あっても最初の10件だけ判定・remainingCount=110 ───────────────
  describe('[3,4] 120件のうち最初の10件だけ判定する', () => {
    const items = Array.from({ length: 120 }, (_, i) => makeItem(`item-${i}`));

    beforeEach(() => {
      mockGetAllStoredProducts.mockResolvedValue(storedDataOf(items));
      vi.mocked(judgeProducts).mockImplementation(async (batch) =>
        batch.map((p) => ({ id: p.id, result: { verdict: 'related' as const, score: 80, reason: 'ok' } })),
      );
    });

    it('AI_JUDGE_BATCH_SIZE=10', () => {
      expect(AI_JUDGE_BATCH_SIZE).toBe(10);
    });

    it('judgeProductsには10件だけ渡される', async () => {
      await judgeStoredProducts('テスト人物');
      const calledBatch = vi.mocked(judgeProducts).mock.calls[0][0];
      expect(calledBatch).toHaveLength(10);
    });

    it('attemptedCount=10 successCount=10 remainingCount=110', async () => {
      const r = await judgeStoredProducts('テスト人物');
      expect(r.attemptedCount).toBe(10);
      expect(r.successCount).toBe(10);
      expect(r.remainingCount).toBe(110);
      expect(r.totalUnclassifiedBefore).toBe(120);
    });
  });

  // ── 5: 次回処理では前回成功済み10件を除外する ────────────────────────────────
  it('[5] 既にai判定済み(promptVersion一致)の商品は次回除外され、残りが対象になる', async () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem(`item-${i}`));
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf(items));
    // 最初の10件は既に前回のAI判定で保存済み（promptVersion一致）と仮定
    const existingVerdicts: Record<string, { verdict: 'related'; score: number; source: 'ai'; timestamp: number; promptVersion: string }> = {};
    for (let i = 0; i < 10; i++) {
      existingVerdicts[`item-${i}`] = { verdict: 'related', score: 80, source: 'ai', timestamp: Date.now(), promptVersion: 'v1' };
    }
    vi.mocked(getAllVerdicts).mockResolvedValue(existingVerdicts);
    vi.mocked(judgeProducts).mockImplementation(async (batch) =>
      batch.map((p) => ({ id: p.id, result: { verdict: 'related' as const, score: 80, reason: 'ok' } })),
    );

    await judgeStoredProducts('テスト人物');
    const calledBatch = vi.mocked(judgeProducts).mock.calls[0][0];
    // 前回成功済みの item-0〜item-9 が含まれず、item-10〜item-19 が対象になっている
    expect(calledBatch.map((p) => p.id)).not.toEqual(expect.arrayContaining(['item-0', 'item-5', 'item-9']));
    expect(calledBatch.map((p) => p.id)).toEqual(expect.arrayContaining(['item-10', 'item-19']));
  });

  // ── 6: manual判定を除外する ─────────────────────────────────────────────────
  it('[6] manual判定済み商品はAI送信対象から除外され、上書きされない', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('manual-item'), makeItem('new-item')]));
    vi.mocked(getAllVerdicts).mockResolvedValue({
      'manual-item': { verdict: 'unrelated', score: 0, source: 'manual', timestamp: Date.now() },
    });
    vi.mocked(judgeProducts).mockImplementation(async (batch) =>
      batch.map((p) => ({ id: p.id, result: { verdict: 'related' as const, score: 80, reason: 'ok' } })),
    );

    await judgeStoredProducts('テスト人物');
    const calledBatch = vi.mocked(judgeProducts).mock.calls[0][0];
    expect(calledBatch.map((p) => p.id)).not.toContain('manual-item');
    expect(saveVerdict).not.toHaveBeenCalledWith('テスト人物', 'manual-item', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  // ── 7: deleted判定を除外する ────────────────────────────────────────────────
  it('[7] deleted判定済み商品はAI送信対象から除外される', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('deleted-item'), makeItem('new-item')]));
    vi.mocked(getAllVerdicts).mockResolvedValue({
      'deleted-item': { verdict: 'deleted', score: 0, source: 'manual', timestamp: Date.now() },
    });
    vi.mocked(judgeProducts).mockImplementation(async (batch) =>
      batch.map((p) => ({ id: p.id, result: { verdict: 'related' as const, score: 80, reason: 'ok' } })),
    );

    await judgeStoredProducts('テスト人物');
    const calledBatch = vi.mocked(judgeProducts).mock.calls[0][0];
    expect(calledBatch.map((p) => p.id)).not.toContain('deleted-item');
  });

  // ── 8: 商品0件の場合に楽天APIを呼ばず案内を返す ──────────────────────────────
  it('[8] 保存済み商品が0件のとき noStoredProducts=true を返し、楽天APIもOpenAIも呼ばない', async () => {
    mockGetAllStoredProducts.mockResolvedValue({});
    const r = await judgeStoredProducts('テスト人物');
    expect(r.noStoredProducts).toBe(true);
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(judgeProducts).not.toHaveBeenCalled();
  });

  // ── 追加: forceRejudgeの既存仕様は維持する ──────────────────────────────────
  it('forceRejudge=trueならpromptVersion一致でも再判定対象になる（manualは対象外のまま）', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('ai-item'), makeItem('manual-item')]));
    vi.mocked(getAllVerdicts).mockResolvedValue({
      'ai-item': { verdict: 'related', score: 80, source: 'ai', timestamp: Date.now(), promptVersion: 'v1' },
      'manual-item': { verdict: 'unrelated', score: 0, source: 'manual', timestamp: Date.now() },
    });
    vi.mocked(judgeProducts).mockImplementation(async (batch) =>
      batch.map((p) => ({ id: p.id, result: { verdict: 'related' as const, score: 80, reason: 'ok' } })),
    );

    await judgeStoredProducts('テスト人物', true);
    const calledBatch = vi.mocked(judgeProducts).mock.calls[0][0];
    expect(calledBatch.map((p) => p.id)).toContain('ai-item');
    expect(calledBatch.map((p) => p.id)).not.toContain('manual-item');
  });

  it('AI判定失敗時も成功分は保存され、失敗分は未判定のまま残る（remainingCountに反映）', async () => {
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('ok'), makeItem('ng')]));
    vi.mocked(judgeProducts).mockResolvedValue([
      { id: 'ok', result: { verdict: 'related', score: 80, reason: 'ok' } },
      { id: 'ng', result: null, failure: { code: 'RATE_LIMIT', message: 'OpenAI APIのレート制限に達しました' } },
    ]);
    const r = await judgeStoredProducts('テスト人物');
    expect(r.successCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(r.remainingCount).toBe(1);
    expect(saveVerdict).toHaveBeenCalledTimes(1);
  });

  it('人物が見つからない場合はerrorを返す', async () => {
    vi.mocked(getAllPersonsWithConfig).mockReturnValue([]);
    const r = await judgeStoredProducts('存在しない人物');
    expect(r.error).toBe('人物が見つかりません');
  });
});
