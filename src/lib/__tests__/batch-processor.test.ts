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
  storeProducts: vi.fn().mockResolvedValue({
    fetchedCount: 0, retainedExistingCount: 0, addedCount: 0,
    mergedCount: 0, preservedManualCount: 0, preservedVerdictedCount: 0,
    skippedBecauseError: false,
  }),
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
import { storeProducts } from '@/lib/product-store';
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
  vi.mocked(getAllPersonsWithConfig).mockReturnValue([PERSON]);
  vi.mocked(getAllVerdicts).mockResolvedValue({});
  vi.mocked(shouldAutoApprove).mockReturnValue(false);
  vi.mocked(storeProducts).mockResolvedValue({
    fetchedCount: 0, retainedExistingCount: 0, addedCount: 0,
    mergedCount: 0, preservedManualCount: 0, preservedVerdictedCount: 0,
    skippedBecauseError: false,
  });
});

// ── テスト ────────────────────────────────────────────────────────────────────

describe('processPerson()', () => {

  // ── テスト1: RAKUTEN_APP_ID / ACCESS_KEY 未設定 ──────────────────────────────
  describe('テスト1: 必須環境変数が未設定', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'config_missing' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('rakutenConfigMissing=true', async () => {
      const r = await processPerson('テスト人物');
      expect(r.rakutenConfigMissing).toBe(true);
    });

    it('stored=0 / fetchFailed=0 / aiQueued=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(0);
      expect(r.fetchFailed).toBe(0);
      expect(r.aiQueued).toBe(0);
    });

    it('getProductsByCategory は1回だけ呼ばれて早期脱出する', async () => {
      await processPerson('テスト人物');
      expect(getProductsByCategory).toHaveBeenCalledTimes(1);
    });

    it('error フィールドは undefined', async () => {
      const r = await processPerson('テスト人物');
      expect(r.error).toBeUndefined();
    });
  });

  // ── テスト2: 環境変数が空文字（config_missing と同等） ──────────────────────
  describe('テスト2: 環境変数が空文字', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'config_missing' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('rakutenConfigMissing=true', async () => {
      const r = await processPerson('テスト人物');
      expect(r.rakutenConfigMissing).toBe(true);
    });
  });

  // ── テスト3: 楽天APIが正常に0件を返す ───────────────────────────────────────
  describe('テスト3: 楽天APIが正常に0件を返す', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'empty' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('stored=0 aiQueued=0 fetchFailed=0 rakutenConfigMissing=false', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(0);
      expect(r.aiQueued).toBe(0);
      expect(r.fetchFailed).toBe(0);
      expect(r.rakutenConfigMissing).toBe(false);
    });

    it('upstreamHttpStatus は undefined（正常0件はエラーではない）', async () => {
      const r = await processPerson('テスト人物');
      expect(r.upstreamHttpStatus).toBeUndefined();
    });
  });

  // ── テスト4: 全件既登録（全件スキップ） ─────────────────────────────────────
  describe('テスト4: 全件既登録', () => {
    beforeEach(() => {
      const item = makeItem('item-1');
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'ok', products: [item] });
      vi.mocked(getAllVerdicts).mockResolvedValue({
        'item-1': { source: 'ai', verdict: 'related', score: 80, promptVersion: 'v1', timestamp: Date.now() },
      });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('aiQueued=0 (全件スキップ)', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiQueued).toBe(0);
    });

    it('skipped=5 usedSuppressed=1 (中古は新品重複で抑制)', async () => {
      // CATEGORIES = ['写真集','本・雑誌','Blu-ray・DVD','グッズ','CD','中古']
      // 中古カテゴリは新品5カテゴリと同一タイトルのため usedSuppressed になる
      const r = await processPerson('テスト人物');
      expect(r.skipped).toBe(5);
      expect(r.usedSuppressed).toBe(1);
    });

    it('rakutenConfigMissing=false', async () => {
      const r = await processPerson('テスト人物');
      expect(r.rakutenConfigMissing).toBe(false);
    });
  });

  // ── テスト5: 新規追加あり（成功ケース） ──────────────────────────────────────
  describe('テスト5: 新規追加あり', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const items = [makeItem('item-a', 'A商品'), makeItem('item-b', 'B商品')];
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: items })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(judgeProducts).mockResolvedValue([
        { id: 'item-a', result: { verdict: 'related',   score: 85, reason: 'ok' } },
        { id: 'item-b', result: { verdict: 'unrelated', score: 10, reason: 'ok' } },
      ]);
    });

    it('stored=2 aiQueued=2 aiJudged=2', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(2);
      expect(r.aiQueued).toBe(2);
      expect(r.aiJudged).toBe(2);
    });

    it('aiFailed=0 relatedCount=1 unrelatedCount=1', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiFailed).toBe(0);
      expect(r.relatedCount).toBe(1);
      expect(r.unrelatedCount).toBe(1);
    });

    it('rakutenConfigMissing=false fetchFailed=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.rakutenConfigMissing).toBe(false);
      expect(r.fetchFailed).toBe(0);
    });

    it('saveVerdict が2回呼ばれる', async () => {
      await processPerson('テスト人物');
      expect(saveVerdict).toHaveBeenCalledTimes(2);
    });
  });

  // ── テスト6: 楽天APIが401を返す ─────────────────────────────────────────────
  describe('テスト6: 楽天APIが401を返す', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'upstream_error', httpStatus: 401 });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed=6 upstreamHttpStatus=401', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6);
      expect(r.upstreamHttpStatus).toBe(401);
    });

    it('stored=0 rakutenConfigMissing=false', async () => {
      const r = await processPerson('テスト人物');
      expect(r.stored).toBe(0);
      expect(r.rakutenConfigMissing).toBe(false);
    });
  });

  // ── テスト7: 楽天APIが429を返す ─────────────────────────────────────────────
  describe('テスト7: 楽天APIが429を返す', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'upstream_error', httpStatus: 429 });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed=6 upstreamHttpStatus=429', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6);
      expect(r.upstreamHttpStatus).toBe(429);
    });
  });

  // ── テスト8: 楽天APIが500を返す ─────────────────────────────────────────────
  describe('テスト8: 楽天APIが500を返す', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'upstream_error', httpStatus: 500 });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed=6 upstreamHttpStatus=500', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6);
      expect(r.upstreamHttpStatus).toBe(500);
    });
  });

  // ── テスト9: タイムアウト / ネットワーク障害 ─────────────────────────────────
  describe('テスト9: タイムアウト（ネットワーク障害）', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'error' });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed=6 upstreamHttpStatus=undefined', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6);
      expect(r.upstreamHttpStatus).toBeUndefined();
    });

    it('rakutenConfigMissing=false', async () => {
      const r = await processPerson('テスト人物');
      expect(r.rakutenConfigMissing).toBe(false);
    });
  });

  // ── テスト10: DB保存失敗 ─────────────────────────────────────────────────────
  describe('テスト10: DB保存失敗', () => {
    beforeEach(() => {
      const item = makeItem('item-x');
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: [item] })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(storeProducts).mockRejectedValue(new Error('DB接続タイムアウト'));
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('error フィールドに "DB保存失敗" が含まれる', async () => {
      const r = await processPerson('テスト人物');
      expect(r.error).toMatch(/DB保存失敗/);
    });

    it('processPerson は throw せずに error を返す（安全な失敗）', async () => {
      await expect(processPerson('テスト人物')).resolves.not.toThrow();
    });
  });

  // ── テスト11: AI対象あり・OPENAI_API_KEY未設定 ────────────────────────────────
  describe('テスト11: AI対象あり・OPENAI_API_KEY未設定', () => {
    let origKey: string | undefined;

    beforeEach(() => {
      origKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const item = makeItem('item-new');
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: [item] })
            : Promise.resolve({ status: 'empty' }),
      );
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

    it('judgeProducts は呼ばれない', async () => {
      await processPerson('テスト人物');
      expect(judgeProducts).not.toHaveBeenCalled();
    });
  });

  // ── テスト12: AI判定一部失敗 ─────────────────────────────────────────────────
  describe('テスト12: AI判定が一部失敗', () => {
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

  // ── テスト13: 人物が見つからない場合 ──────────────────────────────────────────
  describe('テスト13: 人物が見つからない場合', () => {
    beforeEach(() => {
      vi.mocked(getAllPersonsWithConfig).mockReturnValue([]);
    });

    it('error フィールドに理由が入る', async () => {
      const r = await processPerson('存在しない人物');
      expect(r.error).toBe('人物が見つかりません');
    });

    it('rakutenConfigMissing=false', async () => {
      const r = await processPerson('存在しない人物');
      expect(r.rakutenConfigMissing).toBe(false);
    });
  });

  // ── テスト14: 自動承認あり（aiJudged/aiQueued 不変条件の検証） ────────────────
  describe('テスト14: 自動承認あり', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const items = [makeItem('item-auto', '自動承認商品'), makeItem('item-ai', 'AI判定商品')];
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: items })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      // item-auto は自動承認、item-ai は通常 AI 判定
      vi.mocked(shouldAutoApprove).mockImplementation((p) => p.id === 'item-auto');
      vi.mocked(judgeProducts).mockResolvedValue([
        { id: 'item-ai', result: { verdict: 'related', score: 85, reason: 'ok' } },
      ]);
    });

    it('autoApproved=1 aiQueued=1 aiJudged=1（自動承認分は aiJudged に含まれない）', async () => {
      const r = await processPerson('テスト人物');
      expect(r.autoApproved).toBe(1);
      expect(r.aiQueued).toBe(1);
      expect(r.aiJudged).toBe(1);
    });

    it('不変条件: aiJudged <= aiQueued', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiJudged).toBeLessThanOrEqual(r.aiQueued);
    });

    it('aiFailed=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiFailed).toBe(0);
    });
  });

  // ── テスト15: 全商品が自動承認（aiQueued=0 のとき aiJudged も 0）─────────────
  describe('テスト15: 全商品が自動承認', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const items = [makeItem('item-a'), makeItem('item-b')];
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) =>
          cat === '写真集'
            ? Promise.resolve({ status: 'ok', products: items })
            : Promise.resolve({ status: 'empty' }),
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(shouldAutoApprove).mockReturnValue(true);
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('autoApproved=2 aiQueued=0 aiJudged=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.autoApproved).toBe(2);
      expect(r.aiQueued).toBe(0);
      expect(r.aiJudged).toBe(0);
    });

    it('不変条件: aiJudged <= aiQueued（どちらも0）', async () => {
      const r = await processPerson('テスト人物');
      expect(r.aiJudged).toBeLessThanOrEqual(r.aiQueued);
    });

    it('judgeProducts は呼ばれない', async () => {
      await processPerson('テスト人物');
      expect(judgeProducts).not.toHaveBeenCalled();
    });
  });

  // ── テスト16: 一部カテゴリ失敗（部分成功 = failedCategories に失敗分が入る）───
  describe('テスト16: 一部カテゴリ取得失敗（部分成功）', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const item = makeItem('item-ok');
      vi.mocked(getProductsByCategory).mockImplementation(
        (_name, _group, cat) => {
          if (cat === '写真集') return Promise.resolve({ status: 'ok', products: [item] });
          if (cat === '本・雑誌') return Promise.resolve({ status: 'upstream_error', httpStatus: 403 });
          if (cat === 'CD') return Promise.resolve({ status: 'error' });
          return Promise.resolve({ status: 'empty' });
        },
      );
      vi.mocked(getAllVerdicts).mockResolvedValue({});
      vi.mocked(judgeProducts).mockResolvedValue([
        { id: 'item-ok', result: { verdict: 'related', score: 85, reason: 'ok' } },
      ]);
    });

    it('fetchFailed=2 stored>0（部分成功）', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(2);
      expect(r.stored).toBeGreaterThan(0);
    });

    it('failedCategories に "本・雑誌" と "CD" が含まれる', async () => {
      const r = await processPerson('テスト人物');
      expect(r.failedCategories).toContain('本・雑誌');
      expect(r.failedCategories).toContain('CD');
    });

    it('failedCategories に成功カテゴリ "写真集" が含まれない', async () => {
      const r = await processPerson('テスト人物');
      expect(r.failedCategories).not.toContain('写真集');
    });
  });

  // ── テスト17: 楽天APIが429を返す（rate_limited 検証用） ─────────────────────
  describe('テスト17: 楽天APIが429を返す（全カテゴリ）', () => {
    beforeEach(() => {
      vi.mocked(getProductsByCategory).mockResolvedValue({ status: 'upstream_error', httpStatus: 429 });
      vi.mocked(judgeProducts).mockResolvedValue([]);
    });

    it('fetchFailed=6 upstreamHttpStatus=429 stored=0', async () => {
      const r = await processPerson('テスト人物');
      expect(r.fetchFailed).toBe(6);
      expect(r.upstreamHttpStatus).toBe(429);
      expect(r.stored).toBe(0);
    });

    it('failedCategories に全カテゴリが含まれる', async () => {
      const r = await processPerson('テスト人物');
      expect(r.failedCategories).toHaveLength(6);
    });
  });
});

