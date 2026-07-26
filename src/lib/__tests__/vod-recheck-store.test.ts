import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup（work-dedup-apply.test.ts と同じ vi.hoisted パターン） ───────────
// neonSql は呼び出しごとに { strings, values } を記録し、await可能なスタブ（空配列）を返す。
// 実際のSQL実行はせず、「どのSQL断片が・どんな値で呼ばれたか」を検証する。
const mockState = vi.hoisted(() => {
  const calls: Array<{ text: string; values: unknown[] }> = [];

  function makeResult() {
    const arr: unknown[] = [];
    return arr; // neonSql の戻り値は配列（rowsそのもの）
  }

  const neonSqlFn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    // ネストしたフラグメント（他のneonSql呼び出し結果）はオブジェクトなので文字列化せず種別だけ記録
    const text = strings.join('{}');
    calls.push({ text, values });
    return Promise.resolve(makeResult());
  });

  const redisFn = vi.fn((): unknown => null);

  return { calls, neonSqlFn, redisFn };
});

vi.mock('@/db/client', () => ({
  neonSql: mockState.neonSqlFn,
}));

vi.mock('@/lib/redis', () => ({
  getRedis: mockState.redisFn,
}));

import {
  getRecheckCandidates,
  getClickCountsForWorkIds,
  getHighTrafficWorkIds,
  clampPage,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../vod-recheck-store';

beforeEach(() => {
  mockState.calls.length = 0;
  mockState.neonSqlFn.mockClear();
  mockState.redisFn.mockClear();
});

// すべての neonSql 呼び出し（フラグメント含む）を1本のテキストとして結合し、
// 特定の値が「どこかの呼び出しのvaluesに含まれているか」を調べるヘルパー
function anyCallIncludesText(substr: string): boolean {
  return mockState.calls.some((c) => c.text.includes(substr));
}
function anyCallIncludesValue(value: unknown): boolean {
  return mockState.calls.some((c) => c.values.includes(value));
}

describe('15. ページング（page/pageSizeの境界値）', () => {
  it('page: 0以下は1に矯正される', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-5)).toBe(1);
  });
  it('page: 小数は切り捨てられる', () => {
    expect(clampPage(2.9)).toBe(2);
  });
  it('pageSize: 上限(100)を超える値は100に矯正される', () => {
    expect(clampPageSize(1000)).toBe(MAX_PAGE_SIZE);
  });
  it('pageSize: 0以下は1に矯正される', () => {
    expect(clampPageSize(0)).toBe(1);
  });
  it('pageSize: 未指定相当(NaN)はデフォルト値になる', () => {
    expect(clampPageSize(NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('getRecheckCandidates: page/pageSizeから正しいLIMIT/OFFSETが渡される', async () => {
    await getRecheckCandidates({ page: 3, pageSize: 20 });
    // offset = (3-1)*20 = 40
    expect(anyCallIncludesValue(20)).toBe(true);
    expect(anyCallIncludesValue(40)).toBe(true);
  });
});

describe('16. フィルター（reason/priority）', () => {
  // 一部のSQL条件（*_EXISTS）はモジュール読み込み時に一度だけ生成される定数のため、
  // beforeEachでの呼び出し履歴クリア後には再記録されない。そのため「都度関数で組み立てる」
  // 理由コード（stale_180_days等）を使い、フィルタあり/なしでのneonSql呼び出し回数の差で
  // フィルタ条件が実際に追加されていることを確認する。
  it('reason指定時はSQL呼び出し回数が増える（条件が追加されている）', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    const withoutFilterCount = mockState.calls.length;

    mockState.calls.length = 0;
    await getRecheckCandidates({ page: 1, pageSize: 10, reason: 'stale_180_days' });
    const withFilterCount = mockState.calls.length;

    expect(withFilterCount).toBeGreaterThan(withoutFilterCount);
  });

  it('priority指定時もSQL呼び出し回数が増える（優先度判定の条件が追加されている）', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    const withoutFilterCount = mockState.calls.length;

    mockState.calls.length = 0;
    await getRecheckCandidates({ page: 1, pageSize: 10, priority: 'high' });
    const withFilterCount = mockState.calls.length;

    expect(withFilterCount).toBeGreaterThan(withoutFilterCount);
  });

  it('reason/priority未指定時は基本の候補条件のみで絞り込まれる', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(anyCallIncludesText("status = 'auto_published'")).toBe(true);
  });
});

