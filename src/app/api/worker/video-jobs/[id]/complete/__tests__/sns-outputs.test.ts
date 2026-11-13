import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 完了報告の SNS別の完成動画（result.snsOutputs）: Blob を確認できたものだけ URL を保存し、片方の失敗でも完了にする。
// アップロード許可（kind=sns）は final.mp4 のパスを変えない。
const JOB = '00000000-0000-0000-0000-0000000000aa';
const state = vi.hoisted(() => ({
  completed: null as Record<string, unknown> | null,
  assigned: [] as string[],
  blobs: {} as Record<string, { pathname: string; contentType: string; size: number; url: string }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/video-jobs/worker-auth', () => ({ verifyWorkerRequest: () => ({ ok: true, workerId: 'w1' }) }));
vi.mock('@vercel/blob', () => ({
  head: async (url: string) => {
    const b = state.blobs[url];
    if (!b) throw new Error('not found');
    return b;
  },
}));
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: async () => 'token' }));
vi.mock('@/server/video-jobs/job-store', () => ({
  VideoJobError: class VideoJobError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  getOwnedProcessingJob: async () => ({ id: JOB, videoPathname: `video-jobs/${JOB}/final-0123456789abcdef.mp4` }),
  completeVideoJob: async (_id: string, _w: string, data: Record<string, unknown>) => {
    state.completed = data;
  },
  assignVideoPathname: async (_id: string, _w: string, p: string) => {
    state.assigned.push(p);
  },
}));

const FINAL = 'https://blob.test/final.mp4';
const TIKTOK = 'https://blob.test/tiktok.mp4';

beforeEach(() => {
  state.completed = null;
  state.assigned = [];
  state.blobs = {
    [FINAL]: { pathname: `video-jobs/${JOB}/final-0123456789abcdef.mp4`, contentType: 'video/mp4', size: 10, url: FINAL },
    [TIKTOK]: { pathname: `video-jobs/${JOB}/sns-tiktok-0123456789abcdef.mp4`, contentType: 'video/mp4', size: 9, url: TIKTOK },
  };
});

async function complete(body: Record<string, unknown>) {
  const { POST } = await import('../route');
  const res = await POST(new NextRequest(`http://localhost/api/worker/video-jobs/${JOB}/complete`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: JOB }),
  });
  return { status: res.status, json: await res.json() };
}

describe('POST complete: snsOutputs', () => {
  it('Instagram（final.mp4 と同じ）はジョブの動画URL、TikTok は確認した Blob の URL を保存する', async () => {
    const res = await complete({
      videoUrl: FINAL,
      result: { templateId: 't' },
      snsOutputs: {
        version: 1,
        targets: ['instagram', 'tiktok'],
        results: {
          instagram: { status: 'PASS', ctaMode: 'template', sameAsFinal: true, srt: '1\n00:00:00,000 --> 00:00:01,000\nA\n' },
          tiktok: { status: 'PASS', ctaMode: 'search', sameAsFinal: false, url: TIKTOK, ctaStartSec: 14.6, ctaDurationSec: 2.8, ctaAudio: 'capcut', ctaAudioKey: '59d1c4bc', narration: '気になったら、推しサーチで検索！' },
        },
      },
    });
    expect(res.status).toBe(200);
    const result = state.completed!.result as { templateId: string; snsOutputs: { results: Record<string, Record<string, unknown>> } };
    expect(result.templateId).toBe('t');
    expect(result.snsOutputs.results.instagram).toMatchObject({ status: 'PASS', url: FINAL, sameAsFinal: true });
    expect(result.snsOutputs.results.tiktok).toMatchObject({ status: 'PASS', url: TIKTOK, ctaAudioKey: '59d1c4bc', ctaStartSec: 14.6 });
  });

  it('TikTok の Blob を確認できない・失敗の報告でも、ジョブは完了にして Instagram 版を使える', async () => {
    const res = await complete({
      videoUrl: FINAL,
      snsOutputs: {
        version: 1,
        targets: ['instagram', 'tiktok'],
        results: {
          instagram: { status: 'PASS', ctaMode: 'template', sameAsFinal: true },
          tiktok: { status: 'PASS', ctaMode: 'search', sameAsFinal: false, url: 'https://blob.test/other.mp4' },
        },
      },
    });
    expect(res.status).toBe(200);
    const sns = (state.completed!.result as { snsOutputs: { results: Record<string, Record<string, unknown>> } }).snsOutputs;
    expect(sns.results.instagram.status).toBe('PASS');
    expect(sns.results.tiktok).toMatchObject({ status: 'FAIL', url: null });
  });

  it('snsOutputs の無い従来の完了報告は result をそのまま保存する', async () => {
    await complete({ videoUrl: FINAL, result: { templateId: 't' } });
    expect(state.completed!.result).toEqual({ templateId: 't' });
  });
});

describe('POST upload-token: kind=sns', () => {
  async function token(body: Record<string, unknown>) {
    const { POST } = await import('../../upload-token/route');
    const res = await POST(new NextRequest(`http://localhost/api/worker/video-jobs/${JOB}/upload-token`, { method: 'POST', body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: JOB }),
    });
    return { status: res.status, json: await res.json() };
  }

  it('SNS別のパスを発行し、final.mp4 のパスは変えない', async () => {
    const res = await token({ fileSizeBytes: 1000, kind: 'sns', sns: 'tiktok' });
    expect(res.status).toBe(200);
    expect(res.json.pathname).toMatch(new RegExp(`^video-jobs/${JOB}/sns-tiktok-[0-9a-f]{16}\\.mp4$`));
    expect(state.assigned).toEqual([]);
  });

  it('SNS の指定が無い・不正なら 400', async () => {
    expect((await token({ fileSizeBytes: 1000, kind: 'sns' })).status).toBe(400);
    expect((await token({ fileSizeBytes: 1000, kind: 'sns', sns: 'youtube' })).status).toBe(400);
  });
});
