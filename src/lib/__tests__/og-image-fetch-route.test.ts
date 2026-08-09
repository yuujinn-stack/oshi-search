import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetWork = vi.hoisted(() => vi.fn());
const mockSaveWork = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRevalidateTag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/work-store', () => ({
  getWork: mockGetWork,
  saveWork: mockSaveWork,
}));
vi.mock('next/cache', () => ({ revalidateTag: mockRevalidateTag }));
// ranking.ts はDBに触れるモジュールを読み込むため、テストではタグ定数のみ提供する
vi.mock('@/lib/ranking', () => ({ RANKING_DATA_CACHE_TAG: 'ranking-data' }));

import { POST } from '@/app/api/admin/og-image-fetch/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/og-image-fetch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function htmlWithOgImage(imageUrl: string): string {
  return `<html><head><meta property="og:image" content="${imageUrl}"></head><body></body></html>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveWork.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/og-image-fetch — 候補URLの優先順位（sourceUrl→officialUrl）', () => {
  it('sourceUrl（管理者が指定したページ）を officialUrl（AI補完の汎用URL）より先に試す', async () => {
    mockGetWork.mockResolvedValue({
      id: 'work-1',
      title: 'テスト作品',
      ogImageUrl: undefined,
      vodProviders: [
        { providerId: 1, providerName: 'Lemino', type: 'flatrate', countryCode: 'JP', source: 'openai_web_search', officialUrl: 'https://lemino.docomo.ne.jp/' },
        { providerId: 2, providerName: '動画', type: 'unknown', countryCode: 'JP', source: 'manual_csv', sourceUrl: 'https://example.com/work-1-page' },
      ],
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/work-1-page') {
        return new Response(htmlWithOgImage('https://example.com/work-1-thumb.jpg'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      // officialUrl（Leminoの汎用ページ）が先に呼ばれてしまっていたら検出できるよう、
      // ここが呼ばれた場合はLeminoのロゴを返す（バグ再現用）
      return new Response(htmlWithOgImage('https://lemino.docomo.ne.jp/logo.png'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makePost({ personName: '人物A', workId: 'work-1' }) as never);
    const body = await res.json() as { ok: boolean; ogImageUrl?: string };

    expect(body.ok).toBe(true);
    // sourceUrlの画像が採用され、Leminoのロゴにはならないことを確認
    expect(body.ogImageUrl).toBe('https://example.com/work-1-thumb.jpg');
    // 最初に呼ばれたfetchがsourceUrlであることを確認（officialUrlが先に試されていない）
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/work-1-page');
    // OG画像取得に成功した場合、人気作品のランキングキャッシュを即時失効する
    expect(mockRevalidateTag).toHaveBeenCalledWith('ranking-data', { expire: 0 });
  });
});
