import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrepareInvestigationTargets = vi.hoisted(() => vi.fn());
const mockCreateInvestigationJob = vi.hoisted(() => vi.fn());
const mockGetInvestigationJob = vi.hoisted(() => vi.fn());
const mockSetJobStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRetryFailedItems = vi.hoisted(() => vi.fn());
const mockSetItemDecision = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockListRecentInvestigationJobs = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockGetVodResearchStats = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockProcessInvestigationBatch = vi.hoisted(() => vi.fn());
const mockRunVodRecheckCsvImport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/vod-investigation-store', () => ({
  prepareInvestigationTargets: mockPrepareInvestigationTargets,
  createInvestigationJob: mockCreateInvestigationJob,
  getInvestigationJob: mockGetInvestigationJob,
  setJobStatus: mockSetJobStatus,
  retryFailedItems: mockRetryFailedItems,
  setItemDecision: mockSetItemDecision,
  listRecentInvestigationJobs: mockListRecentInvestigationJobs,
}));
vi.mock('@/lib/openai-usage', () => ({
  getVodResearchStats: mockGetVodResearchStats,
}));
vi.mock('@/lib/vod-investigation-runner', () => ({
  processInvestigationBatch: mockProcessInvestigationBatch,
}));
vi.mock('@/lib/vod-recheck-csv-import', () => ({
  runVodRecheckCsvImport: mockRunVodRecheckCsvImport,
}));

import { POST as estimatePost } from '@/app/api/admin/vod-recheck/investigation-jobs/estimate/route';
import { POST as createPost } from '@/app/api/admin/vod-recheck/investigation-jobs/route';
import { PATCH as jobPatch } from '@/app/api/admin/vod-recheck/investigation-jobs/[jobId]/route';
import { POST as processPost } from '@/app/api/admin/vod-recheck/investigation-jobs/[jobId]/process/route';
import { POST as decisionPost } from '@/app/api/admin/vod-recheck/investigation-jobs/[jobId]/items/[itemId]/decision/route';
import { POST as applyPreviewPost } from '@/app/api/admin/vod-recheck/investigation-jobs/[jobId]/apply-preview/route';
import { POST as applyPost } from '@/app/api/admin/vod-recheck/investigation-jobs/[jobId]/apply/route';
import { MAX_INVESTIGATION_ITEMS } from '../vod-investigation';

function makePost(body: object): Request {
  return new Request('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function targetsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    workId: `work-${i}`, personName: '人物A', title: `タイトル${i}`, workType: 'movie', releaseYear: 2020, currentProviders: [],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetVodResearchStats.mockResolvedValue(null);
});

const TARGET_CSV = 'workId\nwork-1\nwork-2';

describe('POST /investigation-jobs/estimate', () => {
  it(`対象が上限(${MAX_INVESTIGATION_ITEMS})を超えると400`, async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: targetsOf(MAX_INVESTIGATION_ITEMS + 1), unresolvedWorkIds: [] });
    const res = await estimatePost(makePost({ csv: TARGET_CSV }) as never);
    expect(res.status).toBe(400);
  });

  it('見積もりのみでDB書き込み系関数は一切呼ばれない（調査対象CSVアップロードだけではDBが変わらない）', async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: targetsOf(3), unresolvedWorkIds: [] });
    const res = await estimatePost(makePost({ csv: TARGET_CSV }) as never);
    expect(res.status).toBe(200);
    expect(mockCreateInvestigationJob).not.toHaveBeenCalled();
    const body = await res.json() as { estimate: { targetCount: number } };
    expect(body.estimate.targetCount).toBe(3);
  });

  it('実績データが無い場合は保守的な既定値でコストを見積もる（usedFallbackCost: true）', async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: targetsOf(2), unresolvedWorkIds: [] });
    const res = await estimatePost(makePost({ csv: TARGET_CSV }) as never);
    const body = await res.json() as { usedFallbackCost: boolean };
    expect(body.usedFallbackCost).toBe(true);
  });
});

