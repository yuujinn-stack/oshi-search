import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VodProvider } from '@/types/vod';

const mockGetWorksForImport = vi.hoisted(() => vi.fn());
const mockBatchUpdateVodData = vi.hoisted(() => vi.fn());
vi.mock('@/lib/work-store', () => ({ getWorksForImport: mockGetWorksForImport }));
vi.mock('@/db/write', () => ({ batchUpdateVodData: mockBatchUpdateVodData }));

import { POST } from '@/app/api/admin/csv-import/route';

const SOTA = 'SOTA';
const WORK = 'tmdb-movie-2be';
const PRIME_URL = 'https://www.primevideo.com/-/ja/detail/0FMB0185GE1LP306GC0IP0KWFA';
const CSV = [
  'workId,personId,vodService,availabilityType,confidence,sourceUrl,note',
  `${WORK},${SOTA},Prime Video,flatrate,high,${PRIME_URL},プライム会員特典対象。Prime Videoチャンネルでも配信`,
].join('\n');

let dbProviders: VodProvider[];
function dbMap() {
  return new Map([[`${SOTA}:${WORK}`, { id: WORK, personName: SOTA, title: '2:BE', vodData: { vodProviders: dbProviders } }]]);
}
const post = (body: object) =>
  POST(new Request('http://localhost/api/admin/csv-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never);

async function preview(syncMode = true) {
  const res = await post({ csvContent: CSV, commit: false, syncMode });
  expect(res.status).toBe(200);
  return res.json();
}
const approval = { rowNum: 2, workId: WORK, personName: SOTA, vodService: 'Prime Video', officialUrl: PRIME_URL, reason: 'Prime Video公式でプライム会員向けの視聴案内を確認' };

beforeEach(() => {
  vi.clearAllMocks();
  dbProviders = [{ providerId: 15, providerName: 'Hulu', type: 'flatrate', countryCode: 'JP', source: 'manual_csv' }];
  mockGetWorksForImport.mockImplementation(async () => dbMap());
  mockBatchUpdateVodData.mockResolvedValue(undefined);
});

describe('POST /api/admin/csv-import（保存時のサーバー側検証）', () => {
  it('承認つきで保存すると Prime Video が承認記録つきで保存され、同期削除も実行される', async () => {
    const p = await preview();
    expect(p.suspectedChannelCount).toBe(1);
    const res = await post({ csvContent: CSV, commit: true, syncMode: true, fingerprint: p.fingerprint, approvals: [approval] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ approvedProviderCount: 1, deletedProviderCount: 1, heldProviderCount: 0, suppressedDeleteCount: 0 });
    const [[works, tx]] = mockBatchUpdateVodData.mock.calls;
    expect(tx).toBe(true);
    const saved = works[0].vodData.vodProviders as VodProvider[];
    expect(saved.map((x) => x.providerName)).toEqual(['Prime Video']);
    expect(saved[0].manualApproval?.officialUrl).toBe(PRIME_URL);
  });

  it('承認なしで保存すると何も書き込まず、削除も見送る', async () => {
    const p = await preview();
    const res = await post({ csvContent: CSV, commit: true, syncMode: true, fingerprint: p.fingerprint });
    const body = await res.json();
    expect(body).toMatchObject({ heldProviderCount: 1, suppressedDeleteCount: 1, deletedProviderCount: 0 });
    expect(mockBatchUpdateVodData).not.toHaveBeenCalled();
  });

  it('fingerprint が無い・違う（プレビュー後にDBが変わった等）場合は 409 で保存しない', async () => {
    const p = await preview();
    expect((await post({ csvContent: CSV, commit: true, syncMode: true, approvals: [approval] })).status).toBe(409);
    dbProviders = [];
    expect((await post({ csvContent: CSV, commit: true, syncMode: true, fingerprint: p.fingerprint, approvals: [approval] })).status).toBe(409);
    expect(mockBatchUpdateVodData).not.toHaveBeenCalled();
  });

  it('モードをすり替えた保存（追加/更新でプレビュー → 同期で保存）は 409', async () => {
    const p = await preview(false);
    expect((await post({ csvContent: CSV, commit: true, syncMode: true, fingerprint: p.fingerprint })).status).toBe(409);
  });

  it('改ざんした承認（行内容不一致・理由なし）は 400 で保存しない', async () => {
    const p = await preview();
    for (const bad of [{ ...approval, personName: '別人物' }, { ...approval, reason: '' }, { ...approval, rowNum: 3 }]) {
      const res = await post({ csvContent: CSV, commit: true, syncMode: true, fingerprint: p.fingerprint, approvals: [bad] });
      expect(res.status).toBe(400);
    }
    expect(mockBatchUpdateVodData).not.toHaveBeenCalled();
  });

  it('旧形式（normalizedRows のみ・csvContent なし）での保存は受け付けない', async () => {
    const res = await post({ commit: true, normalizedRows: [{ action: 'add', workId: WORK, personName: SOTA, vodService: 'Prime Video' }] });
    expect(res.status).toBe(400);
    expect(mockBatchUpdateVodData).not.toHaveBeenCalled();
  });
});
