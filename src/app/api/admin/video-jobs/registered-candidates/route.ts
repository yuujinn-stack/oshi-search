import { NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { loadRegisteredTarget } from '@/server/video-jobs/registered-target';

export const dynamic = 'force-dynamic';

/**
 * 動画「登録グループ紹介」: 現在の登録グループ（トップページ「グループで探す」と同じ一覧・同じ順）と登録人物数（読み取りのみ）。
 * ジャンルはトップページの明示的な分類だけ（一覧に無いグループは unclassified）。ジョブ作成時もサーバーで同じ処理をして作り直す
 */
export async function GET() {
  try {
    return NextResponse.json(await loadRegisteredTarget());
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
