import { beforeEach, describe, expect, it, vi } from 'vitest';

// PATCH /api/admin/groups（トップページ「グループで探す」の分類だけを保存）と、POST が分類を変更しないこと。
// 管理者認証は src/proxy.ts（/api/admin/* はセッション必須・書き込みは Origin チェック）で行う。
const mocks = vi.hoisted(() => ({
  saveGroupHomeCategory: vi.fn(),
  saveGroupMeta: vi.fn(),
  getAllGroupMetas: vi.fn(async () => []),
  deleteGroupMeta: vi.fn(),
}));
vi.mock('@/lib/group-meta', () => mocks);

import { PATCH, POST } from '../route';

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/admin/groups', { method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  mocks.saveGroupHomeCategory.mockReset().mockResolvedValue(true);
  mocks.saveGroupMeta.mockReset().mockResolvedValue(undefined);
});

describe('PATCH /api/admin/groups', () => {
  it('3つの分類のどれかを保存する', async () => {
    const res = await PATCH(req('PATCH', { groupName: ' 超特急 ', homeCategory: 'maleIdol' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, groupName: '超特急', homeCategory: 'maleIdol' });
    expect(mocks.saveGroupHomeCategory).toHaveBeenCalledWith('超特急', 'maleIdol');
  });

  it('不正な分類・グループ名なし・不正なJSONは 400（保存しない）', async () => {
    for (const body of [{ groupName: '超特急', homeCategory: 'band' }, { groupName: '超特急' }, { groupName: '', homeCategory: 'other' }, '{']) {
      const res = await PATCH(req('PATCH', body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(mocks.saveGroupHomeCategory).not.toHaveBeenCalled();
  });

  it('グループが無ければ 404、DB エラーは 500（画面に失敗を表示できるよう error を返す）', async () => {
    mocks.saveGroupHomeCategory.mockResolvedValueOnce(false);
    const notFound = await PATCH(req('PATCH', { groupName: '無い', homeCategory: 'other' }));
    expect(notFound.status).toBe(404);
    mocks.saveGroupHomeCategory.mockRejectedValueOnce(new Error('db down'));
    const failed = await PATCH(req('PATCH', { groupName: '超特急', homeCategory: 'other' }));
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toContain('保存に失敗しました');
  });
});

describe('POST /api/admin/groups（グループ編集フォーム）', () => {
  it('送られてきた homeCategory は保存に渡さない（分類は PATCH だけで変更）', async () => {
    const res = await POST(req('POST', { groupName: '超特急', slug: '', activityStatus: 'active', homeCategory: 'other' }));
    expect(res.status).toBe(200);
    expect(mocks.saveGroupMeta).toHaveBeenCalledTimes(1);
    expect(mocks.saveGroupMeta.mock.calls[0][0]).not.toHaveProperty('homeCategory');
  });
});
