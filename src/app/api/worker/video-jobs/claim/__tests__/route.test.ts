import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Workerは受け取ったpersonSlugを人物名から計算し直して検証する。応答から落ちると
// PERSON_REGISTRY未登録人物（推しサーチDBの人物）がすべて「人物の対応付け」で失敗する。
vi.mock('server-only', () => ({}));
vi.mock('@/server/video-jobs/worker-auth', () => ({
  verifyWorkerRequest: () => ({ ok: true, workerId: 'test-worker' }),
}));
vi.mock('@/server/video-jobs/job-store', () => ({
  VideoJobError: class extends Error {},
  claimNextVideoJob: vi.fn(async () => ({
    id: '00000000-0000-0000-0000-000000000001',
    personName: '森本慎太郎',
    personSlug: 'p-3a6837bdcc7a',
    templateId: 'oshi-first3-v1',
    templateVersion: 1,
    narrationMode: 'capcut',
    attempts: 1,
  })),
}));

describe('POST /api/worker/video-jobs/claim', () => {
  it('ジョブ作成時に保存した人物slugをWorkerへ渡す', async () => {
    const { POST } = await import('../route');
    const res = await POST(new NextRequest('http://localhost/api/worker/video-jobs/claim', { method: 'POST', body: '{}' }));
    const data = await res.json();
    expect(data.job.personName).toBe('森本慎太郎');
    expect(data.job.personSlug).toBe('p-3a6837bdcc7a');
  });
});
