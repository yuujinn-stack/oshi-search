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

import { judgeProduct, judgeProducts } from '@/lib/ai-judge';
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
    vi.useFakeTimers();
    origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
  });

  // fake timers下でリトライを含む呼び出しを進める共通ヘルパー
  async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
    const timers = vi.runAllTimersAsync();
    const [result] = await Promise.all([promise, timers]);
    return result;
  }

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

  it('レート制限エラー: リトライを使い切った後 RATE_LIMIT を返す', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, {}, 'rate limited', new Headers()));
    const outcome = await runWithTimers(judgeProduct(makeItem('a'), PERSON));
    expect(outcome.result).toBeNull();
    expect(outcome.failure?.code).toBe('RATE_LIMIT');
    // 初回 + リトライ2回 = 最大3回試行する
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('レート制限エラー: 2回目の試行で成功すればそのまま結果を返す（プロンプト等は毎回同一）', async () => {
    mockCreate
      .mockRejectedValueOnce(new RateLimitError(429, {}, 'rate limited', new Headers()))
      .mockResolvedValueOnce(chatResponse('{"label":"related","score":90,"reason":"リトライ後成功"}'));
    const outcome = await runWithTimers(judgeProduct(makeItem('a'), PERSON));
    expect(outcome.result).toEqual({ verdict: 'related', score: 90, reason: 'リトライ後成功' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    // 2回とも全く同じ呼び出し内容（プロンプト・モデル・temperature等）であること
    expect(mockCreate.mock.calls[0][0]).toEqual(mockCreate.mock.calls[1][0]);
  });

  it('レート制限エラー: Retry-Afterヘッダーがあればその秒数だけ待機する', async () => {
    mockCreate
      .mockRejectedValueOnce(new RateLimitError(429, {}, 'rate limited', new Headers({ 'retry-after': '5' })))
      .mockResolvedValueOnce(chatResponse('{"label":"related","score":80,"reason":"ok"}'));
    const promise = judgeProduct(makeItem('a'), PERSON);
    // Retry-Afterの5秒未満ではまだ2回目が呼ばれていないことを確認する
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const outcome = await promise;
    expect(outcome.result).not.toBeNull();
  });

  it('insufficient_quota（残高不足）はリトライせず即座にINSUFFICIENT_QUOTAを返す', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, { code: 'insufficient_quota' }, 'quota exceeded', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure?.code).toBe('INSUFFICIENT_QUOTA');
    expect(mockCreate).toHaveBeenCalledTimes(1); // リトライしない
  });

  it('メッセージ文言が"no credits remaining"の場合もINSUFFICIENT_QUOTAとして分類しリトライしない（err.codeが一致しない実例への対応）', async () => {
    // error(第2引数)を渡すとAPIError.makeMessageがそちらを優先してしまうため、undefinedにして
    // message(第3引数)がそのままerr.messageになるようにする（本番で実際に観測された文言を再現）
    mockCreate.mockRejectedValue(new RateLimitError(429, undefined, 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure?.code).toBe('INSUFFICIENT_QUOTA');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('メッセージ文言が"exceeded your current quota"の場合もINSUFFICIENT_QUOTAとして分類する', async () => {
    mockCreate.mockRejectedValue(new RateLimitError(429, undefined, 'You exceeded your current quota, please check your plan and billing details.', new Headers()));
    const outcome = await judgeProduct(makeItem('a'), PERSON);
    expect(outcome.failure?.code).toBe('INSUFFICIENT_QUOTA');
    expect(mockCreate).toHaveBeenCalledTimes(1);
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

describe('judgeProducts()（複数商品・同時実行数1・商品間ペーシング）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.OPENAI_API_KEY = 'sk-test-key';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
    const timers = vi.runAllTimersAsync();
    const [result] = await Promise.all([promise, timers]);
    return result;
  }

  it('3商品を渡すとOpenAIを3回、常に直列（1商品ずつ独立）で呼ぶ', async () => {
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":80,"reason":"ok"}'));
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    const results = await runWithTimers(judgeProducts(items, PERSON));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('複数商品をまとめた1回のOpenAIリクエストにはしない（各呼び出しのmessagesは単一商品分のみ）', async () => {
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":80,"reason":"ok"}'));
    const items = [makeItem('a', '商品A'), makeItem('b', '商品B')];
    await runWithTimers(judgeProducts(items, PERSON));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const call1Content = mockCreate.mock.calls[0][0].messages[0].content as string;
    const call2Content = mockCreate.mock.calls[1][0].messages[0].content as string;
    // 商品Aのプロンプトに商品Bのタイトルが混入していない（逆も同様）＝情報が独立している
    expect(call1Content).toContain('商品A');
    expect(call1Content).not.toContain('商品B');
    expect(call2Content).toContain('商品B');
    expect(call2Content).not.toContain('商品A');
  });

  it('各呼び出しのモデル・temperature・response_format・max_tokensは全商品で同一', async () => {
    mockCreate.mockResolvedValue(chatResponse('{"label":"related","score":80,"reason":"ok"}'));
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    await runWithTimers(judgeProducts(items, PERSON));
    const paramsList = mockCreate.mock.calls.map((c) => {
      const { messages: _messages, ...rest } = c[0];
      return rest;
    });
    expect(paramsList[0]).toEqual({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, max_tokens: 100, temperature: 0 });
    expect(paramsList[1]).toEqual(paramsList[0]);
    expect(paramsList[2]).toEqual(paramsList[0]);
  });

  it('1件失敗しても残りの商品の判定は続行する', async () => {
    mockCreate
      .mockResolvedValueOnce(chatResponse('{"label":"related","score":80,"reason":"ok"}'))
      .mockRejectedValueOnce(new RateLimitError(429, { code: 'insufficient_quota' }, 'no credits', new Headers()))
      .mockResolvedValueOnce(chatResponse('{"label":"unrelated","score":10,"reason":"ok"}'));
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    const results = await runWithTimers(judgeProducts(items, PERSON));
    expect(results[0].result?.verdict).toBe('related');
    expect(results[1].result).toBeNull();
    expect(results[1].failure?.code).toBe('INSUFFICIENT_QUOTA');
    expect(results[2].result?.verdict).toBe('unrelated');
  });
});
