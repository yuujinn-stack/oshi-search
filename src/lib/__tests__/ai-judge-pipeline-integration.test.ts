import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

// ── モジュールモック ──────────────────────────────────────────────────────────
// このテストは「route.ts → processPerson(実装) → judgeProducts/judgeProduct(実装)」を
// 実コードのまま繋げて検証する。OpenAI課金・Rakuten実HTTP・実DBだけを境界でモックする。
// ai-judge.ts の分類ロジック(JSON解析・エラー分類)とbatch-processor.tsの優先度チェックが
// 実際に正しく合成されるかを確認するのが目的（batch-processor.test.tsはjudgeProducts自体を
// モックしており、ai-judge.test.tsはjudgeProduct単体のみのため、両者の結合はここでのみ検証する）。

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

vi.mock('@/lib/rakuten', () => ({
  getProductsByCategory: vi.fn(),
}));

const mockStoreProducts = vi.hoisted(() => vi.fn().mockResolvedValue({
  fetchedCount: 0, retainedExistingCount: 0, addedCount: 0,
  mergedCount: 0, preservedManualCount: 0, preservedVerdictedCount: 0,
  skippedBecauseError: false,
}));
vi.mock('@/lib/product-store', () => ({
  CATEGORIES: ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'],
  storeProducts: mockStoreProducts,
  saveBatchMeta: vi.fn().mockResolvedValue(undefined),
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

// ── 実装（モック登録後にimport）───────────────────────────────────────────────
import { POST } from '@/app/api/admin/ai-judge/route';
import { getProductsByCategory } from '@/lib/rakuten';

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

const PERSON_NAME = 'テスト人物';

// カテゴリごとに呼ばれる getProductsByCategory を、指定カテゴリのみ商品ありにする
function mockCategoryProducts(category: string, items: RakutenItem[]) {
  vi.mocked(getProductsByCategory).mockImplementation((_name, _group, cat) =>
    cat === category
      ? Promise.resolve({ status: 'ok', products: items })
      : Promise.resolve({ status: 'empty' }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreProducts.mockResolvedValue({
    fetchedCount: 0, retainedExistingCount: 0, addedCount: 0,
    mergedCount: 0, preservedManualCount: 0, preservedVerdictedCount: 0,
    skippedBecauseError: false,
  });
  mockSaveVerdict.mockResolvedValue(undefined);
  mockGetAllPersonsMerged.mockResolvedValue([{ name: PERSON_NAME, group: 'テストグループ', config: {} }]);
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

describe('AI判定パイプライン統合（route→processPerson→ai-judge、OpenAIのみモック）', () => {
  it('1件成功: 実際のJSON解析を経てrelatedが保存され、レスポンスに反映される', async () => {
    // タイトルに人物名+「写真集」を含めると shouldAutoApprove() が先に確定させてしまい
    // OpenAIを経由しないため、意図的に自動承認条件に当たらないタイトルにする
    mockGetAllVerdicts.mockResolvedValue({});
    mockCategoryProducts('写真集', [makeItem('item-a', '限定特典ポストカードセット')]);
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":92,"reason":"本人の写真集"}'));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.person.aiJudged).toBe(1);
    expect(body.person.aiFailed).toBe(0);
    expect(body.person.relatedCount).toBe(1);
    expect(mockSaveVerdict).toHaveBeenCalledWith(
      PERSON_NAME, 'item-a', 'related', 92, 'ai', '本人の写真集', 'v3',
    );
  });

  it('一部失敗: 実際のRateLimitErrorが分類され、成功分のみsaveVerdictされる', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockCategoryProducts('写真集', [makeItem('item-ok', '商品OK'), makeItem('item-ng', '商品NG')]);

    const { RateLimitError } = await vi.importActual<typeof import('openai')>('openai');
    mockCreate
      .mockResolvedValueOnce(chatResponse('{"label":"unrelated","score":10,"reason":"無関係"}'))
      .mockRejectedValueOnce(new RateLimitError(429, {}, 'rate limited', new Headers()));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.person.aiJudged).toBe(1);
    expect(body.person.aiFailed).toBe(1);
    expect(body.person.aiFailures).toHaveLength(1);
    expect(body.person.aiFailures[0].code).toBe('RATE_LIMIT');
    expect(mockSaveVerdict).toHaveBeenCalledTimes(1);
    expect(mockSaveVerdict).toHaveBeenCalledWith(
      PERSON_NAME, 'item-ok', 'unrelated', 10, 'ai', '無関係', 'v3',
    );
  });

  it('全件失敗: JSON解析エラーが実際に分類され、saveVerdictは一度も呼ばれない', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockCategoryProducts('写真集', [makeItem('item-a')]);
    mockCreate.mockResolvedValue(chatResponse('これはJSONではありません'));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(res.status).toBe(200); // AI失敗はHTTPエラーにしない仕様
    expect(body.person.aiJudged).toBe(0);
    expect(body.person.aiFailed).toBe(1);
    expect(body.person.aiFailures[0].code).toBe('INVALID_JSON');
    expect(mockSaveVerdict).not.toHaveBeenCalled();
  });

  it('manual verdict済み商品はOpenAIを一切呼ばずスキップされる', async () => {
    mockGetAllVerdicts.mockResolvedValue({
      'item-manual': { verdict: 'unrelated', score: 0, source: 'manual', timestamp: Date.now() },
    });
    mockCategoryProducts('写真集', [makeItem('item-manual', '手動判定済み商品')]);

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSaveVerdict).not.toHaveBeenCalled();
    expect(body.person.aiQueued).toBe(0);
    expect(body.person.skipped).toBe(1);
  });

  it('deleted verdict済み商品はOpenAIを一切呼ばずスキップされる', async () => {
    mockGetAllVerdicts.mockResolvedValue({
      'item-deleted': { verdict: 'deleted', score: 0, source: 'manual', timestamp: Date.now() },
    });
    mockCategoryProducts('写真集', [makeItem('item-deleted', '削除済み商品')]);

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSaveVerdict).not.toHaveBeenCalled();
    expect(body.person.aiQueued).toBe(0);
  });

  it('OPENAI_API_KEY未設定: OpenAIを一切呼ばずaiKeyMissing:trueを返す', async () => {
    delete process.env.OPENAI_API_KEY;
    mockGetAllVerdicts.mockResolvedValue({});
    mockCategoryProducts('写真集', [makeItem('item-a')]);

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(body.person.aiKeyMissing).toBe(true);
  });

  it('AI失敗メッセージにAPIキーやOpenAIレスポンス本文が含まれない', async () => {
    mockGetAllVerdicts.mockResolvedValue({});
    mockCategoryProducts('写真集', [makeItem('item-a')]);
    const { APIError } = await vi.importActual<typeof import('openai')>('openai');
    mockCreate.mockRejectedValue(new APIError(401, {}, 'sk-test-key is invalid and leaked', new Headers()));

    const res = await POST(makePost({ personName: PERSON_NAME }) as never);
    const body = await res.json();

    const message = body.person.aiFailures[0].message as string;
    expect(message).not.toContain('sk-test-key');
    expect(message).not.toContain('is invalid and leaked');
  });
});
