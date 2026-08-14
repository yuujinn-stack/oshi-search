import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchRecheckListPage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/vod-recheck-list', () => ({
  fetchRecheckListPage: mockFetchRecheckListPage,
}));

// route.ts は DEFAULT_PAGE_SIZE を @/lib/vod-recheck-store から value import しているため、
// （同モジュールが @/db/client を静的importしDATABASE_URLなしのテスト環境で例外になるのを防ぐため）
// DEFAULT_PAGE_SIZE のみを提供するスタブへ差し替える。
vi.mock('@/lib/vod-recheck-store', () => ({ DEFAULT_PAGE_SIZE: 50 }));

import { GET } from '@/app/api/admin/vod-recheck/candidates/route';

function makeGet(query: string): Request {
  return new Request(`http://localhost/api/admin/vod-recheck/candidates${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchRecheckListPage.mockResolvedValue({
    items: [], total: 0, page: 1, pageSize: 50, clickCountsAvailable: true,
    chatgptProgress: { total: 0, researched: 0 },
  });
});

describe('GET /api/admin/vod-recheck/candidates — offset（「次のN件」バッチ選択用）', () => {
  it('offset未指定時はundefinedのままfetchRecheckListPageへ渡す', async () => {
    await GET(makeGet('?page=1') as never);
    const arg = mockFetchRecheckListPage.mock.calls[0][0];
    expect(arg.offset).toBeUndefined();
  });

  it('offset指定時は数値としてfetchRecheckListPageへ渡す', async () => {
    await GET(makeGet('?offset=75&pageSize=25') as never);
    const arg = mockFetchRecheckListPage.mock.calls[0][0];
    expect(arg.offset).toBe(75);
    expect(arg.pageSize).toBe(25);
  });

  it('offset=0は0のまま渡される（falsy値だが有効な値として扱う）', async () => {
    await GET(makeGet('?offset=0') as never);
    const arg = mockFetchRecheckListPage.mock.calls[0][0];
    expect(arg.offset).toBe(0);
  });

  it('負のoffsetは400エラー', async () => {
    const res = await GET(makeGet('?offset=-1') as never);
    expect(res.status).toBe(400);
    expect(mockFetchRecheckListPage).not.toHaveBeenCalled();
  });

  it('数値でないoffsetは400エラー', async () => {
    const res = await GET(makeGet('?offset=abc') as never);
    expect(res.status).toBe(400);
  });

  it('小数のoffsetは400エラー', async () => {
    const res = await GET(makeGet('?offset=1.5') as never);
    expect(res.status).toBe(400);
  });
});