describe('POST /investigation-jobs（ジョブ作成）', () => {
  it(`対象が上限(${MAX_INVESTIGATION_ITEMS})を超えると400・ジョブは作成されない`, async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: targetsOf(MAX_INVESTIGATION_ITEMS + 1), unresolvedWorkIds: [] });
    const res = await createPost(makePost({ csv: TARGET_CSV }) as never);
    expect(res.status).toBe(400);
    expect(mockCreateInvestigationJob).not.toHaveBeenCalled();
  });

  it('対象0件なら400', async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: [], unresolvedWorkIds: ['ghost'] });
    const res = await createPost(makePost({ csv: TARGET_CSV }) as never);
    expect(res.status).toBe(400);
  });

  it('上限以内ならジョブを作成しjobIdを返す', async () => {
    mockPrepareInvestigationTargets.mockResolvedValue({ targets: targetsOf(5), unresolvedWorkIds: [] });
    mockCreateInvestigationJob.mockResolvedValue('job-abc');
    const res = await createPost(makePost({ csv: TARGET_CSV }) as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string; targetCount: number };
    expect(body.jobId).toBe('job-abc');
    expect(body.targetCount).toBe(5);
  });
});

describe('PATCH /investigation-jobs/[jobId]（stop/resume/retry_failed）', () => {
  const params = Promise.resolve({ jobId: 'job-1' });

  it('存在しないジョブは404', async () => {
    mockGetInvestigationJob.mockResolvedValue(null);
    const res = await jobPatch(makePost({ action: 'stop' }) as never, { params });
    expect(res.status).toBe(404);
  });

  it('既にapplied（反映済み）のジョブは409で操作を拒否する', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'applied' }, items: [] });
    const res = await jobPatch(makePost({ action: 'stop' }) as never, { params });
    expect(res.status).toBe(409);
  });

  it('stopでpausedへ更新する', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'running' }, items: [] });
    const res = await jobPatch(makePost({ action: 'stop' }) as never, { params });
    expect(res.status).toBe(200);
    expect(mockSetJobStatus).toHaveBeenCalledWith('job-1', 'paused');
  });

  it('retry_failedで失敗件数を再試行しrunningへ戻す', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'completed' }, items: [] });
    mockRetryFailedItems.mockResolvedValue(2);
    const res = await jobPatch(makePost({ action: 'retry_failed' }) as never, { params });
    expect(res.status).toBe(200);
    expect(mockSetJobStatus).toHaveBeenCalledWith('job-1', 'running');
  });
});

describe('POST /investigation-jobs/[jobId]/process', () => {
  const params = Promise.resolve({ jobId: 'job-1' });

  it('paused中のジョブは処理を拒否する（409）', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'paused' }, items: [] });
    const res = await processPost(new Request('http://localhost/x', { method: 'POST' }) as never, { params });
    expect(res.status).toBe(409);
    expect(mockProcessInvestigationBatch).not.toHaveBeenCalled();
  });

  it('applied済みのジョブは処理を拒否する（409）', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'applied' }, items: [] });
    const res = await processPost(new Request('http://localhost/x', { method: 'POST' }) as never, { params });
    expect(res.status).toBe(409);
  });

  it('pending/investigatingが無くなったらcompletedへ遷移する', async () => {
    mockGetInvestigationJob
      .mockResolvedValueOnce({ job: { status: 'running' }, items: [] })
      .mockResolvedValueOnce({ job: { status: 'running' }, items: [{ status: 'approved' }, { status: 'rejected' }] });
    mockProcessInvestigationBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, requeuedForRetry: 0 });
    const res = await processPost(new Request('http://localhost/x', { method: 'POST' }) as never, { params });
    expect(res.status).toBe(200);
    expect(mockSetJobStatus).toHaveBeenCalledWith('job-1', 'completed');
  });
});

