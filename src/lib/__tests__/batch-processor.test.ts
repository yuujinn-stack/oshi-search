import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig } from '@/types/person';

// ── モジュールモック ──────────────────────────────────────────────────────────

vi.mock('@/lib/persons', () => ({
  getAllPersonsWithConfig: vi.fn(),
  getAllPersonsMerged: vi.fn(),
}));

vi.mock('@/lib/rakuten', () => ({
  getProductsByCategory: vi.fn(),
}));

vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
  storeProducts: vi.fn().mockResolvedValue(undefined),
  saveBatchMeta: vi.fn().mockResolvedValue(undefined),
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

// ── インポート (モック登録後) ─────────────────────────────────────────────────

import { processPerson } from '@/lib/batch-processor';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getProductsByCategory } from '@/lib/rakuten';
import { getAllVerdicts, saveVerdict } from '@/lib/judgment-store';
import { judgeProducts, shouldAutoApprove } from '@/lib/ai-judge';

// ── テストデータ ──────────────────────────────────────────────────────────────

const PERSON: PersonWithConfig = {
  name: 'テスト人物',
  group: 'テストグループ',
  genre: '坂道',
  config: {},
};

function makeItem(id: string, title = `商品${id}`): RakutenItem {
  return {
    id,
    title,
    price: 1000,
    reviewCount: 0,
    reviewAverage: 0,
    imageUrl: '',
    itemUrl: '',
    affiliateUrl: '',
    category: '写真集',
    relevanceScore: 50,
  };
}

// ── セットアップ ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // デフォルト: 人物あり、既存verdict無し
  vi.mocked(getAllPersonsWithConfig).mockReturnValue([PERSON]);
  vi.mocked(getAllVerdicts).mockResolvedValue({});
  vi.mocked(shouldAutoApprove).mockReturnValue(false);
});

// ── テスト ────────────────────────────────────────────────────────────────────

