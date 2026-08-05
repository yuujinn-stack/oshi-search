import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

// ── モジュールモック ──────────────────────────────────────────────────────────
// このテストは「route.ts → judgeStoredProducts(実装) → judgeProducts/judgeProduct(実装)」を
// 実コードのまま繋げて検証する。OpenAI課金・実DBだけを境界でモックする。
// 楽天API(getProductsByCategory)は「一度も呼ばれないこと」を検証する対象そのものなので、
// モックした上で呼び出し回数を都度アサートする。

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai');
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) { void _opts; }
  }
  return { ...actual, default: MockOpenAI };
});

vi.mock('@/lib/openai-usage', () => ({
  logOpenAIUsage: vi.fn().mockResolvedValue(undefined),
}));

const mockGetProductsByCategory = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rakuten', () => ({
  getProductsByCategory: mockGetProductsByCategory,
}));

const mockGetAllStoredProducts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
  getAllStoredProducts: mockGetAllStoredProducts,
  storeProducts: vi.fn(),
  saveBatchMeta: vi.fn(),
}));

const mockGetAllVerdicts = vi.hoisted(() => vi.fn());
const mockSaveVerdict = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/judgment-store', () => ({
  getAllVerdicts: mockGetAllVerdicts,
  saveVerdict: mockSaveVerdict,
}));

vi.mock('@/lib/product-membership-guard', () => ({
  checkPostMembershipGroupContent: vi.fn().mockReturnValue({ shouldReview: false, reason: '' }),
}));

vi.mock('@/lib/person-meta', () => ({
  getPersonMeta: vi.fn().mockResolvedValue(null),
}));

