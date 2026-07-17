import { NextRequest, NextResponse } from 'next/server';
import {
  getBatchLockStatus,
  acquireBatchLock,
  renewBatchLock,
  releaseBatchLock,
} from '@/lib/batch-lock';

// GET /api/admin/batch-lock
// 現在のロック状態を返す（UI表示用）
export async function GET() {
  const status = await getBatchLockStatus();
  return NextResponse.json(status);
}

// POST /api/admin/batch-lock
// body: { action: 'acquire' | 'heartbeat' | 'release', ownerId: string, status?: 'completed' | 'failed' }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    action?: 'acquire' | 'heartbeat' | 'release';
    ownerId?: string;
    status?: 'completed' | 'failed';
  };

  if (!body.ownerId) {
    return NextResponse.json({ ok: false, error: 'ownerId が必要です' }, { status: 400 });
  }

  switch (body.action) {
    case 'acquire': {
      const acquired = await acquireBatchLock(body.ownerId);
      if (!acquired) {
        const current = await getBatchLockStatus();
        return NextResponse.json(
          { ok: false, error: '別の一括実行が進行中です', current },
          { status: 409 },
        );
      }
      console.log(`[batch-lock] acquired ownerId:${body.ownerId}`);
      return NextResponse.json({ ok: true });
    }

    case 'heartbeat': {
      const renewed = await renewBatchLock(body.ownerId);
      return NextResponse.json({ ok: renewed });
    }

    case 'release': {
      const releaseStatus = body.status ?? 'completed';
      await releaseBatchLock(body.ownerId, releaseStatus);
      console.log(`[batch-lock] released ownerId:${body.ownerId} status:${releaseStatus}`);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: false, error: '不明な action です' }, { status: 400 });
  }
}
