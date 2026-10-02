import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * 動画生成Worker（oshi-video-maker）専用APIの認証。
 * Authorization: Bearer {VIDEO_WORKER_SECRET}（CRON_SECRETとは別の値）。
 * /api/worker/* は proxy.ts のセッション認証の対象外のため、この関数が唯一のゲートになる。
 * 比較は長さの違いによる情報漏れも防ぐため、両方をSHA-256に揃えてから timingSafeEqual で行う。
 */
const MIN_SECRET_LENGTH = 32;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type WorkerAuthResult =
  | { ok: true; workerId: string }
  | { ok: false; status: number; error: string };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyWorkerRequest(req: NextRequest): WorkerAuthResult {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, status: 503, error: 'VIDEO_WORKER_SECRET が設定されていません' };
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) {
    return { ok: false, status: 401, error: '認証エラー' };
  }
  const workerId = req.headers.get('x-video-worker-id') ?? '';
  if (!WORKER_ID_PATTERN.test(workerId)) {
    return { ok: false, status: 400, error: '不正なWorker IDです' };
  }
  return { ok: true, workerId };
}
