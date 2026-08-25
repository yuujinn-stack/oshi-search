import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPersonGenderRows = vi.hoisted(() => vi.fn());
const mockGetGroupGenderRows = vi.hoisted(() => vi.fn());
const mockBulkSetPersonGender = vi.hoisted(() => vi.fn());
const mockBulkSetGroupGender = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockRevalidateTag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/photobook-store', () => ({
  getPersonGenderRows: mockGetPersonGenderRows,
  getGroupGenderRows: mockGetGroupGenderRows,
}));
vi.mock('@/lib/photobook-gender-write', () => ({
  bulkSetPersonGender: mockBulkSetPersonGender,
  bulkSetGroupGender: mockBulkSetGroupGender,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidateTag,
}));

import { POST as postPersons } from '@/app/api/admin/photobooks/gender/persons/route';
import { POST as postGroups } from '@/app/api/admin/photobooks/gender/groups/route';

function makePost(url: string, body: object): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/photobooks/gender/persons', () => {
  it('保存後に写真集ホーム/一覧のキャッシュを無効化する（写真集一覧への反映のため）', async () => {
    mockBulkSetPersonGender.mockResolvedValue({ updated: 2 });
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', {
        personNames: ['人物A', '人物B'],
        gender: 'female',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; updated: number };
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(2);
    expect(mockBulkSetPersonGender).toHaveBeenCalledWith(['人物A', '人物B'], 'female');
    expect(mockRevalidateTag).toHaveBeenCalledWith('photobook-home', { expire: 0 });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/photobooks');
  });

  it('personNamesが空配列なら400（保存もしない）', async () => {
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', { personNames: [], gender: 'male' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetPersonGender).not.toHaveBeenCalled();
  });

  it('genderが不正な値なら400（保存もしない）', async () => {
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', { personNames: ['人物A'], gender: 'unknown' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetPersonGender).not.toHaveBeenCalled();
  });

  it('personNamesに文字列以外の要素が含まれる場合は400（型不正な値をDBに渡さない）', async () => {
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', { personNames: ['人物A', 123, {}], gender: 'female' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetPersonGender).not.toHaveBeenCalled();
  });

  it('personNamesが上限件数を超える場合は400（異常に大量な値を拒否する）', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `人物${i}`);
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', { personNames: tooMany, gender: 'female' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetPersonGender).not.toHaveBeenCalled();
  });

  it('personNamesが配列でない場合は400', async () => {
    const res = await postPersons(
      makePost('http://localhost/api/admin/photobooks/gender/persons', { personNames: '人物A', gender: 'female' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetPersonGender).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/photobooks/gender/groups', () => {
  it('保存後に写真集ホーム/一覧のキャッシュを無効化する', async () => {
    mockBulkSetGroupGender.mockResolvedValue({ updated: 1 });
    const res = await postGroups(
      makePost('http://localhost/api/admin/photobooks/gender/groups', {
        groupNames: ['日向坂46'],
        gender: 'female',
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockBulkSetGroupGender).toHaveBeenCalledWith(['日向坂46'], 'female');
    expect(mockRevalidateTag).toHaveBeenCalledWith('photobook-home', { expire: 0 });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/photobooks');
  });

  it('groupNamesが無ければ400', async () => {
    const res = await postGroups(
      makePost('http://localhost/api/admin/photobooks/gender/groups', { gender: 'male' }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockBulkSetGroupGender).not.toHaveBeenCalled();
  });
});
