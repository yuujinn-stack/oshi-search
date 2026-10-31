import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// claim の応答に templateInput を追加しても、既存の項目（personName / personSlug 等）は変わらないこと。
const state = vi.hoisted(() => ({ job: null as Record<string, unknown> | null }));

vi.mock('server-only', () => ({}));
// ジョブ確認の間隔・依頼の合図（DB・Redis には接続しない。内容は worker-poll.test.ts で確認）
vi.mock('@/server/video-jobs/worker-poll', () => ({
  recordWorkerPoll: async () => ({ hasActiveJobs: false, requestSignal: 'sig', hasPendingRequests: false }),
  isVideoAdminActive: async () => false,
}));
vi.mock('@/server/video-jobs/worker-auth', () => ({
  verifyWorkerRequest: () => ({ ok: true, workerId: 'test-worker' }),
}));
vi.mock('@/server/video-jobs/job-store', () => ({
  VideoJobError: class extends Error {},
  claimNextVideoJob: vi.fn(async () => state.job),
}));

const base = {
  id: '00000000-0000-0000-0000-000000000001',
  personName: '目黒蓮',
  personSlug: 'p-0123456789ab',
  templateVersion: 1,
  narrationMode: 'none',
  attempts: 1,
};

async function claim() {
  const { POST } = await import('../route');
  const res = await POST(new NextRequest('http://localhost/api/worker/video-jobs/claim', { method: 'POST', body: '{}' }));
  return (await res.json()).job;
}

beforeEach(() => {
  state.job = null;
});

describe('POST /api/worker/video-jobs/claim: templateInput', () => {
  it('従来のジョブ（template_input が NULL）は templateInput: null で、既存の項目はそのまま', async () => {
    state.job = { ...base, templateId: 'oshi-first3-v1', templateInput: null };
    const job = await claim();
    expect(job).toEqual({ ...base, templateId: 'oshi-first3-v1', templateInput: null });
  });

  it('migration前の行など templateInput の無いジョブも null として返す', async () => {
    state.job = { ...base, templateId: 'oshi-short-v1' };
    expect((await claim()).templateInput).toBeNull();
  });

  it('推しでサブスク比較のジョブは3人のslugを順番どおり渡す', async () => {
    const input = { version: 1, personSlugs: ['p-0123456789ab', 'p-111111111111', 'p-222222222222'] };
    state.job = { ...base, templateId: 'oshi-vod-compare-v1', templateInput: input };
    const job = await claim();
    expect(job.templateInput).toEqual(input);
    expect(job.personName).toBe('目黒蓮');
  });

  it('待機中のジョブが無ければ job: null', async () => {
    expect(await claim()).toBeNull();
  });
});
