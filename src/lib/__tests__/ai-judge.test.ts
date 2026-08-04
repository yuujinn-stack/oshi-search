import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig } from '@/types/person';

// ── モジュールモック ──────────────────────────────────────────────────────────
// openai本体のエラークラス(APIError等)は実物をそのまま使い、chat.completions.create のみ差し替える
// （ai-judge.ts が instanceof で分類しているため、実クラスでないと分類テストが成立しない）

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

import { judgeProduct } from '@/lib/ai-judge';
import { RateLimitError, APIConnectionTimeoutError, APIError } from 'openai';
import { logOpenAIUsage } from '@/lib/openai-usage';

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

function chatResponse(content: string) {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

describe('judgeProduct()', () => {
  let origKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it('OPENAI_API_KEY未設定: OPENAI_NOT_CONFIGUREDを返す（APIキー未呼び出し）', async () => {
    delete process.env.OPENAI_API_KEY;
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('OPENAI_NOT_CONFIGURED');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('正常系: related判定を返す', async () => {
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":95,"reason":"本人の写真集"}'));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({ verdict: 'related', score: 95, reason: '本人の写真集' });
  });

  it('不正なJSON応答: INVALID_JSONを返す（本文はエラーメッセージに含めない）', async () => {
    mockCreate.mockResolvedValue(chatResponse('これはJSONではありません'));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('INVALID_JSON');
    expect(outcome.failure?.message).not.toContain('これはJSONではありません');
  });

  it('レート制限エラー: RATE_LIMITを返す', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, {}, 'rate limited', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('RATE_LIMIT');
  });

  it('レート制限のうちinsufficient_quota: INSUFFICIENT_QUOTAを返す（RATE_LIMITとは区別する）', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, { code: 'insufficient_quota' }, 'You exceeded your current quota', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('INSUFFICIENT_QUOTA');
    expect(outcome.failure?.message).toContain('残高または利用上限');
  });

  it('レート制限のうちbilling_hard_limit_reached: INSUFFICIENT_QUOTAを返す', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, { code: 'billing_hard_limit_reached' }, 'Billing hard limit reached', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure?.code).toBe('INSUFFICIENT_QUOTA');
  });

  it('タイムアウト: TIMEOUTを返す', async () => {
    mockCreate.mockRejectedValue(new APIConnectionTimeoutError());
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('TIMEOUT');
  });

  it('その他のOpenAI APIエラー: OPENAI_API_ERRORを返す', async () => {
    mockCreate.mockRejectedValue(new APIError(500, {}, 'internal error', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('OPENAI_API_ERROR');
  });

  it('未知のエラー: UNKNOWNを返す', async () => {
    mockCreate.mockRejectedValue(new Error('何かおかしい'));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('UNKNOWN');
  });

  it('失敗理由メッセージにAPIキーが含まれない', async () => {
    mockCreate.mockRejectedValue(new APIError(401, {}, 'sk-test-key is invalid', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure?.message).not.toContain('sk-test-key');
  });

  it('OpenAI呼び出し失敗時も logOpenAIUsage には success:false で記録される', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await judgeProduct(makeItem('a'), PERSON);
    expect(logOpenAIUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
