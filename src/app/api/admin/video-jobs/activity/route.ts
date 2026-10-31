import { NextResponse } from 'next/server';
import { markVideoAdminActive } from '@/server/video-jobs/worker-poll';

export const dynamic = 'force-dynamic';

/**
 * 動画管理画面が表示されている間、数分ごとに呼ばれる軽い通知（DBには触れない）。
 * これが続く間は Worker のジョブ確認が15秒ごとになり、作成したジョブがすぐ取得される（src/lib/video-worker-poll.ts）。
 */
export async function POST() {
  await markVideoAdminActive();
  return NextResponse.json({ ok: true });
}
