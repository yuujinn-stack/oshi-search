import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetWork = vi.hoisted(() => vi.fn());
const mockSetManualImageUrl = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/work-store', () => ({
  getWork: mockGetWork,
  setManualImageUrl: mockSetManualImageUrl,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

import { PATCH } from '@/app/api/admin/work-manual-image/route';

function makePatch(body: object): Request {
  return new Request('http://localhost/api/admin/work-manual-image', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/admin/work-manual-image', () => {
  it('personName/workId が無ければ400', async () => {
    const res = await PATCH(makePatch({}) as never);
    expect(res.status).toBe(400);
  });

  it('不正なURL形式は400（保存もしない）', async () => {
    const res = await PATCH(makePatch({ personName: '人物A', workId: 'work-1', imageUrl: 'not-a-url' }) as never);
    expect(res.status).toBe(400);
    expect(mockSetManualImageUrl).not.toHaveBeenCalled();
  });

  it('作品が存在しなければ404', async () => {
    mockGetWork.mockResolvedValue(null);
    const res = await PATCH(makePatch({ personName: '人物A', workId: 'work-1', imageUrl: 'https://example.com/a.jpg' }) as never);
    expect(res.status).toBe(404);
  });

  it('有効なURLを保存し、/work/[workId]と/person/[personName]をrevalidateする', async () => {
    mockGetWork.mockResolvedValue({ id: 'work-1', personName: '人物A' });
    mockSetManualImageUrl.mockResolvedValue(true);
    const res = await PATCH(makePatch({ personName: '人物A', workId: 'work-1', imageUrl: 'https://example.com/a.jpg' }) as never);
    expect(res.status).toBe(200);
    expect(mockSetManualImageUrl).toHaveBeenCalledWith('人物A', 'work-1', 'https://example.com/a.jpg');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/work/work-1');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/person/%E4%BA%BA%E7%89%A9A');
  });

  it('imageUrlが空文字なら手動画像を解除する（nullで保存）', async () => {
    mockGetWork.mockResolvedValue({ id: 'work-1', personName: '人物A' });
    mockSetManualImageUrl.mockResolvedValue(true);
    const res = await PATCH(makePatch({ personName: '人物A', workId: 'work-1', imageUrl: '' }) as never);
    expect(res.status).toBe(200);
    expect(mockSetManualImageUrl).toHaveBeenCalledWith('人物A', 'work-1', null);
  });

  it('保存に失敗したら成功レスポンスを返さない', async () => {
    mockGetWork.mockResolvedValue({ id: 'work-1', personName: '人物A' });
    mockSetManualImageUrl.mockResolvedValue(false);
    const res = await PATCH(makePatch({ personName: '人物A', workId: 'work-1', imageUrl: 'https://example.com/a.jpg' }) as never);
    expect(res.status).toBe(500);
    const body = await res.json() as { ok?: boolean };
    expect(body.ok).not.toBe(true);
  });
});
