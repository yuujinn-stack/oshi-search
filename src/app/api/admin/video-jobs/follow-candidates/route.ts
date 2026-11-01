import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { loadFollowTarget } from '@/server/video-jobs/follow-target';

export const dynamic = 'force-dynamic';

/**
 * 動画「フォロー獲得リール」: 人物・グループの公開作品（読み取りのみ）。
 *   ?targetType=person|group&name=○○ → 出演年・種類（サイトの表示分類）・役名・確認済みの配信（見放題・無料）・
 *   確認済みの配信先すべて（レンタル・購入・追加チャンネルを含む。作品選択欄の表示・絞り込み用）・出演メンバー
 * グループはメンバー全員の公開作品を同じ作品ごとに1件へまとめる（ジョブ作成時もサーバーで同じ処理をして確かめ直す）。
 * 人物・グループごとに1回だけ読み込み、ジャンル・配信サービス・作品名の絞り込みは画面側で行う（数百件でも1回の応答は百数十KB）
 */
export async function GET(req: NextRequest) {
  const targetType = req.nextUrl.searchParams.get('targetType');
  const name = req.nextUrl.searchParams.get('name')?.trim();
  if ((targetType !== 'person' && targetType !== 'group') || !name) return NextResponse.json({ error: '人物かグループを指定してください。' }, { status: 400 });
  try {
    return NextResponse.json(await loadFollowTarget(targetType, name));
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
