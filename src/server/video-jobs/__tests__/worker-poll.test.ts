import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_POLL_ACTIVE_SECONDS,
  WORKER_POLL_IDLE_SECONDS,
  decideWorkerPollSeconds,
  pronunciationReadingsVersion,
  workerRequestSignal,
} from '@/lib/video-worker-poll';

// 動画Workerのジョブ確認（claim）の間隔・依頼の合図・管理画面の使用状況。DB・Redis には接続しない。
const state = vi.hoisted(() => ({
  executeRows: [] as Array<Record<string, unknown>>,
  executeError: null as Error | null,
  updated: [] as string[],
  redis: null as null | { store: Map<string, unknown>; fail: boolean },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  db: {
    execute: async () => {
      if (state.executeError) throw state.executeError;
      return { rows: state.executeRows };
    },
    update: () => ({
      set: () => ({
        where: async () => {
          state.updated.push('lastSeenAt');
        },
      }),
    }),
  },
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () =>
    state.redis && {
      set: async (k: string, v: unknown) => {
        if (state.redis!.fail) throw new Error('redis down');
        state.redis!.store.set(k, v);
      },
      get: async (k: string) => {
        if (state.redis!.fail) throw new Error('redis down');
        return state.redis!.store.get(k) ?? null;
      },
    },
}));

beforeEach(() => {
  state.executeRows = [];
  state.executeError = null;
  state.updated = [];
  state.redis = null;
  vi.resetModules();
});

describe('decideWorkerPollSeconds', () => {
  it('管理画面使用中・ジョブがある・今回取得した、のいずれかなら15秒、それ以外は60秒', () => {
    expect(decideWorkerPollSeconds({ claimed: false, hasActiveJobs: false, adminActive: false })).toBe(WORKER_POLL_IDLE_SECONDS);
    expect(decideWorkerPollSeconds({ claimed: false, hasActiveJobs: false, adminActive: true })).toBe(WORKER_POLL_ACTIVE_SECONDS);
    expect(decideWorkerPollSeconds({ claimed: false, hasActiveJobs: true, adminActive: false })).toBe(WORKER_POLL_ACTIVE_SECONDS);
    expect(decideWorkerPollSeconds({ claimed: true, hasActiveJobs: false, adminActive: false })).toBe(WORKER_POLL_ACTIVE_SECONDS);
    expect(WORKER_POLL_ACTIVE_SECONDS).toBe(15);
    expect(WORKER_POLL_IDLE_SECONDS).toBe(60);
  });
});

describe('workerRequestSignal', () => {
  const base = { capcutPrepareRequests: [], pendingScriptRequestCount: 0, pendingScriptRequestMaxId: null, readingsVersion: '0:0' };
  it('依頼の追加・処理・読みの登録で値が変わり、同じ状態なら同じ値（順序に依存しない）', () => {
    const a = workerRequestSignal(base);
    expect(workerRequestSignal({ ...base })).toBe(a);
    expect(workerRequestSignal({ ...base, pendingScriptRequestCount: 1, pendingScriptRequestMaxId: 9 })).not.toBe(a);
    expect(workerRequestSignal({ ...base, readingsVersion: '1730000000000:3' })).not.toBe(a);
    const p1 = { personName: 'A', requestedAt: '2026-10-31T00:00:00Z' };
    const p2 = { personName: 'B', requestedAt: '2026-10-31T00:01:00Z' };
    expect(workerRequestSignal({ ...base, capcutPrepareRequests: [p1, p2] })).toBe(workerRequestSignal({ ...base, capcutPrepareRequests: [p2, p1] }));
    expect(workerRequestSignal({ ...base, capcutPrepareRequests: [p1] })).not.toBe(a);
  });

  it('読みの版は listPronunciationReadings と同じ「最終更新ms:件数」', () => {
    expect(pronunciationReadingsVersion(1730000000123, 4)).toBe('1730000000123:4');
    expect(pronunciationReadingsVersion(null, 0)).toBe('0:0');
  });
});