describe('processPerson()', () => {
  // ── ケース1: 楽天APIが全カテゴリ0件 ─────────────────────────────────────────
  describe('楽天APIが全カテゴリ0件を返した場合', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'empty' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('stored=0 aiQueued=0 fetchFailed=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(0);
      expect(r.aiQueued).toBe(0);
      expect(r.fetchFailed).toBe(0);
    });

    it('aiKeyMissing=false (AI対象がないので未設定でも問題なし)', async () => {
      const orig = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const r = await processPerson('テスト人物');
      process.env.OPENAI_API_KEY = orig;
      expect(r.aiKeyMissing).toBe(false);
    });

    it('error フィールドは undefined', async () => {
      const r = await processPerson('テスト人物');
      expect(r.error).toBeUndefined();
    });
  });

  // ── ケース2: 楽天APIがエラーを返した場合 ─────────────────────────────────────
  describe('楽天APIがエラーを返した場合', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'error' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed がカテゴリ数（6）になる', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6); // CATEGORIES の件数
    });

    it('stored=0 (エラーは空配列として処理)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(0);
    });

    it('aiQueued=0 (取得0件なのでAI対象なし)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(0);
    });

    it('aiFailed=0 (AI未実行)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiFailed).toBe(0);
    });
  });

  // ── ケース3: 全商品が既存判定済み（重複） ────────────────────────────────────
  describe('全商品が重複(判定済み)だった場合', () => {
    beforeEach(() => {
      const item = makeItem('item-1');
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'ok', products: [item] });
      // ai 判定済み
      vi.mocked(getAllVerdicts).mockResolvedValue({
        'item-1': { source: 'ai', verdict: 'related', score: 80, promptVersion: 'v1', timestamp: Date.now() },
      });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('skipped が5件カウントされる（中古は新品重複で usedSuppressed になる）', async () => {
      const r = await processPerson('テスト人物');
      // CATEGORIES = ['写真集','本・雑誌','Blu-ray・DVD','グッズ','CD','中古']
      // 中古カテゴリは新品5カテゴリと同一タイトルのため usedSuppressed になりスキップ対象外
      expect(r.skipped).toBe(5);
      expect(r.usedSuppressed).toBe(1);
    });

    it('aiQueued=0 (全件スキップ)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(0);
    });

    it('aiKeyMissing=false (AI対象なし → キー未設定は無関係)', async () => {
      const orig = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const r = await processPerson('テスト人物');
      process.env.OPENAI_API_KEY = orig;
      expect(r.aiKeyMissing).toBe(false);
    });
  });

  // ── ケース4: AI対象あり・OPENAI_API_KEY未設定 ────────────────────────────────
  describe('AI対象あり・OPENAI_API_KEY未設定', () => {
    let origKey: string | undefined;

    beforeEach(() => {
      origKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const item = makeItem('item-new');
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'ok', products: [item] });
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    afterEach(() => {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    });

    it('aiKeyMissing=true', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiKeyMissing).toBe(true);
    });

    it('aiQueued=0 (API実行しないのでキューに入らない)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(0);
    });

    it('aiJudged=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiJudged).toBe(0);
    });

    it('judgeProducts は呼ばれない', async () => {
      await processPerson('テスト人物');
      expect(judgeProducts).not.toHaveBeenCalled();
    });

    it('stored=5 (中古は新品重複で usedSuppressed になるため)', async () => {
      const r = await processPerson('テスト人物');
      // 中古カテゴリは新品5カテゴリと同一タイトルのため usedSuppressed になり stored に含まれない
      expect(r.stored).toBe(5);
      expect(r.usedSuppressed).toBe(1);
    });
  });

  // ── ケース5: 成功ケース ──────────────────────────────────────────────────────
  describe('成功ケース（AI判定が正常に完了）', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const items = [makeItem('item-a', 'A商品'), makeItem('item-b', 'B商品')];
      // 写真集カテゴリだけ2件、それ以外は0件
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: items })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(judgeProducts).mockResolvedValue([
        { id: 'item-a', result: { verdict: 'related',   score: 85, reason: 'テスト' } },
        { id: 'item-b', result: { verdict: 'unrelated', score: 10, reason: 'テスト' } },
      ]);
    });

    it('stored=2 (写真集2件)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(2);
    });

    it('aiQueued=2 aiJudged=2', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(2);
      expect(r.aiJudged).toBe(2);
    });

    it('aiFailed=0 (全件成功)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiFailed).toBe(0);
    });

    it('relatedCount=1 unrelatedCount=1 uncertainCount=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.relatedCount).toBe(1);
      expect(r.unrelatedCount).toBe(1);
      expect(r.uncertainCount).toBe(0);
    });

    it('saveVerdict が2回呼ばれる', async () => {
      await processPerson('テスト人物');
      expect(saveVerdict).toHaveBeenCalledTimes(2);
    });

    it('fetchFailed=0 aiKeyMissing=false', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(0);
      expect(r.aiKeyMissing).toBe(false);
    });
  });

  // ── ケース6: AI判定が一部失敗（null返却） ────────────────────────────────────
  describe('AI判定が一部失敗した場合', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const items = [makeItem('item-ok'), makeItem('item-ng')];
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: items })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      // item-ng は null (APIエラー)
      vi.mocked(judgeProducts).mockResolvedValue([
        { id: 'item-ok', result: { verdict: 'related', score: 80, reason: 'ok' } },
        { id: 'item-ng', result: null },
      ]);
    });

    it('aiQueued=2 aiJudged=1 aiFailed=1', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(2);
      expect(r.aiJudged).toBe(1);
      expect(r.aiFailed).toBe(1);
    });
  });

  // ── ケース7: 人物が見つからない場合 ──────────────────────────────────────────
  describe('人物が見つからない場合', () => {
    beforeEach(() => {
      vi.mocked(getAllPersonsWithConfig).mockReturnValue([]);
    });

    it('error フィールドに理由が入る', async () => {
      const r = await processPerson('存在しない人物');
      expect(r.error).toBe('人物が見つかりません');
    });

    it('全カウンターが 0', async () => {
      const r = await processPerson('存在しない人物');
      expect(r.stored).toBe(0);
      expect(r.aiQueued).toBe(0);
      expect(r.fetchFailed).toBe(0);
      expect(r.aiKeyMissing).toBe(false);
    });
  });
});