// ── ソースコードアサーション（曖昧表示の残留チェック） ──────────────────────────

describe('UIコード品質チェック', () => {
  it('PersonRakutenFetchButton に "API未設定/0件" が存在しない（テスト13）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonRakutenFetchButton.tsx'),
      'utf-8',
    );
    expect(src).not.toContain('API未設定/0件');
  });

  it('PersonAiJudgeButton に "API未設定/0件" が存在しない（テスト13）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonAiJudgeButton.tsx'),
      'utf-8',
    );
    expect(src).not.toContain('API未設定/0件');
  });

  it('PersonRakutenFetchButton に "API設定不足" 表示が含まれる（テスト11）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonRakutenFetchButton.tsx'),
      'utf-8',
    );
    expect(src).toContain('API設定不足');
  });

  it('PersonRakutenFetchButton に "API正常・0件" 表示が含まれる（テスト12）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonRakutenFetchButton.tsx'),
      'utf-8',
    );
    expect(src).toContain('API正常・0件');
  });

  it('PersonRakutenFetchButton に "取得エラー" が存在しない（検索失敗カテゴリ表記に統一）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonRakutenFetchButton.tsx'),
      'utf-8',
    );
    expect(src).not.toContain('取得エラー');
  });

  it('PersonRakutenFetchButton に "利用制限" メッセージが含まれる（429対応）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonRakutenFetchButton.tsx'),
      'utf-8',
    );
    expect(src).toContain('利用制限');
  });

  it('PersonAiJudgeButton に "取得エラー" が存在しない（検索失敗カテゴリ表記に統一）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonAiJudgeButton.tsx'),
      'utf-8',
    );
    expect(src).not.toContain('取得エラー');
  });

  it('PersonAiJudgeButton に "利用制限" メッセージが含まれる（429対応）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/admin/product-check/PersonAiJudgeButton.tsx'),
      'utf-8',
    );
    expect(src).toContain('利用制限');
  });
});