describe('POST /investigation-jobs/[jobId]/items/[itemId]/decision', () => {
  const params = Promise.resolve({ jobId: 'job-1', itemId: '10' });

  it('公式URLの無い候補をapprovedにしようとすると400（自動承認の安全弁）', async () => {
    mockGetInvestigationJob.mockResolvedValue({
      job: { status: 'running' },
      items: [{ id: 10, candidateProviders: [{ providerName: 'Netflix', type: 'flatrate' }] }],
    });
    const res = await decisionPost(makePost({ decision: 'approved' }) as never, { params });
    expect(res.status).toBe(400);
    expect(mockSetItemDecision).not.toHaveBeenCalled();
  });

  it('sourceUrlがある候補はapproved可能', async () => {
    mockGetInvestigationJob.mockResolvedValue({
      job: { status: 'running' },
      items: [{ id: 10, candidateProviders: [{ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' }] }],
    });
    const res = await decisionPost(makePost({ decision: 'approved' }) as never, { params });
    expect(res.status).toBe(200);
    expect(mockSetItemDecision).toHaveBeenCalled();
  });

  it('manualはmanualProvidersが無いと400', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'running' }, items: [{ id: 10, candidateProviders: [] }] });
    const res = await decisionPost(makePost({ decision: 'manual' }) as never, { params });
    expect(res.status).toBe(400);
  });

  it('applied済みジョブへの判断変更は409', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'applied' }, items: [{ id: 10 }] });
    const res = await decisionPost(makePost({ decision: 'rejected' }) as never, { params });
    expect(res.status).toBe(409);
  });
});

describe('POST /investigation-jobs/[jobId]/apply-preview・apply（二重反映防止・一括反映ゲート）', () => {
  const params = Promise.resolve({ jobId: 'job-1' });

  it('1件でも未確認（pending/needs_review）があれば apply-preview は400', async () => {
    mockGetInvestigationJob.mockResolvedValue({
      job: { status: 'completed' },
      items: [
        { workId: 'w1', decision: 'approved', status: 'approved', candidateProviders: [] },
        { workId: 'w2', decision: 'needs_review', status: 'pending' },
      ],
    });
    const res = await applyPreviewPost(new Request('http://localhost/x', { method: 'POST' }) as never, { params });
    expect(res.status).toBe(400);
    expect(mockRunVodRecheckCsvImport).not.toHaveBeenCalled();
  });

  it('既にapplied（反映済み）のジョブへのapplyは409（二重反映防止）', async () => {
    mockGetInvestigationJob.mockResolvedValue({ job: { status: 'applied' }, items: [{ decision: 'approved', status: 'approved' }] });
    const res = await applyPost(makePost({}) as never, { params });
    expect(res.status).toBe(409);
    expect(mockRunVodRecheckCsvImport).not.toHaveBeenCalled();
  });

  it('全件確定済みならapply-previewはmergeStrategy=syncで既存CSV反映ロジックを呼ぶ', async () => {
    mockGetInvestigationJob.mockResolvedValue({
      job: { status: 'completed' },
      items: [{ workId: 'w1', decision: 'approved', status: 'approved', candidateProviders: [{ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' }] }],
    });
    mockRunVodRecheckCsvImport.mockResolvedValue({ status: 200, body: { commit: false, preview: [] } });
    const res = await applyPreviewPost(new Request('http://localhost/x', { method: 'POST' }) as never, { params });
    expect(res.status).toBe(200);
    expect(mockRunVodRecheckCsvImport).toHaveBeenCalledWith(expect.any(String), false, { mergeStrategy: 'sync' });
  });

  it('apply成功後はジョブをappliedにする（次回の二重反映を防ぐ）', async () => {
    mockGetInvestigationJob.mockResolvedValue({
      job: { status: 'completed' },
      items: [{ workId: 'w1', decision: 'approved', status: 'approved', candidateProviders: [{ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' }] }],
    });
    mockRunVodRecheckCsvImport.mockResolvedValue({ status: 200, body: { commit: true, updatedWorks: 1, unresolvedWorkIds: [], errors: [] } });
    const res = await applyPost(makePost({}) as never, { params });
    expect(res.status).toBe(200);
    expect(mockRunVodRecheckCsvImport).toHaveBeenCalledWith(expect.any(String), true, expect.objectContaining({ mergeStrategy: 'sync' }));
    expect(mockSetJobStatus).toHaveBeenCalledWith('job-1', 'applied');
  });
});
