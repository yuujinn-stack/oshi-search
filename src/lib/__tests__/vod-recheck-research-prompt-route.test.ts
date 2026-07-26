import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveVodRecheckExportData = vi.hoisted(() => vi.fn());

vi.mock('@/lib/vod-recheck-export-data', () => ({
  resolveVodRecheckExportData: mockResolveVodRecheckExportData,
}));

import { POST } from '@/app/api/admin/vod-recheck/research-prompt/route';

function makePost(body: object): Request {
  return new Request('http://localhost/api/admin/vod-recheck/research-prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function row(overrides: Partial<{ workId: string; personName: string }> = {}) {
  return {
    workId: 'work-1', personName: '人物A', title: 'タイトル', workType: 'movie', releaseYear: 2020,
    roleName: null, currentVodServices: 'Netflix', lastCheckedAt: '', recheckReason: '', priority: 'low',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/vod-recheck/research-prompt', () => {
  it('itemsが配列でなければ400', async () => {
    const res = await POST(makePost({ items: 'bad' }) as never);
    expect(res.status).toBe(400);
  });

  it('50件を超えると400', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ personName: '人物A', workId: `work-${i}` }));
    const res = await POST(makePost({ items }) as never);
    expect(res.status).toBe(400);
    expect(mockResolveVodRecheckExportData).not.toHaveBeenCalled();
  });

  it('解決対象0件（非公開・削除済み・存在しないworkId）は400', async () => {
    mockResolveVodRecheckExportData.mockResolvedValue({ rows: [], unresolvedWorkIds: ['ghost'] });
    const res = await POST(makePost({ items: [{ personName: '人物A', workId: 'ghost' }] }) as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { unresolvedWorkIds: string[] };
    expect(body.unresolvedWorkIds).toEqual(['ghost']);
  });

  it('成功時: プロンプト全文・作品数（distinct workId）・区切りマーカーを返す', async () => {
    mockResolveVodRecheckExportData.mockResolvedValue({
      rows: [row({ workId: 'work-1', personName: '人物A' }), row({ workId: 'work-1', personName: '人物B' }), row({ workId: 'work-2', personName: '人物C' })],
      unresolvedWorkIds: [],
    });
    const res = await POST(makePost({ items: [{ personName: '人物A', workId: 'work-1' }] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { prompt: string; workCount: number };
    // work-1が2人物・work-2が1人物の3行だが、作品数はdistinct workIdの2件
    expect(body.workCount).toBe(2);
    expect(body.prompt).toContain('---作品CSVここから---');
    expect(body.prompt).toContain('---作品CSVここまで---');
    expect(body.prompt).toContain('work-1,人物A');
    expect(body.prompt).toContain('work-1,人物B');
    expect(body.prompt).toContain('work-2,人物C');
  });
});