// ── rakuten.ts — env var が process.env 直参照であることの確認 ──────────────────

describe('getProductsByCategory — 環境変数チェック', () => {
  let origAppId: string | undefined;
  let origAccessKey: string | undefined;

  beforeEach(() => {
    origAppId     = process.env.RAKUTEN_APP_ID;
    origAccessKey = process.env.RAKUTEN_ACCESS_KEY;
  });

  afterEach(() => {
    if (origAppId !== undefined)     process.env.RAKUTEN_APP_ID     = origAppId;
    else                             delete process.env.RAKUTEN_APP_ID;
    if (origAccessKey !== undefined) process.env.RAKUTEN_ACCESS_KEY = origAccessKey;
    else                             delete process.env.RAKUTEN_ACCESS_KEY;
  });

  it('RAKUTEN_APP_ID 未設定のとき config_missing を返す（テスト1）', async () => {
    // vi.mock でモック化しているため vi.importActual で実装を直接取得する
    const { getProductsByCategory: realFn } = await vi.importActual<typeof import('@/lib/rakuten')>('@/lib/rakuten');
    delete process.env.RAKUTEN_APP_ID;
    delete process.env.RAKUTEN_ACCESS_KEY;
    const result = await realFn('テスト', 'グループ', '写真集', {}, 'no-store');
    expect(result.status).toBe('config_missing');
  });

  it('RAKUTEN_APP_ID が空文字のとき config_missing を返す（テスト2）', async () => {
    const { getProductsByCategory: realFn } = await vi.importActual<typeof import('@/lib/rakuten')>('@/lib/rakuten');
    process.env.RAKUTEN_APP_ID     = '';
    process.env.RAKUTEN_ACCESS_KEY = '';
    const result = await realFn('テスト', 'グループ', '写真集', {}, 'no-store');
    expect(result.status).toBe('config_missing');
  });
});