describe('14. 優先順位の並び順が安定する', () => {
  it('一覧クエリは id による決定的な ORDER BY を持つ（同一条件なら常に同じ順序になる）', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(anyCallIncludesText('ORDER BY id')).toBe(true);
  });

  it('DISTINCT ON (id) の代表行選定も person_name 昇順で決定的', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(anyCallIncludesText('DISTINCT ON (id)')).toBe(true);
    expect(anyCallIncludesText('ORDER BY id, person_name')).toBe(true);
  });
});

describe('17. タイトル検索', () => {
  it('searchパラメータがILIKE条件として渡される', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10, search: 'テスト作品' });
    expect(anyCallIncludesText('ILIKE')).toBe(true);
    expect(anyCallIncludesValue('%テスト作品%')).toBe(true);
  });
});

describe('18. workId検索', () => {
  it('workIdパラメータがILIKE条件として渡される', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10, workId: 'tmdb-movie-123' });
    expect(anyCallIncludesValue('%tmdb-movie-123%')).toBe(true);
  });
});

describe('作品種別フィルター（workType）', () => {
  it('workType指定時は w.type = 条件と値が渡される', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10, workType: 'movie' });
    expect(anyCallIncludesText('w.type =')).toBe(true);
    expect(anyCallIncludesValue('movie')).toBe(true);
  });

  it('workType未指定時は絞り込まれない', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(anyCallIncludesValue('movie')).toBe(false);
  });
});

describe('処理状態フィルター（processStatus）', () => {
  it('processStatus指定時は vodCheckStatus 条件と値が渡される', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10, processStatus: 'checked' });
    expect(anyCallIncludesText("vodCheckStatus'")).toBe(true);
    expect(anyCallIncludesValue('checked')).toBe(true);
  });

  it('not_started（未処理）も指定可能', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10, processStatus: 'not_started' });
    expect(anyCallIncludesValue('not_started')).toBe(true);
  });
});

describe('24・25. canonical workId対象・非活性化作品の除外', () => {
  it('候補クエリは auto_published かつ deleted=false のみを対象にする（統合済み旧workId・非活性化作品は除外される）', async () => {
    await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(anyCallIncludesText("status = 'auto_published' AND deleted = false")).toBe(true);
  });
});

describe('13. Redis失敗時も一覧表示できる（getRedis()がnullを返す場合）', () => {
  it('getClickCountsForWorkIds は空のMap・available=falseを返す（例外を投げず、0件と失敗を区別できる）', async () => {
    const result = await getClickCountsForWorkIds(['work-1', 'work-2']);
    expect(result.counts).toBeInstanceOf(Map);
    expect(result.counts.size).toBe(0);
    expect(result.available).toBe(false);
  });

  it('getHighTrafficWorkIds は空配列を返す（例外を投げない）', async () => {
    const result = await getHighTrafficWorkIds();
    expect(result).toEqual([]);
  });

  it('getRecheckCandidates はRedis不使用でも例外を投げず候補を返す', async () => {
    const result = await getRecheckCandidates({ page: 1, pageSize: 10 });
    expect(result.rows).toEqual([]);
    expect(result.page).toBe(1);
  });

  it('Redisが利用可能な場合は available=true で実際のカウント（0件含む）を区別できる', async () => {
    mockState.redisFn.mockReturnValueOnce({
      mget: vi.fn().mockResolvedValue(['0', '5']),
    });
    const result = await getClickCountsForWorkIds(['work-a', 'work-b']);
    expect(result.available).toBe(true);
    expect(result.counts.get('work-a')).toBeUndefined(); // 0件は未登録のまま（本当のゼロ）
    expect(result.counts.get('work-b')).toBe(5);
  });

  it('Redis呼び出しが例外を投げた場合も available=false になる', async () => {
    mockState.redisFn.mockReturnValueOnce({
      mget: vi.fn().mockRejectedValue(new Error('redis timeout')),
    });
    const result = await getClickCountsForWorkIds(['work-a']);
    expect(result.available).toBe(false);
  });
});