describe('recordWorkerPoll', () => {
  it('1回の問い合わせ結果から、ジョブの有無・依頼の合図を返す', async () => {
    state.executeRows = [{
      capcut_prepare_requests: [{ personName: '岸優太', requestedAt: '2026-10-31T00:00:00Z' }],
      has_active_jobs: false,
      pending_script_count: '0',
      pending_script_max_id: null,
      readings_count: '3',
      readings_latest_ms: '1730000000123',
    }];
    const { recordWorkerPoll } = await import('../worker-poll');
    const r = await recordWorkerPoll('mac-1');
    expect(r.hasActiveJobs).toBe(false);
    expect(r.hasPendingRequests).toBe(true);
    expect(r.requestSignal).toMatch(/^[0-9a-f]{16}$/);
    // 同じ状態なら同じ合図
    expect((await recordWorkerPoll('mac-1')).requestSignal).toBe(r.requestSignal);
    // 読みが登録されると合図が変わる
    state.executeRows = [{ ...state.executeRows[0], readings_count: '4' }];
    expect((await recordWorkerPoll('mac-1')).requestSignal).not.toBe(r.requestSignal);
  });

  it('問い合わせに失敗しても claim を止めず、従来どおりの動き（15秒・生存報告を送る）になる値を返し、最終確認時刻は更新する', async () => {
    state.executeError = new Error('relation "video_script_requests" does not exist');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { recordWorkerPoll } = await import('../worker-poll');
    const r = await recordWorkerPoll('mac-1');
    expect(r.hasActiveJobs).toBe(true);
    expect(r.hasPendingRequests).toBe(true);
    expect(state.updated).toEqual(['lastSeenAt']);
  });
});

describe('管理画面の使用状況', () => {
  it('Redis が無い・失敗するときは使用中として扱う（待機中も15秒間隔のまま）', async () => {
    const mod = await import('../worker-poll');
    expect(await mod.isVideoAdminActive()).toBe(true);
    state.redis = { store: new Map(), fail: true };
    expect(await mod.isVideoAdminActive()).toBe(true);
  });

  it('管理画面の操作を記録すると使用中、記録が無ければ待機中', async () => {
    state.redis = { store: new Map(), fail: false };
    const mod = await import('../worker-poll');
    expect(await mod.isVideoAdminActive()).toBe(false);
    await mod.markVideoAdminActive();
    expect(await mod.isVideoAdminActive()).toBe(true);
  });
});

describe('POST /api/worker/video-jobs/claim', () => {
  async function callClaim(opts: { job: Record<string, unknown> | null; hasActiveJobs: boolean; adminActive: boolean }) {
    vi.doMock('@/server/video-jobs/job-store', () => ({
      claimNextVideoJob: async () => opts.job,
      VideoJobError: class extends Error {},
    }));
    vi.doMock('@/server/video-jobs/worker-poll', () => ({
      recordWorkerPoll: async () => ({ hasActiveJobs: opts.hasActiveJobs, requestSignal: 'sig', hasPendingRequests: false }),
      isVideoAdminActive: async () => opts.adminActive,
    }));
    vi.doMock('@/server/video-jobs/worker-auth', () => ({ verifyWorkerRequest: () => ({ ok: true, workerId: 'mac-1' }) }));
    const { POST } = await import('@/app/api/worker/video-jobs/claim/route');
    const res = await POST(new Request('http://localhost/api/worker/video-jobs/claim', { method: 'POST', body: '{}' }) as never);
    return res.json();
  }

  it('待機中（管理画面未使用・ジョブなし）は60秒、管理画面使用中は15秒を返す', async () => {
    expect(await callClaim({ job: null, hasActiveJobs: false, adminActive: false })).toEqual({
      pollSeconds: 60, requestSignal: 'sig', hasPendingRequests: false, job: null,
    });
    vi.resetModules();
    expect((await callClaim({ job: null, hasActiveJobs: false, adminActive: true })).pollSeconds).toBe(15);
  });

  it('ジョブを取得したら従来どおりのジョブ情報と15秒を返す', async () => {
    const body = await callClaim({
      job: { id: 'j1', personName: '岸優太', personSlug: 'kishi-yuta', templateId: 't', templateVersion: 1, narrationMode: 'none', attempts: 1, templateInput: null },
      hasActiveJobs: true,
      adminActive: false,
    });
    expect(body.pollSeconds).toBe(15);
    expect(body.job).toEqual({ id: 'j1', personName: '岸優太', personSlug: 'kishi-yuta', templateId: 't', templateVersion: 1, narrationMode: 'none', attempts: 1, templateInput: null });
  });
});
