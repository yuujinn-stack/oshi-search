// アフィリエイト案件 API の vodService 正規化に関する回帰テスト。
//
// 背景: 管理画面から vodService に "Hulu"（大文字始まり）が保存されたため、
// 公開ページ側の normalizeProviderName(p.providerName)（= "hulu"）と文字列が
// 完全一致せず、resolveAffiliateSlot() が案件を見つけられずフォールバックUIに
// なる不具合が発生した。保存時にも normalizeProviderName() を適用することで
// 表記ゆれによる不一致を防ぐ。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateAffiliateProgram = vi.hoisted(() => vi.fn());
const mockGetAllAffiliateProgramsOrThrow = vi.hoisted(() => vi.fn());
const mockGetAffiliateProgramById = vi.hoisted(() => vi.fn());
const mockUpdateAffiliateProgram = vi.hoisted(() => vi.fn());
const mockDeleteAffiliateProgram = vi.hoisted(() => vi.fn());
const mockRevalidateAffiliateVodService = vi.hoisted(() => vi.fn());

vi.mock('@/lib/affiliate-store', () => ({
  getAllAffiliateProgramsOrThrow: mockGetAllAffiliateProgramsOrThrow,
  createAffiliateProgram: mockCreateAffiliateProgram,
  getAffiliateProgramById: mockGetAffiliateProgramById,
  updateAffiliateProgram: mockUpdateAffiliateProgram,
  deleteAffiliateProgram: mockDeleteAffiliateProgram,
}));
vi.mock('@/lib/affiliate-revalidate', () => ({
  revalidateAffiliateVodService: mockRevalidateAffiliateVodService,
}));

import { POST } from '@/app/api/admin/affiliates/route';
import { PUT } from '@/app/api/admin/affiliates/[id]/route';
import { normalizeProviderName } from '@/lib/vod-dedup';

function makeRequest(method: string, url: string, body: object): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseProgram = {
  id: 1,
  vodService: 'hulu',
  aspName: 'アクセストレード',
  programName: 'Hulu',
  status: 'active' as const,
  rulesNote: null,
  directUrlAllowed: true,
  customCreativeAllowed: true,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/affiliates — vodServiceの正規化', () => {
  it('「Hulu」を送信すると normalizeProviderName() で正規化された「hulu」として保存される', async () => {
    mockCreateAffiliateProgram.mockImplementation(async (input) => ({ ...baseProgram, ...input, id: 1 }));

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/admin/affiliates', {
        vodService: 'Hulu',
        aspName: 'アクセストレード',
        programName: 'Hulu',
      }) as never,
    );

    expect(res.status).toBe(201);
    expect(mockCreateAffiliateProgram).toHaveBeenCalledTimes(1);
    const savedInput = mockCreateAffiliateProgram.mock.calls[0][0];
    expect(savedInput.vodService).toBe('hulu');
    expect(savedInput.vodService).toBe(normalizeProviderName('Hulu'));
  });

  it('「Lemino」を送信すると「lemino」として保存される', async () => {
    mockCreateAffiliateProgram.mockImplementation(async (input) => ({ ...baseProgram, ...input, id: 2 }));

    await POST(
      makeRequest('POST', 'http://localhost/api/admin/affiliates', {
        vodService: 'Lemino',
        aspName: 'バリューコマース',
        programName: 'Lemino',
      }) as never,
    );

    const savedInput = mockCreateAffiliateProgram.mock.calls[0][0];
    expect(savedInput.vodService).toBe('lemino');
  });

  it('「U-NEXT」を送信すると既存の normalizeProviderName ルールに従い「unext」として保存される', async () => {
    mockCreateAffiliateProgram.mockImplementation(async (input) => ({ ...baseProgram, ...input, id: 3 }));

    await POST(
      makeRequest('POST', 'http://localhost/api/admin/affiliates', {
        vodService: 'U-NEXT',
        aspName: 'A8.net',
        programName: 'U-NEXT',
      }) as never,
    );

    const savedInput = mockCreateAffiliateProgram.mock.calls[0][0];
    expect(savedInput.vodService).toBe('unext');
  });

  it('前後に空白を含む「 hulu 」も正規化されて保存される（trim + 正規化の順序確認）', async () => {
    mockCreateAffiliateProgram.mockImplementation(async (input) => ({ ...baseProgram, ...input, id: 4 }));

    await POST(
      makeRequest('POST', 'http://localhost/api/admin/affiliates', {
        vodService: '  Hulu  ',
        aspName: 'ASP',
        programName: '案件',
      }) as never,
    );

    const savedInput = mockCreateAffiliateProgram.mock.calls[0][0];
    expect(savedInput.vodService).toBe('hulu');
  });

  it('vodServiceが空文字なら400を返し、保存処理を呼ばない', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/admin/affiliates', {
        vodService: '',
        aspName: 'ASP',
        programName: '案件',
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockCreateAffiliateProgram).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/affiliates/[id] — vodServiceの正規化', () => {
  it('既存案件の vodService を「Hulu」に更新しても「hulu」として保存される', async () => {
    mockGetAffiliateProgramById.mockResolvedValue({ ...baseProgram, vodService: 'hulu' });
    mockUpdateAffiliateProgram.mockImplementation(async (_id, input) => ({ ...baseProgram, ...input }));

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/admin/affiliates/1', {
        vodService: 'Hulu',
      }) as never,
      { params: Promise.resolve({ id: '1' }) },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateAffiliateProgram).toHaveBeenCalledTimes(1);
    const [, savedInput] = mockUpdateAffiliateProgram.mock.calls[0];
    expect(savedInput.vodService).toBe('hulu');
  });

  it('vodServiceを指定しない更新では既存値（正規化済み）がそのまま維持される', async () => {
    mockGetAffiliateProgramById.mockResolvedValue({ ...baseProgram, vodService: 'lemino' });
    mockUpdateAffiliateProgram.mockImplementation(async (_id, input) => ({ ...baseProgram, ...input }));

    await PUT(
      makeRequest('PUT', 'http://localhost/api/admin/affiliates/1', {
        aspName: '新しいASP名',
      }) as never,
      { params: Promise.resolve({ id: '1' }) },
    );

    const [, savedInput] = mockUpdateAffiliateProgram.mock.calls[0];
    expect(savedInput.vodService).toBe('lemino');
  });
});