const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
vi.mock('@/lib/persons', () => ({
  getAllPersonsMerged: mockGetAllPersonsMerged,
  getAllPersonsWithConfig: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn().mockReturnValue({}),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// batch-lockは実装のまま使うと@/db/clientまで必要になるため、常に取得成功として扱う
vi.mock('@/lib/batch-lock', () => ({
  acquireBatchLock: vi.fn().mockResolvedValue(true),
  releaseBatchLock: vi.fn().mockResolvedValue(undefined),
  personAiJudgeLockKey: (name: string) => `product-ai-judge:${name}`,
}));

// ── 実装（モック登録後にimport）───────────────────────────────────────────────
import { POST } from '@/app/api/admin/ai-judge/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/ai-judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeItem(id: string, title = `商品${id}`): RakutenItem {
  return {
    id, title, price: 1000, reviewCount: 0, reviewAverage: 0,
    imageUrl: '', itemUrl: '', affiliateUrl: '', category: '写真集', relevanceScore: 50,
  };
}

function chatResponse(content: string) {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

function storedDataOf(items: RakutenItem[]) {
  return { '写真集': { products: items, fetchedAt: Date.now() } };
}

const PERSON_NAME = 'テスト人物';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPersonsMerged.mockResolvedValue([{ name: PERSON_NAME, group: 'テストグループ', config: {} }]);
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

describe('AI判定パイプライン統合（route→judgeStoredProducts→ai-judge、楽天API・OpenAIはモック境界）', () => {
  it('楽天APIは1回も呼ばれない（1件成功ケース）', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-a', '限定特典ポストカードセット')]));
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":92,"reason":"本人の写真集"}'));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.person.successCount).toBe(1);
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(mockSaveVerdict).toHaveBeenCalledWith(PERSON_NAME, 'item-a', 'related', 92, 'ai', '本人の写真集', 'v3');
  });

  it('120件保存済みでも最初の10件だけOpenAIへ送信し、楽天APIは呼ばれない', async () => {
    const items = Array.from({ length: 120 }, (_, i) => makeItem(`item-${i}`, `商品${i} 限定グッズ`));
    mockGetAllVerdicts.mockResolvedValue({});
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf(items));
    mockCreate.mockResolvedValue(chatResponse('{"label":"unrelated","score":10,"reason":"無関係"}'));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).toHaveBeenCalledTimes(10);
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(body.person.attemptedCount).toBe(10);
    expect(body.person.remainingCount).toBe(110);
    expect(body.person.message).toBe('10件を判定しました。残り110件');
  });

  it('一部失敗: リトライを使い切った後にRateLimitErrorがRATE_LIMITとして分類される（楽天APIは呼ばれない）', async () => {
    vi.useFakeTimers();
    try {
      mockGetAllVerdicts.mockResolvedValue({});
      mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-ok', '商品OK'), makeItem('item-ng', '商品NG')]));

      const { RateLimitError } = await vi.importActual<typeof import('openai')>('openai');
      mockCreate
        .mockResolvedValueOnce(chatResponse('{"label":"unrelated","score":10,"reason":"無関係"}'))
        .mockRejectedValue(new RateLimitError(429, {}, 'rate limited', new Headers())); // 2件目は毎回429（リトライも使い切る）

      const promise = POST(makePost({ personName: PERSON_NAME }) as never);
      const timers = vi.runAllTimersAsync();
      const [res] = await Promise.all([promise, timers]);
      const body = await res.json();

      expect(mockGetProductsByCategory).not.toHaveBeenCalled();
      expect(body.person.successCount).toBe(1);
      expect(body.person.failedCount).toBe(1);
      expect(body.person.aiFailures[0].code).toBe('RATE_LIMIT');
      expect(body.person.message).toBe('OpenAI APIが一時的な利用制限中です。しばらく待ってから再実行してください');
      // 初回 + リトライ2回 = 3回試行してから諦めている
      expect(mockCreate).toHaveBeenCalledTimes(1 + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('OpenAI残高/上限エラー: INSUFFICIENT_QUOTAとして分類され、楽天APIは呼ばれない', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-a')]));

    const { RateLimitError } = await vi.importActual<typeof import('openai')>('openai');
    mockCreate.mockRejectedValue(new RateLimitError(429, { code: 'insufficient_quota' }, 'quota exceeded', new Headers()));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(body.person.aiFailures[0].code).toBe('INSUFFICIENT_QUOTA');
    expect(body.person.message).toBe('OpenAI APIの残高または利用上限を確認してください');
  });

  it('manual verdict済み商品はOpenAIを一切呼ばずスキップされ、楽天APIも呼ばれない', async () => {
    mockGetAllVerdicts.mockResolvedValue({
      'item-manual': { verdict: 'unrelated', score: 0, source: 'manual', timestamp: Date.now() },
    });
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-manual', '手動判定済み商品')]));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(mockSaveVerdict).not.toHaveBeenCalled();
    expect(body.person.attemptedCount).toBe(0);
  });

  it('保存済み商品が0件: 楽天APIもOpenAIも呼ばれず案内メッセージを返す', async () => {
    mockGetAllStoredProducts.mockResolvedValue({});

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(body.person.message).toBe('保存済みの商品がありません。先に楽天再取得を実行してください');
  });

  it('OPENAI_API_KEY未設定: OpenAI・楽天いずれも呼ばずaiKeyMissing:trueを返す', async () => {
    delete process.env.OPENAI_API_KEY;
    mockGetAllVerdicts.mockResolvedValue({});
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-a')]));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGetProductsByCategory).not.toHaveBeenCalled();
    expect(body.person.aiKeyMissing).toBe(true);
  });

  // ── 「全件AI判定」のクライアント側ループを route レベルでシミュレートする ────────
  // 実際のReactコンポーネントのロジック（PersonAiJudgeButton.handleAutoJudge）と同じ手順
  // （excludeProductIdsを蓄積しながら/api/admin/ai-judgeを繰り返し直列に呼ぶ）を再現し、
  // 120商品が最終的に全件OpenAIへ送信されること・常に直列であることを検証する。
  describe('全件AI判定（クライアントの直列バッチループをシミュレート）', () => {
    it('未判定120件を10件ずつ12バッチで処理し、OpenAI呼び出しが最終的に120回になる', async () => {
      // 商品間ペーシング(350ms)×120回ぶんの実待機を避けるためfake timersで進める
      vi.useFakeTimers();
      try {
        const items = Array.from({ length: 120 }, (_, i) => makeItem(`item-${i}`, `商品${i} 限定グッズ`));
        mockGetAllStoredProducts.mockResolvedValue(storedDataOf(items));

        // 実DBを模した簡易ストア: saveVerdictで書き込み、getAllVerdictsで読み出す
        const verdictsStore: Record<string, { verdict: string; score: number; source: string; reason?: string; timestamp: number; promptVersion?: string }> = {};
        mockGetAllVerdicts.mockImplementation(async () => ({ ...verdictsStore }));
        mockSaveVerdict.mockImplementation(async (
          _personName: string, productId: string, verdict: string, score: number, source: string, reason?: string, promptVersion?: string,
        ) => {
          verdictsStore[productId] = { verdict, score, source, reason, timestamp: Date.now(), promptVersion };
        });

        mockCreate.mockResolvedValue(chatResponse('{"label":"unrelated","score":10,"reason":"無関係"}'));

        let excludeProductIds: string[] = [];
        let batches = 0;
        let remainingCount = Infinity;
        const callCountPerBatch: number[] = [];

        const loop = (async () => {
          while (remainingCount > 0 && batches < 20) {
            const before = mockCreate.mock.calls.length;
            const res = await POST(makePost({ personName: PERSON_NAME, excludeProductIds }) as never);
            const body = await res.json();
            callCountPerBatch.push(mockCreate.mock.calls.length - before);
            batches++;
            remainingCount = body.person.remainingCount;
            for (const f of body.person.aiFailures) {
              if (!excludeProductIds.includes(f.productId)) excludeProductIds.push(f.productId);
            }
            if (body.person.stopProcessing) break;
          }
        })();
        await Promise.all([loop, vi.runAllTimersAsync()]);

        expect(batches).toBe(12); // 120 / 10 = 12バッチ
        expect(remainingCount).toBe(0);
        expect(mockCreate).toHaveBeenCalledTimes(120);
        // 各バッチとも最大10件（常に直列・複数商品をまとめた1リクエストにはしていない）
        expect(callCountPerBatch.every((n) => n <= 10)).toBe(true);
        expect(mockSaveVerdict).toHaveBeenCalledTimes(120);
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('1件だけ恒常的に失敗する商品があっても無限ループにならず、FAILED_ITEMS_REMAINで停止する', async () => {
      const items = [makeItem('item-good', '良い商品'), makeItem('item-bad', '失敗する商品')];
      mockGetAllStoredProducts.mockResolvedValue(storedDataOf(items));

      const verdictsStore: Record<string, { verdict: string; score: number; source: string; timestamp: number; promptVersion?: string }> = {};
      mockGetAllVerdicts.mockImplementation(async () => ({ ...verdictsStore }));
      mockSaveVerdict.mockImplementation(async (_p: string, productId: string, verdict: string, score: number, source: string, _r?: string, promptVersion?: string) => {
        verdictsStore[productId] = { verdict, score, source, timestamp: Date.now(), promptVersion };
      });

      const { APIError } = await vi.importActual<typeof import('openai')>('openai');
      mockCreate.mockImplementation(async (params: { messages: { content: string }[] }) => {
        const content = params.messages[0].content as string;
        if (content.includes('失敗する商品')) throw new APIError(500, {}, 'always fails', new Headers());
        return chatResponse('{"label":"related","score":90,"reason":"ok"}');
      });

      let excludeProductIds: string[] = [];
      let batches = 0;
      let stopped = false;
      let lastBody: { person: { stopReason?: string; remainingCount: number; runnableRemainingCount: number } } | undefined;

      while (batches < 20) {
        const res = await POST(makePost({ personName: PERSON_NAME, excludeProductIds }) as never);
        const body = await res.json();
        lastBody = body;
        batches++;
        for (const f of body.person.aiFailures) {
          if (!excludeProductIds.includes(f.productId)) excludeProductIds.push(f.productId);
        }
        if (body.person.stopProcessing) { stopped = true; break; }
      }

      expect(stopped).toBe(true);
      expect(batches).toBeLessThan(5); // 無限ループしていない
      expect(lastBody?.person.stopReason).toBe('FAILED_ITEMS_REMAIN');
      expect(lastBody?.person.remainingCount).toBe(1); // item-badは未判定のまま残る
      expect(lastBody?.person.runnableRemainingCount).toBe(0);
    });
  });

  it('AI失敗メッセージにAPIキーやOpenAIレスポンス本文が含まれない', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockGetAllStoredProducts.mockResolvedValue(storedDataOf([makeItem('item-a')]));
    const { APIError } = await vi.importActual<typeof import('openai')>('openai');
    mockCreate.mockRejectedValue(new APIError(401, {}, 'sk-test-key is invalid and leaked', new Headers()));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    const message = body.person.aiFailures[0].message as string;
    expect(message).not.toContain('sk-test-key');
    expect(message).not.toContain('is invalid and leaked');
  });
});
