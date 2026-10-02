import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { verifyWorkerRequest } from './worker-auth';
import { VideoJobError } from './job-store';

/**
 * /api/worker/* 共通の前処理（Bearer認証・JSON読み取り・エラー応答）。
 * Workerからの入力は信用せず、各ルートで型・長さを検証してからDBへ渡す。
 */
export async function handleWorkerRequest(
  req: NextRequest,
  handler: (ctx: { workerId: string; body: Record<string, unknown> }) => Promise<unknown>,
): Promise<NextResponse> {
  const auth = verifyWorkerRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const data = await handler({ workerId: auth.workerId, body });
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

export function str(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/;
export function parseJobId(id: string): string {
  if (!JOB_ID_PATTERN.test(id)) throw new VideoJobError('不正なジョブIDです。', 400);
  return id;
}
