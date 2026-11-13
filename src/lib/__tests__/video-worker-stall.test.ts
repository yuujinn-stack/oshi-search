import { describe, expect, it } from 'vitest';
import { detectWorkerStall, VIDEO_QUEUED_STALL_MS } from '../video-worker-stall';

const now = Date.parse('2026-11-04T13:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('detectWorkerStall', () => {
  it('待機中のジョブがなければ警告しない', () => {
    expect(detectWorkerStall(true, [{ status: 'completed', createdAt: ago(3600_000) }], now)).toBeNull();
    expect(detectWorkerStall(false, [], now)).toBeNull();
  });

  it('作成直後の待機中ジョブは警告しない', () => {
    expect(detectWorkerStall(true, [{ status: 'queued', createdAt: ago(VIDEO_QUEUED_STALL_MS - 1000) }], now)).toBeNull();
  });

  it('生成中のジョブがあれば、待機中が古くても警告しない', () => {
    expect(
      detectWorkerStall(true, [
        { status: 'queued', createdAt: ago(3600_000) },
        { status: 'processing', createdAt: ago(3700_000) },
      ], now),
    ).toBeNull();
  });

  it('オンラインなのに待機中のジョブが一定時間取得されなければ not_claiming（最古のジョブ基準）', () => {
    const stall = detectWorkerStall(true, [
      { status: 'queued', createdAt: ago(60_000) },
      { status: 'queued', createdAt: ago(10 * 3600_000) },
    ], now);
    expect(stall).toEqual({ kind: 'not_claiming', queuedCount: 2, oldestQueuedAt: ago(10 * 3600_000), waitedMs: 10 * 3600_000 });
  });

  it('Workerがオフライン・未接続で待機中のジョブがあれば offline', () => {
    expect(detectWorkerStall(false, [{ status: 'queued', createdAt: ago(1000) }], now)?.kind).toBe('offline');
    expect(detectWorkerStall(null, [{ status: 'queued', createdAt: ago(1000) }], now)?.kind).toBe('offline');
  });
});
